import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Form,
  Icon,
  Keyboard,
  List,
  LocalStorage,
  Toast,
  confirmAlert,
  environment,
  getPreferenceValues,
  showToast,
  useNavigation,
} from "@raycast/api";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { useEffect, useRef, useState } from "react";
import {
  availableScopes,
  Attempt,
  completeSessionPhrase,
  createAttempt,
  createPracticeState,
  describeTextEdit,
  exitFocus,
  FOCUS_GENERATION_SOURCE,
  hydratePracticeState,
  isPhraseSource,
  metrics,
  newSession,
  phrasePasses,
  PracticeState,
  recordAttempt,
  sanitizeTypedInput,
  serializePracticeState,
  Source,
  SourceSettings,
  sources,
  sourcesForPicker,
  sourceTitles,
  startFocus,
  UserGoals,
  willRepeatPhrase,
} from "./logic";
import {
  FOCUS_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  FocusBank,
  PracticeHistory,
  RoundSummary,
  appendRound,
  createFocusBank,
  createHistory,
  focusTokens,
  formatRoundSubtitle,
  formatRoundTitle,
  hydrateFocusBank,
  hydrateHistory,
  recordFocusSuccess,
  recordKeystrokeMiss,
  removeFocusToken,
} from "./focus";
import {
  PROGRESS_STORAGE_KEY,
  CurriculumProgress,
  Lesson,
  advanceToLesson,
  applyLesson,
  createProgress,
  effectiveGoals,
  ensureLessonSession,
  firstLesson,
  formatLessonSubtitle,
  formatTrackProgressDescription,
  getLesson,
  hydrateProgress,
  isLessonCompleted,
  lessonGroups,
  markLessonComplete,
  migrateLegacyGoals,
  nextLesson,
  roundAverageMeetsLesson,
  settingsMatchLesson,
} from "./curriculum";

const SHORTCUT_RESUME_GUIDED = "⌘⇧G";
const SHORTCUT_EXIT_FOCUS = "⌘⇧E";

const STORAGE_KEY = "ngram-type-state";

type ExtensionPrefs = {
  defaultMode: string;
  soundEnabled: boolean;
  defaultMinWPM: string;
};

function readColdStartPreferences(): {
  mode: "guided" | "free";
  soundEnabled: boolean;
  defaultMinWPM: number | null;
} {
  try {
    const prefs = getPreferenceValues<ExtensionPrefs>();
    const mode = prefs.defaultMode === "free" ? "free" : "guided";
    const parsed = Number.parseInt(String(prefs.defaultMinWPM ?? "40"), 10);
    const defaultMinWPM =
      Number.isFinite(parsed) && parsed >= 1 && parsed <= 2_000
        ? Math.round(parsed)
        : null;
    return {
      mode,
      soundEnabled: prefs.soundEnabled !== false,
      defaultMinWPM,
    };
  } catch {
    return { mode: "guided", soundEnabled: true, defaultMinWPM: null };
  }
}

const soundFiles = {
  key: "click.wav",
  error: "clack.wav",
  pass: "ding.wav",
  fail: "failed.mp3",
  /** Softer per-phrase pass; the ding is kept for round/lesson completion. */
  phrase: "/System/Library/Sounds/Tink.aiff",
} as const;

type Sound = keyof typeof soundFiles;
type AudioProcess = ReturnType<typeof spawn>;
type PracticeStyle = "warm_up" | "build" | "flow" | "custom";

const practiceStyles: Record<
  Exclude<PracticeStyle, "custom">,
  { title: string; combination: number; repetition: number }
> = {
  warm_up: { title: "Warm-up · 2 items × 3", combination: 2, repetition: 3 },
  build: { title: "Build · 5 items × 2", combination: 5, repetition: 2 },
  flow: { title: "Flow · 20 items × 1", combination: 20, repetition: 1 },
};
let audioProcess: AudioProcess | null = null;

function startAudio() {
  if (audioProcess) return;
  const paths = Object.fromEntries(
    Object.entries(soundFiles).map(([name, file]) => [
      name,
      file.startsWith("/")
        ? file
        : join(environment.assetsPath, "sounds", file),
    ]),
  );
  const script = `
    ObjC.import("Foundation");
    ObjC.import("AudioToolbox");
    const paths = ${JSON.stringify(paths)};
    const sounds = {};
    Object.keys(paths).forEach((name) => {
      const id = Ref();
      $.AudioServicesCreateSystemSoundID($.NSURL.fileURLWithPath(paths[name]), id);
      sounds[name] = id[0];
    });
    const input = $.NSFileHandle.fileHandleWithStandardInput;
    let buffer = "";
    while (true) {
      const data = input.availableData;
      if (Number(data.length) === 0) break;
      buffer += ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
      const lines = buffer.split(/\\r?\\n/);
      buffer = lines.pop();
      lines.forEach((name) => {
        if (sounds[name]) $.AudioServicesPlaySystemSound(sounds[name]);
      });
    }
  `;
  const process = spawn(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", script],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  audioProcess = process;
  process.on("error", () => {
    if (audioProcess === process) audioProcess = null;
  });
  process.on("exit", () => {
    if (audioProcess === process) audioProcess = null;
  });
}

function stopAudio() {
  audioProcess?.kill();
  audioProcess = null;
}

function playSound(sound: Sound, enabled: boolean) {
  if (!enabled) return;
  startAudio();
  audioProcess?.stdin?.write(`${sound}\n`);
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

function sameSettings(a: SourceSettings, b: SourceSettings) {
  return (
    a.scope === b.scope &&
    a.combination === b.combination &&
    a.repetition === b.repetition &&
    a.minimumWPM === b.minimumWPM &&
    a.minimumAccuracy === b.minimumAccuracy
  );
}

function practiceStyleFor(settings: SourceSettings): PracticeStyle {
  const match = Object.entries(practiceStyles).find(
    ([, style]) =>
      style.combination === settings.combination &&
      style.repetition === settings.repetition,
  );
  return (match?.[0] as PracticeStyle | undefined) ?? "custom";
}

function matchingPrefixLength(expected: string, typed: string) {
  let index = 0;
  while (index < typed.length && typed[index] === expected[index]) index++;
  return index;
}

const GOAL_DEFAULT = "default";

function goalValue(goal: number | null) {
  return goal === null ? GOAL_DEFAULT : String(goal);
}

function parseGoal(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Standard options plus a saved custom value (e.g. a migrated 45). */
function goalOptions(standard: number[], current: number | null) {
  return current === null || standard.includes(current)
    ? standard
    : [...standard, current].sort((a, b) => a - b);
}

function readableCharacter(character: string | undefined) {
  if (character === " ") return "space";
  if (character === undefined) return "end of phrase";
  return `“${character}”`;
}

export default function Practice() {
  const [state, setState] = useState<PracticeState>(createPracticeState);
  const [progress, setProgress] = useState<CurriculumProgress>(createProgress);
  const [focusBank, setFocusBank] = useState<FocusBank>(createFocusBank);
  const [history, setHistory] = useState<PracticeHistory>(createHistory);
  const [loaded, setLoaded] = useState(false);
  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [currentMetrics, setCurrentMetrics] = useState(metrics("", "", null));
  const [attempt, setAttempt] = useState<Attempt>(createAttempt);
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ReturnType<
    typeof metrics
  > | null>(null);
  const [status, setStatus] = useState("Start typing when ready");
  const completing = useRef(false);
  // If saved data could not be read, don't overwrite it with a fresh state.
  const persistEnabled = useRef(true);
  const typingRef = useRef<Form.TextArea>(null);
  const session =
    state.focusActive && state.focusSession
      ? state.focusSession
      : state.sessions[state.source];
  const expected = session?.phrases[session.phraseIndex] ?? "";
  const settings = state.settings[state.source];
  const navigation = useNavigation();
  const guided =
    progress.mode === "guided"
      ? getLesson(progress.currentLessonId)
      : undefined;
  const guidedCompleted = guided
    ? isLessonCompleted(progress, guided.id)
    : false;
  // Unlock after a qualifying finished round marks the lesson complete (or on revisit).
  const canAdvanceLesson = Boolean(guided?.next && guidedCompleted);

  useEffect(() => {
    if (!loaded || !state.soundEnabled) return;
    startAudio();
    return stopAudio;
  }, [loaded, state.soundEnabled]);

  useEffect(() => {
    Promise.all([
      LocalStorage.getItem<string>(STORAGE_KEY),
      LocalStorage.getItem<string>(PROGRESS_STORAGE_KEY),
      LocalStorage.getItem<string>(FOCUS_STORAGE_KEY),
      LocalStorage.getItem<string>(HISTORY_STORAGE_KEY),
    ])
      .then(([rawState, rawProgress, rawFocus, rawHistory]) => {
        let nextState = createPracticeState();
        let nextProgress = createProgress();
        let nextFocus = createFocusBank();
        let nextHistory = createHistory();
        let savedHasGoals = false;
        try {
          const saved = rawState
            ? (JSON.parse(rawState) as unknown)
            : undefined;
          savedHasGoals =
            typeof saved === "object" && saved !== null && "goals" in saved;
          const hydrated = hydratePracticeState(saved);
          if (hydrated) nextState = hydrated;
        } catch {
          // Ignore corrupt practice state.
        }
        try {
          const savedProgress = rawProgress
            ? (JSON.parse(rawProgress) as unknown)
            : undefined;
          nextProgress = hydrateProgress(savedProgress);
        } catch {
          nextProgress = createProgress();
        }
        try {
          const savedFocus = rawFocus
            ? (JSON.parse(rawFocus) as unknown)
            : undefined;
          nextFocus = hydrateFocusBank(savedFocus);
        } catch {
          nextFocus = createFocusBank();
        }
        try {
          const savedHistory = rawHistory
            ? (JSON.parse(rawHistory) as unknown)
            : undefined;
          nextHistory = hydrateHistory(savedHistory);
        } catch {
          nextHistory = createHistory();
        }

        const isColdStart = !rawState && !rawProgress;
        if (isColdStart) {
          const prefs = readColdStartPreferences();
          nextProgress = { ...createProgress(), mode: prefs.mode };
          const settings = { ...nextState.settings };
          if (prefs.defaultMinWPM !== null) {
            for (const source of sources) {
              settings[source] = {
                ...settings[source],
                minimumWPM: prefs.defaultMinWPM,
              };
            }
          }
          nextState = {
            ...nextState,
            soundEnabled: prefs.soundEnabled,
            settings,
          };
        }

        // Saved state from before user goals (v<7): keep a custom goal.
        if (rawState && !savedHasGoals) {
          const lesson =
            nextProgress.mode === "guided" && !nextState.focusActive
              ? getLesson(nextProgress.currentLessonId)
              : undefined;
          nextState = {
            ...nextState,
            goals: migrateLegacyGoals(
              nextState,
              lesson,
              readColdStartPreferences().defaultMinWPM ?? 40,
            ),
          };
        }

        if (nextProgress.mode === "guided" && !nextState.focusActive) {
          const lesson = getLesson(nextProgress.currentLessonId);
          // Keeps a matching in-progress round; re-caps older uncapped sessions.
          if (lesson) nextState = ensureLessonSession(nextState, lesson);
        }

        setState(nextState);
        setProgress(nextProgress);
        setFocusBank(nextFocus);
        setHistory(nextHistory);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        persistEnabled.current = false;
        setState(ensureLessonSession(createPracticeState(), firstLesson()));
        setProgress(createProgress());
        setLoaded(true);
        void showToast({
          style: Toast.Style.Failure,
          title: "Couldn't load saved progress",
          message:
            error instanceof Error
              ? `${error.message} · practicing without saving`
              : "Practicing without saving",
        });
      });
  }, []);

  useEffect(() => {
    if (loaded && persistEnabled.current) {
      void LocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(serializePracticeState(state)),
      );
    }
  }, [loaded, state]);

  useEffect(() => {
    if (loaded && persistEnabled.current) {
      void LocalStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    }
  }, [loaded, progress]);

  useEffect(() => {
    if (loaded && persistEnabled.current) {
      void LocalStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(focusBank));
    }
  }, [loaded, focusBank]);

  useEffect(() => {
    if (loaded && persistEnabled.current) {
      void LocalStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    }
  }, [loaded, history]);

  useEffect(() => {
    setTyped("");
    setStartedAt(null);
    setAttempt(createAttempt());
    setInputNotice(null);
    setCurrentMetrics(metrics(expected, "", null));
    if (!expected) setStatus("Add Custom Words in Practice Settings");
    completing.current = false;
    typingRef.current?.focus();
  }, [state.source, state.focusActive, expected]);

  const averageWPM = average(session?.wpms ?? []);
  const hasPhrase = Boolean(expected);
  const matchingCharacters = matchingPrefixLength(expected, typed);
  const hasMistake = matchingCharacters < typed.length;
  // Guided: max(user, lesson) goal; free/Focus: user goal or dataset default.
  // Free-practice default follows the "Default WPM Goal" preference live.
  const freeDefaultWPM =
    readColdStartPreferences().defaultMinWPM ?? settings.minimumWPM;
  const goal = effectiveGoals(
    state.goals,
    guided && !state.focusActive ? guided : undefined,
    { ...settings, minimumWPM: freeDefaultWPM },
  );
  // Accuracy can't recover once below the goal, so flag the repeat early.
  const willRepeat =
    startedAt !== null && willRepeatPhrase(attempt, goal.minimumAccuracy);
  const repeatNote = `below ${goal.minimumAccuracy}% — this phrase will repeat`;
  const feedback = inputNotice
    ? inputNotice
    : hasMistake
      ? `Fix character ${matchingCharacters + 1} · ${currentMetrics.accuracy}% accuracy`
      : startedAt
        ? `${typed.length}/${expected.length} characters · ${currentMetrics.accuracy}% accuracy${typed.length >= 10 ? ` · ${currentMetrics.wpm} WPM` : ""}${willRepeat ? ` · ${repeatNote}` : ""}`
        : status;
  const typingError =
    inputNotice ??
    (hasMistake
      ? `Expected ${readableCharacter(expected[matchingCharacters])}${willRepeat ? ` · ${repeatNote}` : ""}`
      : undefined);

  function resetPhrase(message = "Phrase reset") {
    setTyped("");
    setStartedAt(null);
    setAttempt(createAttempt());
    setInputNotice(null);
    setLastResult(null);
    setCurrentMetrics(metrics(expected, "", null));
    setStatus(message);
    completing.current = false;
  }

  function restartRound() {
    setLastResult(null);
    setState((previous) => {
      if (previous.focusActive && previous.focusSession) {
        const focus = previous.focusSession;
        return {
          ...previous,
          focusSession: newSession(
            FOCUS_GENERATION_SOURCE,
            focus.settings,
            [],
            {
              values: focus.values,
            },
          ),
        };
      }
      const current = previous.sessions[previous.source];
      return {
        ...previous,
        sessions: {
          ...previous.sessions,
          [previous.source]: newSession(
            previous.source,
            previous.settings[previous.source],
            previous.customWords,
            { maxPhrases: current.maxPhrases },
          ),
        },
      };
    });
    resetPhrase("New round ready");
  }

  function finishPhrase(
    value: string,
    beganAt: number,
    completedAttempt: Attempt,
  ) {
    if (completing.current || !expected) return;
    completing.current = true;
    const result = metrics(
      expected,
      value.trimEnd(),
      beganAt,
      Date.now(),
      completedAttempt,
    );

    if (!phrasePasses(result, goal)) {
      // Failed attempt: misses were already banked per keystroke; a slow but
      // clean phrase banks nothing.
      setCurrentMetrics(result);
      setLastResult(result);
      playSound("fail", state.soundEnabled);
      setTyped("");
      setStartedAt(null);
      setAttempt(createAttempt());
      setInputNotice(null);
      setStatus(
        `Retry · ${result.wpm} WPM · ${result.accuracy}% accuracy · goal ${goal.minimumWPM}/${goal.minimumAccuracy}%`,
      );
      completing.current = false;
      return;
    }

    const currentSession = session;
    const finishedRound =
      currentSession.phraseIndex + 1 >= currentSession.phrases.length;
    const roundWpms = [...currentSession.wpms, result.wpm];
    const roundAvg = average(roundWpms);
    const activeLesson =
      progress.mode === "guided"
        ? getLesson(progress.currentLessonId)
        : undefined;

    // Clean completion decays Focus entries for tokens in this phrase.
    if (result.accuracy >= 100) {
      const drilled = expected.split(/\s+/).filter(Boolean);
      if (drilled.length > 0) {
        setFocusBank((previous) => recordFocusSuccess(previous, drilled));
      }
    }

    const roundAccuracies = [...currentSession.accuracies, result.accuracy];
    const roundAccuracyAvg = average(roundAccuracies);

    if (state.focusActive) {
      if (!finishedRound) {
        setState((previous) =>
          previous.focusSession
            ? {
                ...previous,
                focusSession: completeSessionPhrase(
                  previous.focusSession,
                  FOCUS_GENERATION_SOURCE,
                  previous.focusSession.settings,
                  [],
                  result.wpm,
                  result.accuracy,
                ),
              }
            : previous,
        );
      }
      // A finished Focus round ends Focus (handled below via leaveFocus).
    } else {
      setState((previous) => {
        const current = previous.sessions[previous.source];
        return {
          ...previous,
          sessions: {
            ...previous.sessions,
            [previous.source]: completeSessionPhrase(
              current,
              previous.source,
              previous.settings[previous.source],
              previous.customWords,
              result.wpm,
              result.accuracy,
            ),
          },
        };
      });
    }

    if (finishedRound) {
      const summary: RoundSummary = {
        at: Date.now(),
        lessonId: activeLesson?.id ?? null,
        source: state.focusActive ? "focus" : state.source,
        scope: state.focusActive ? null : (settings.scope ?? null),
        avgWpm: roundAvg,
        accuracy: roundAccuracyAvg,
      };
      setHistory((previous) => appendRound(previous, summary));
    }

    const lessonPassed = Boolean(
      activeLesson &&
      !state.focusActive &&
      finishedRound &&
      roundAverageMeetsLesson(roundWpms, activeLesson, goal.minimumWPM),
    );

    if (finishedRound && state.focusActive) {
      const backTo = leaveFocus();
      setStatus(`Focus round complete · avg ${roundAvg} WPM`);
      void showToast({
        style: Toast.Style.Success,
        title: `Focus round complete · ${roundAvg} WPM`,
        message: `Back to ${backTo}`,
      });
    } else if (finishedRound) {
      const following =
        activeLesson && !state.focusActive
          ? nextLesson(activeLesson.id)
          : undefined;
      const canAdvance = Boolean(
        following &&
        activeLesson &&
        (lessonPassed || isLessonCompleted(progress, activeLesson.id)),
      );
      if (lessonPassed && activeLesson) {
        setProgress((previous) =>
          markLessonComplete(previous, activeLesson.id, roundAvg),
        );
        setStatus(
          following
            ? `Lesson complete · avg ${roundAvg} WPM · Next: ${following.title}`
            : `Track complete · avg ${roundAvg} WPM · great work`,
        );
      } else {
        setStatus(`Round complete · avg ${roundAvg} WPM · new round ready`);
      }
      void showToast({
        style: Toast.Style.Success,
        title: lessonPassed
          ? `Lesson complete · ${roundAvg} WPM`
          : `Round complete · ${roundAvg} WPM`,
        message: lessonPassed
          ? following
            ? `Next: ${following.title}`
            : "Track complete"
          : activeLesson && !state.focusActive
            ? `Lesson needs avg ${goal.minimumWPM} WPM · new round ready`
            : "New round ready",
        primaryAction:
          canAdvance && following
            ? {
                title: "Next Lesson",
                onAction: (toast) => {
                  void toast.hide();
                  startLesson(following, `Next lesson · ${following.title}`);
                },
              }
            : undefined,
      });
    } else {
      setStatus(
        `Passed · ${result.wpm} WPM · ${result.accuracy}% · next phrase ready`,
      );
    }

    setCurrentMetrics(result);
    setLastResult(result);
    playSound(finishedRound ? "pass" : "phrase", state.soundEnabled);
    setTyped("");
    setStartedAt(null);
    setAttempt(createAttempt());
    setInputNotice(null);
    completing.current = false;
  }

  /**
   * Resync the controlled input after a stripped newline: state already equals
   * `value`, so render `shown` once to give Raycast a real value change.
   */
  function resyncInput(value: string, shown: string) {
    setTyped(shown);
    setTimeout(() => setTyped(value), 0);
  }

  function handleChange(value: string) {
    if (!expected) return;
    // Return/newlines never count as keystrokes (primary action is ⌘↵).
    const next = sanitizeTypedInput(value);
    if (next === typed) {
      if (value !== next) resyncInput(next, value);
      return;
    }
    if (!next) {
      resetPhrase();
      return;
    }

    const edit = describeTextEdit(typed, next);
    if (edit.inserted.length > 1) {
      setInputNotice("Paste is disabled during a typing drill");
      playSound("error", state.soundEnabled);
      return;
    }

    // Only real mistyped characters go to the Focus bank.
    setFocusBank((previous) => recordKeystrokeMiss(previous, expected, edit));

    const beganAt = startedAt ?? Date.now();
    if (!startedAt) {
      setStartedAt(beganAt);
      setLastResult(null);
    }
    const nextAttempt = recordAttempt(attempt, expected, edit);
    const isWrong = !expected.startsWith(next);
    const completesPhrase = next.trimEnd() === expected;
    if (next.length > typed.length && !completesPhrase) {
      playSound(isWrong ? "error" : "key", state.soundEnabled);
    }
    setTyped(next);
    setAttempt(nextAttempt);
    setInputNotice(null);
    const result = metrics(expected, next, beganAt, Date.now(), nextAttempt);
    setCurrentMetrics(result);
    setStatus("Typing");
    if (next.trimEnd() === expected) finishPhrase(next, beganAt, nextAttempt);
  }

  function startLesson(lesson: Lesson, message: string) {
    setLastResult(null);
    setStatus(message);
    setProgress((previous) => advanceToLesson(previous, lesson.id));
    // Keep an in-progress round for this lesson (Resume / Start current).
    setState((previous) => ensureLessonSession(previous, lesson));
  }

  function toastLeftGuided() {
    void showToast({
      style: Toast.Style.Success,
      title: "Left guided track",
      message: `Resume Guided Track with ${SHORTCUT_RESUME_GUIDED}`,
    });
  }

  /** End Focus and return to the mode/lesson active before it. Returns a label. */
  function leaveFocus(): string {
    const returnMode = state.focusReturnMode;
    setLastResult(null);
    if (returnMode === "guided") {
      const lesson = getLesson(progress.currentLessonId) ?? firstLesson();
      setProgress((previous) => advanceToLesson(previous, lesson.id));
      setState((previous) => ensureLessonSession(exitFocus(previous), lesson));
      return lesson.title;
    }
    setState((previous) => exitFocus(previous));
    return `free practice · ${sourceTitles[state.source]}`;
  }

  function exitFocusPractice() {
    const backTo = leaveFocus();
    setStatus(`Focus ended · back to ${backTo}`);
  }

  function startFocusPractice() {
    const tokens = focusTokens(focusBank);
    if (tokens.length === 0) {
      void showToast({
        style: Toast.Style.Failure,
        title: "Focus bank is empty",
        message: "Chunks you mistype are collected here while you practice",
      });
      return;
    }
    setLastResult(null);
    const returnMode =
      state.focusActive && state.focusReturnMode
        ? state.focusReturnMode
        : progress.mode;
    if (progress.mode === "guided") {
      setProgress((previous) => ({ ...previous, mode: "free" }));
      void showToast({
        style: Toast.Style.Success,
        title: "Left guided track",
        message: `Focus returns after one round · ${SHORTCUT_EXIT_FOCUS} exits now`,
      });
    }
    setState((previous) => startFocus(previous, tokens, returnMode));
    setStatus(`Focus · ${tokens.length} missed chunks`);
  }

  function goToNextLesson() {
    if (!guided?.next) return;
    const following = nextLesson(guided.id);
    if (!following) return;
    startLesson(following, `Next lesson · ${following.title}`);
  }

  function retryLesson() {
    if (!guided) return;
    setLastResult(null);
    setStatus(`Retry · ${guided.title}`);
    setState((previous) => applyLesson(previous, guided));
  }

  function jumpToFreePractice() {
    setProgress((previous) => ({ ...previous, mode: "free" }));
    setState((previous) => exitFocus(previous));
    setStatus("Free practice · change dataset with ⌘D");
  }

  function resumeGuidedTrack() {
    const lesson = getLesson(progress.currentLessonId) ?? firstLesson();
    startLesson(lesson, `Resume guided · ${lesson.title}`);
  }

  function changeSource(value: string) {
    if (value in sourceTitles) {
      setLastResult(null);
      setStatus("Start typing when ready");
      if (progress.mode === "guided") {
        setProgress((previous) => ({ ...previous, mode: "free" }));
        toastLeftGuided();
      }
      setState((previous) => ({
        ...exitFocus(previous),
        source: value as Source,
      }));
    }
  }

  function toggleSound() {
    setState((previous) => ({
      ...previous,
      soundEnabled: !previous.soundEnabled,
    }));
  }

  function saveSettings(
    source: Source,
    nextSettings: Record<Source, SourceSettings>,
    customWords: string[],
    soundEnabled: boolean,
    goals: UserGoals,
  ) {
    setStatus("New settings ready");
    setLastResult(null);
    const currentLesson =
      progress.mode === "guided"
        ? getLesson(progress.currentLessonId)
        : undefined;
    const staysGuided = Boolean(
      currentLesson &&
      source === currentLesson.source &&
      settingsMatchLesson(nextSettings[currentLesson.source], currentLesson),
    );
    if (progress.mode === "guided" && !staysGuided) {
      setProgress((previous) => ({ ...previous, mode: "free" }));
      toastLeftGuided();
    }
    setState((previous) => {
      const sessions = { ...previous.sessions };
      const customChanged =
        previous.customWords.join(" ") !== customWords.join(" ");
      sources.forEach((dataset) => {
        if (
          !sameSettings(previous.settings[dataset], nextSettings[dataset]) ||
          (dataset === "custom_words" && customChanged)
        ) {
          sessions[dataset] = newSession(
            dataset,
            nextSettings[dataset],
            customWords,
          );
        }
      });
      return {
        ...previous,
        source,
        soundEnabled,
        customWords,
        goals,
        settings: nextSettings,
        sessions,
        focusActive: false,
        focusSession: null,
        focusReturnMode: null,
      };
    });
    navigation.pop();
  }

  function removeFromFocusBank(token: string) {
    setFocusBank((previous) => removeFocusToken(previous, token));
  }

  function clearFocusBank() {
    setFocusBank(createFocusBank());
  }

  function clearHistory() {
    setHistory(createHistory());
  }

  if (!loaded) return <Form isLoading />;

  const phraseCounter = hasPhrase
    ? `phrase ${(session?.phraseIndex ?? 0) + 1}/${session?.phrases.length ?? 0}`
    : "no phrases yet";
  const contextTitle = state.focusActive
    ? "Focus"
    : guided
      ? "Lesson"
      : "Practice";
  const contextText = state.focusActive
    ? `${state.focusSession?.values?.length ?? 0} missed chunks · ${phraseCounter}`
    : guided
      ? `${formatTrackProgressDescription(progress)} · ${phraseCounter}${canAdvanceLesson ? " · Next Lesson ready (⌘⇧N)" : ""}`
      : `${sourceTitles[state.source]}${settings.scope ? ` · Top ${settings.scope}` : ""} · ${phraseCounter}`;
  const goalText = `${goal.minimumWPM} WPM (${goal.wpmSource}) · ${goal.minimumAccuracy}%${goal.accuracySource === "yours" ? " (yours)" : ""} · avg ${averageWPM || "—"}${lastResult ? ` · last ${lastResult.wpm}/${lastResult.accuracy}%` : ""}`;

  return (
    <Form
      actions={
        <ActionPanel>
          {/*
            Form primary action = ⌘↵ (first action), secondary = ⌘⇧↵.
            Next Lesson becomes primary once the lesson is complete; otherwise
            Reset Phrase is primary. Next Lesson also keeps ⌘⇧N in any position.
          */}
          {hasPhrase && (
            <ActionPanel.Section title="Practice">
              {guided && canAdvanceLesson && guided.next && (
                <Action
                  title="Next Lesson"
                  icon={Icon.ArrowRight}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
                  onAction={goToNextLesson}
                />
              )}
              <Action
                title="Reset Phrase"
                icon={Icon.RotateAntiClockwise}
                onAction={() => resetPhrase()}
              />
              <Action
                title="New Round"
                icon={Icon.Shuffle}
                shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                onAction={restartRound}
              />
              <Action
                title={
                  state.soundEnabled
                    ? "Mute Typing Sounds"
                    : "Enable Typing Sounds"
                }
                icon={state.soundEnabled ? Icon.SpeakerOff : Icon.SpeakerOn}
                shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
                onAction={toggleSound}
              />
            </ActionPanel.Section>
          )}
          <ActionPanel.Section title="Curriculum">
            <Action.Push
              title="Open Curriculum"
              icon={Icon.Book}
              shortcut={{ modifiers: ["cmd"], key: "l" }}
              target={
                <CurriculumList
                  progress={progress}
                  onStartLesson={(lesson) => {
                    startLesson(lesson, `Lesson · ${lesson.title}`);
                  }}
                  onResumeCurrent={() => {
                    const lesson =
                      getLesson(progress.currentLessonId) ?? firstLesson();
                    startLesson(lesson, `Resume · ${lesson.title}`);
                  }}
                />
              }
            />
            {progress.mode === "free" && (
              <Action
                title="Resume Guided Track"
                icon={Icon.Play}
                shortcut={{ modifiers: ["cmd", "shift"], key: "g" }}
                onAction={resumeGuidedTrack}
              />
            )}
            {guided && (
              <Action
                title="Retry Lesson"
                icon={Icon.Repeat}
                shortcut={{ modifiers: ["cmd", "shift"], key: "l" }}
                onAction={retryLesson}
              />
            )}
            {guided && (
              <Action
                title="Jump to Free Practice"
                icon={Icon.Keyboard}
                shortcut={{ modifiers: ["cmd", "shift"], key: "j" }}
                onAction={jumpToFreePractice}
              />
            )}
          </ActionPanel.Section>
          <ActionPanel.Section title="Review">
            {/* Same shortcut toggles Focus: the two actions never render together. */}
            {state.focusActive ? (
              <Action
                title="Exit Focus"
                icon={Icon.XMarkCircle}
                shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
                onAction={exitFocusPractice}
              />
            ) : (
              <Action
                title={
                  focusBank.entries.length > 0
                    ? `Practice Focus Bank (${focusBank.entries.length})`
                    : "Practice Focus Bank"
                }
                icon={Icon.BullsEye}
                shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
                onAction={startFocusPractice}
              />
            )}
            <Action.Push
              title="Open Focus Bank"
              icon={Icon.Tag}
              shortcut={{ modifiers: ["cmd", "shift"], key: "b" }}
              target={
                <FocusBankList
                  bank={focusBank}
                  onPractice={startFocusPractice}
                  onRemove={removeFromFocusBank}
                  onClear={clearFocusBank}
                />
              }
            />
            <Action.Push
              title="Open History"
              icon={Icon.Clock}
              shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
              target={<HistoryList history={history} onClear={clearHistory} />}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Configure">
            <Action.Push
              title="Practice Settings"
              icon={Icon.Gear}
              shortcut={Keyboard.Shortcut.Common.Edit}
              target={
                <SettingsForm
                  source={state.source}
                  settings={state.settings}
                  customWords={state.customWords}
                  soundEnabled={state.soundEnabled}
                  goals={state.goals}
                  lessonGoal={guided?.minWPM}
                  freeDefaultWPM={freeDefaultWPM}
                  onSave={saveSettings}
                />
              }
            />
            <ActionPanel.Submenu
              title="Change Dataset…"
              icon={Icon.List}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
            >
              {sourcesForPicker(state.source).map((source) => (
                <Action
                  key={source}
                  title={sourceTitles[source]}
                  icon={
                    source === state.source ? Icon.CheckCircle : Icon.Circle
                  }
                  onAction={() => changeSource(source)}
                />
              ))}
            </ActionPanel.Submenu>
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      <Form.Description
        title="Type this"
        text={expected || "Add Custom Words in Practice Settings (⌘E)"}
      />
      <Form.Separator />
      {hasPhrase ? (
        <Form.TextArea
          id="typing"
          ref={typingRef}
          title="Your turn"
          placeholder="Start typing"
          value={typed}
          onChange={handleChange}
          autoFocus
          error={typingError}
          info="Completion is automatic. Fix mistakes with Backspace."
        />
      ) : (
        <Form.Description
          title="Your turn"
          text="Open Practice Settings and add words to begin."
        />
      )}
      <Form.Description title="Feedback" text={feedback} />
      <Form.Description title={contextTitle} text={contextText} />
      <Form.Description title="Goal" text={goalText} />
    </Form>
  );
}

function HistoryList({
  history,
  onClear,
}: {
  history: PracticeHistory;
  onClear: () => void;
}) {
  // Local copy so the pushed view updates immediately after clearing.
  const [rounds, setRounds] = useState(history.rounds);

  async function clear() {
    const confirmed = await confirmAlert({
      title: "Clear History?",
      message: "All saved rounds will be removed. This can't be undone.",
      primaryAction: {
        title: "Clear History",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;
    onClear();
    setRounds([]);
    await showToast({ style: Toast.Style.Success, title: "History cleared" });
  }

  return (
    <List navigationTitle="Practice History">
      {rounds.length === 0 ? (
        <List.EmptyView
          icon={Icon.Clock}
          title="No rounds yet"
          description="Finish a round to see average WPM and accuracy here."
        />
      ) : (
        rounds.map((round, index) => (
          <List.Item
            key={`${round.at}-${index}`}
            title={formatRoundTitle(round)}
            subtitle={formatRoundSubtitle(round)}
            icon={round.source === "focus" ? Icon.BullsEye : Icon.BarChart}
            accessories={[
              { tag: { value: `${round.avgWpm} WPM`, color: Color.Blue } },
              {
                tag: {
                  value: `${round.accuracy}%`,
                  color: round.accuracy >= 100 ? Color.Green : Color.Orange,
                },
              },
              { date: new Date(round.at) },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Clear History"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.RemoveAll}
                  onAction={clear}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

function FocusBankList({
  bank,
  onPractice,
  onRemove,
  onClear,
}: {
  bank: FocusBank;
  onPractice: () => void;
  onRemove: (token: string) => void;
  onClear: () => void;
}) {
  const { pop } = useNavigation();
  // Local copy so removals show immediately in the pushed view.
  const [entries, setEntries] = useState(bank.entries);

  async function clear() {
    const confirmed = await confirmAlert({
      title: "Clear Focus Bank?",
      message: "All collected chunks will be removed.",
      primaryAction: {
        title: "Clear Focus Bank",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;
    onClear();
    setEntries([]);
    await showToast({
      style: Toast.Style.Success,
      title: "Focus bank cleared",
    });
  }

  return (
    <List navigationTitle="Focus Bank">
      {entries.length === 0 ? (
        <List.EmptyView
          icon={Icon.BullsEye}
          title="Focus bank is empty"
          description="Chunks you mistype are collected here while you practice."
        />
      ) : (
        entries.map((entry) => (
          <List.Item
            key={entry.token}
            title={entry.token}
            icon={Icon.BullsEye}
            accessories={[
              {
                tag: {
                  value: `${entry.misses} ${entry.misses === 1 ? "miss" : "misses"}`,
                  color: entry.misses >= 3 ? Color.Red : Color.Orange,
                },
              },
              { date: new Date(entry.lastMissedAt), tooltip: "Last missed" },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Practice Focus Bank"
                  icon={Icon.Play}
                  onAction={() => {
                    onPractice();
                    pop();
                  }}
                />
                <Action
                  title="Remove Chunk"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() => {
                    onRemove(entry.token);
                    setEntries((previous) =>
                      previous.filter((item) => item.token !== entry.token),
                    );
                  }}
                />
                <Action
                  title="Clear Focus Bank"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.RemoveAll}
                  onAction={clear}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

function CurriculumList({
  progress,
  onStartLesson,
  onResumeCurrent,
}: {
  progress: CurriculumProgress;
  onStartLesson: (lesson: Lesson) => void;
  onResumeCurrent: () => void;
}) {
  const { pop } = useNavigation();

  return (
    <List
      navigationTitle="English Curriculum"
      selectedItemId={progress.currentLessonId}
    >
      {lessonGroups().map((group) => {
        const done = group.lessons.filter((lesson) =>
          isLessonCompleted(progress, lesson.id),
        ).length;
        return (
          <List.Section
            key={group.title}
            title={group.title}
            subtitle={`${done}/${group.lessons.length} done`}
          >
            {group.lessons.map((lesson) => {
              const completed = isLessonCompleted(progress, lesson.id);
              const isCurrent = lesson.id === progress.currentLessonId;
              const best = progress.bestWpmByLesson[lesson.id];
              const accessories: List.Item.Accessory[] = [];
              if (isCurrent) {
                accessories.push({
                  tag: { value: "Current", color: Color.Blue },
                });
              }
              if (best !== undefined) {
                accessories.push({
                  icon: Icon.Trophy,
                  text: `Best ${best}`,
                  tooltip: "Best round average WPM",
                });
              }
              accessories.push({
                text: `${lesson.minWPM} WPM`,
                tooltip: "Lesson goal",
              });
              return (
                <List.Item
                  key={lesson.id}
                  id={lesson.id}
                  title={lesson.title}
                  subtitle={formatLessonSubtitle(lesson)}
                  icon={
                    completed
                      ? { source: Icon.CheckCircle, tintColor: Color.Green }
                      : isCurrent
                        ? Icon.Play
                        : Icon.Circle
                  }
                  accessories={accessories}
                  actions={
                    <ActionPanel>
                      <Action
                        title="Start Lesson"
                        icon={Icon.Play}
                        onAction={() => {
                          onStartLesson(lesson);
                          pop();
                        }}
                      />
                      <Action
                        title="Resume Current"
                        icon={Icon.ArrowRight}
                        onAction={() => {
                          onResumeCurrent();
                          pop();
                        }}
                      />
                    </ActionPanel>
                  }
                />
              );
            })}
          </List.Section>
        );
      })}
    </List>
  );
}

function SettingsForm({
  source,
  settings,
  customWords,
  soundEnabled,
  goals,
  lessonGoal,
  freeDefaultWPM,
  onSave,
}: {
  source: Source;
  settings: Record<Source, SourceSettings>;
  customWords: string[];
  soundEnabled: boolean;
  goals: UserGoals;
  lessonGoal?: number;
  freeDefaultWPM: number;
  onSave: (
    source: Source,
    settings: Record<Source, SourceSettings>,
    customWords: string[],
    soundEnabled: boolean,
    goals: UserGoals,
  ) => void;
}) {
  const [goalDraft, setGoalDraft] = useState<UserGoals>(goals);
  const [selectedSource, setSelectedSource] = useState(source);
  const [drafts, setDrafts] = useState<Record<Source, SourceSettings>>(
    () =>
      Object.fromEntries(
        sources.map((dataset) => [dataset, { ...settings[dataset] }]),
      ) as Record<Source, SourceSettings>,
  );
  const [customText, setCustomText] = useState(customWords.join("\n"));
  const [practiceStylesBySource, setPracticeStylesBySource] = useState<
    Record<Source, PracticeStyle>
  >(
    () =>
      Object.fromEntries(
        sources.map((dataset) => [
          dataset,
          practiceStyleFor(settings[dataset]),
        ]),
      ) as Record<Source, PracticeStyle>,
  );
  const draft = drafts[selectedSource];
  const practiceStyle = practiceStylesBySource[selectedSource];
  const isNaturalPhraseBank = isPhraseSource(selectedSource);

  function updateSetting(key: keyof SourceSettings, value: string) {
    setDrafts((previous) => ({
      ...previous,
      [selectedSource]: { ...previous[selectedSource], [key]: Number(value) },
    }));
  }

  function selectSource(value: string) {
    setSelectedSource(value as Source);
  }

  function selectPracticeStyle(value: string) {
    const nextStyle = value as PracticeStyle;
    setPracticeStylesBySource((previous) => ({
      ...previous,
      [selectedSource]: nextStyle,
    }));
    if (nextStyle === "custom") return;
    const style = practiceStyles[nextStyle];
    setDrafts((previous) => ({
      ...previous,
      [selectedSource]: {
        ...previous[selectedSource],
        combination: style.combination,
        repetition: style.repetition,
      },
    }));
  }

  function submit(values: Form.Values) {
    const custom = String(values.customWords ?? customText)
      .split(/\s+/)
      .filter(Boolean);
    const preparedSettings = Object.fromEntries(
      sources.map((dataset) => [
        dataset,
        {
          ...drafts[dataset],
          scope:
            dataset === "custom_words" ? null : (drafts[dataset].scope ?? 50),
        },
      ]),
    ) as Record<Source, SourceSettings>;
    onSave(
      selectedSource,
      preparedSettings,
      custom,
      values.soundEnabled !== false,
      goalDraft,
    );
  }

  return (
    <Form
      navigationTitle="Practice Settings"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save and Practice"
            icon={Icon.CheckCircle}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Session"
        text="Drafts are kept for every dataset until you save."
      />
      <Form.Dropdown
        id="source"
        title="Dataset"
        value={selectedSource}
        onChange={selectSource}
      >
        {sourcesForPicker(selectedSource).map((value) => (
          <Form.Dropdown.Item
            key={value}
            value={value}
            title={sourceTitles[value]}
          />
        ))}
      </Form.Dropdown>
      {selectedSource === "custom_words" && (
        <Form.TextArea
          id="customWords"
          title="Words"
          value={customText}
          onChange={setCustomText}
          placeholder="Separate words with spaces or new lines"
        />
      )}
      {isNaturalPhraseBank ? (
        <Form.Description
          title="Practice style"
          text="Natural sentences · no grouping or repetition"
        />
      ) : (
        <Form.Dropdown
          id="practiceStyle"
          title="Practice style"
          value={practiceStyle}
          onChange={selectPracticeStyle}
        >
          {Object.entries(practiceStyles).map(([value, style]) => (
            <Form.Dropdown.Item key={value} value={value} title={style.title} />
          ))}
          <Form.Dropdown.Item value="custom" title="Custom" />
        </Form.Dropdown>
      )}
      {selectedSource === "custom_words" ? (
        <Form.Description title="Scope" text="All Custom Words" />
      ) : (
        <Form.Dropdown
          id="scope"
          title="Scope"
          value={String(draft.scope ?? 50)}
          onChange={(value) => updateSetting("scope", value)}
        >
          {availableScopes(selectedSource).map((value) => (
            <Form.Dropdown.Item
              key={value}
              value={String(value)}
              title={`Top ${value}`}
            />
          ))}
        </Form.Dropdown>
      )}
      {!isNaturalPhraseBank && practiceStyle === "custom" && (
        <>
          <Form.Dropdown
            id="combination"
            title="Items per phrase"
            value={String(draft.combination)}
            onChange={(value) => updateSetting("combination", value)}
          >
            {[1, 2, 3, 5, 10, 20, 40].map((value) => (
              <Form.Dropdown.Item
                key={value}
                value={String(value)}
                title={String(value)}
              />
            ))}
          </Form.Dropdown>
          <Form.Dropdown
            id="repetition"
            title="Repeats"
            value={String(draft.repetition)}
            onChange={(value) => updateSetting("repetition", value)}
          >
            {[1, 2, 3, 5].map((value) => (
              <Form.Dropdown.Item
                key={value}
                value={String(value)}
                title={String(value)}
              />
            ))}
          </Form.Dropdown>
        </>
      )}
      <Form.Separator />
      <Form.Dropdown
        id="minimumWPM"
        title="Your WPM goal"
        info="Kept across lessons. Guided lessons use the higher of your goal and the lesson goal."
        value={goalValue(goalDraft.minimumWPM)}
        onChange={(value) =>
          setGoalDraft((previous) => ({
            ...previous,
            minimumWPM: parseGoal(value),
          }))
        }
      >
        <Form.Dropdown.Item
          value={GOAL_DEFAULT}
          title={
            lessonGoal !== undefined
              ? `Lesson default (${lessonGoal})`
              : `Default (${freeDefaultWPM})`
          }
        />
        {goalOptions([20, 30, 40, 50, 60, 80, 100], goalDraft.minimumWPM).map(
          (value) => (
            <Form.Dropdown.Item
              key={value}
              value={String(value)}
              title={String(value)}
            />
          ),
        )}
      </Form.Dropdown>
      <Form.Dropdown
        id="minimumAccuracy"
        title="Your accuracy goal"
        value={goalValue(goalDraft.minimumAccuracy)}
        onChange={(value) =>
          setGoalDraft((previous) => ({
            ...previous,
            minimumAccuracy: parseGoal(value),
          }))
        }
      >
        <Form.Dropdown.Item
          value={GOAL_DEFAULT}
          title={
            lessonGoal !== undefined
              ? "Lesson default"
              : `Default (${draft.minimumAccuracy}%)`
          }
        />
        {goalOptions([90, 95, 98, 100], goalDraft.minimumAccuracy).map(
          (value) => (
            <Form.Dropdown.Item
              key={value}
              value={String(value)}
              title={`${value}%`}
            />
          ),
        )}
      </Form.Dropdown>
      <Form.Checkbox
        id="soundEnabled"
        label="Typing sounds"
        defaultValue={soundEnabled}
        info="Key, mistake, pass, and retry feedback"
      />
    </Form>
  );
}
