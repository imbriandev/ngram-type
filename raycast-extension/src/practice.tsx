import {
  Action,
  ActionPanel,
  Color,
  Form,
  Icon,
  List,
  LocalStorage,
  environment,
  getPreferenceValues,
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
  hydratePracticeState,
  isPhraseSource,
  metrics,
  newSession,
  PracticeState,
  recordAttempt,
  serializePracticeState,
  Source,
  SourceSettings,
  sources,
  sourcesForPicker,
  sourceTitles,
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
  recordFocusMiss,
  recordFocusSuccess,
  tokenAtIndex,
} from "./focus";
import {
  CURRICULUM_TRACK_ID,
  ENGLISH_TRACK_V1,
  PROGRESS_STORAGE_KEY,
  CurriculumProgress,
  Lesson,
  advanceToLesson,
  applyLesson,
  createProgress,
  firstLesson,
  formatLessonSubtitle,
  formatTrackProgressDescription,
  getLesson,
  hydrateProgress,
  isLessonCompleted,
  markLessonComplete,
  nextLesson,
  roundAverageMeetsLesson,
  settingsMatchLesson,
} from "./curriculum";

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
      join(environment.assetsPath, "sounds", file),
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
  const typingRef = useRef<Form.TextArea>(null);
  const session = state.sessions[state.source];
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
    ]).then(([rawState, rawProgress, rawFocus, rawHistory]) => {
      let nextState = createPracticeState();
      let nextProgress = createProgress();
      let nextFocus = createFocusBank();
      let nextHistory = createHistory();
      try {
        const saved = rawState ? (JSON.parse(rawState) as unknown) : undefined;
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

      if (nextProgress.mode === "guided" && !nextState.focusActive) {
        const lesson = getLesson(nextProgress.currentLessonId);
        if (lesson) {
          const currentSettings = nextState.settings[lesson.source];
          if (
            nextState.source !== lesson.source ||
            !settingsMatchLesson(currentSettings, lesson)
          ) {
            nextState = applyLesson(nextState, lesson);
          }
        }
      }

      setState(nextState);
      setProgress(nextProgress);
      setFocusBank(nextFocus);
      setHistory(nextHistory);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) {
      void LocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(serializePracticeState(state)),
      );
    }
  }, [loaded, state]);

  useEffect(() => {
    if (loaded) {
      void LocalStorage.setItem(
        PROGRESS_STORAGE_KEY,
        JSON.stringify(progress),
      );
    }
  }, [loaded, progress]);

  useEffect(() => {
    if (loaded) {
      void LocalStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(focusBank));
    }
  }, [loaded, focusBank]);

  useEffect(() => {
    if (loaded) {
      void LocalStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    }
  }, [loaded, history]);

  useEffect(() => {
    setTyped("");
    setStartedAt(null);
    setAttempt(createAttempt());
    setInputNotice(null);
    setCurrentMetrics(metrics(expected, "", null));
    if (!expected) setStatus("Add custom words in Settings");
    completing.current = false;
    typingRef.current?.focus();
  }, [state.source, expected]);

  const averageWPM = average(session?.wpms ?? []);
  const hasPhrase = Boolean(expected);
  const matchingCharacters = matchingPrefixLength(expected, typed);
  const hasMistake = matchingCharacters < typed.length;
  const feedback = inputNotice
    ? inputNotice
    : hasMistake
      ? `Fix character ${matchingCharacters + 1} · ${currentMetrics.accuracy}% accuracy`
      : startedAt
        ? `${typed.length}/${expected.length} characters · ${currentMetrics.accuracy}% accuracy`
        : status;
  const typingError =
    inputNotice ??
    (hasMistake
      ? `Expected ${readableCharacter(expected[matchingCharacters])}`
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
      const current = previous.sessions[previous.source];
      const values =
        previous.focusActive && current.values && current.values.length > 0
          ? current.values
          : previous.focusActive
            ? focusTokens(focusBank)
            : undefined;
      if (previous.focusActive && (!values || values.length === 0)) {
        return { ...previous, focusActive: false };
      }
      return {
        ...previous,
        sessions: {
          ...previous.sessions,
          [previous.source]: newSession(
            previous.source,
            previous.settings[previous.source],
            previous.customWords,
            values ? { values } : {},
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

    if (
      result.wpm < settings.minimumWPM ||
      result.accuracy < settings.minimumAccuracy
    ) {
      // Failed attempt: bank every token in the phrase for Focus practice.
      const failedTokens = expected.split(/\s+/).filter(Boolean);
      if (failedTokens.length > 0) {
        setFocusBank((previous) =>
          failedTokens.reduce(
            (bank, token) => recordFocusMiss(bank, token),
            previous,
          ),
        );
      }
      setCurrentMetrics(result);
      setLastResult(result);
      playSound("fail", state.soundEnabled);
      setTyped("");
      setStartedAt(null);
      setAttempt(createAttempt());
      setInputNotice(null);
      setStatus(
        `Retry · ${result.wpm} WPM · ${result.accuracy}% accuracy · goal ${settings.minimumWPM}/${settings.minimumAccuracy}%`,
      );
      completing.current = false;
      return;
    }

    const currentSession = state.sessions[state.source];
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

    if (finishedRound) {
      const summary: RoundSummary = {
        at: Date.now(),
        lessonId: activeLesson?.id ?? null,
        source: state.focusActive ? "focus" : state.source,
        scope: state.focusActive
          ? null
          : (settings.scope ?? null),
        avgWpm: roundAvg,
        accuracy: roundAccuracyAvg,
      };
      setHistory((previous) => appendRound(previous, summary));
    }

    if (
      activeLesson &&
      !state.focusActive &&
      finishedRound &&
      roundAverageMeetsLesson(roundWpms, activeLesson)
    ) {
      setProgress((previous) =>
        markLessonComplete(previous, activeLesson.id, roundAvg),
      );
      const following = nextLesson(activeLesson.id);
      setStatus(
        following
          ? `Lesson complete · avg ${roundAvg} WPM · Next: ${following.title}`
          : `Track complete · avg ${roundAvg} WPM · great work`,
      );
    } else {
      setStatus(
        `Passed · ${result.wpm} WPM · ${result.accuracy}% · next phrase ready`,
      );
    }

    setCurrentMetrics(result);
    setLastResult(result);
    playSound("pass", state.soundEnabled);
    setTyped("");
    setStartedAt(null);
    setAttempt(createAttempt());
    setInputNotice(null);
    completing.current = false;
  }

  function handleChange(value: string) {
    if (!expected) return;
    const next = value.trimStart();
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
    if (isWrong && edit.inserted.length === 1) {
      const token = tokenAtIndex(expected, edit.index);
      if (token) {
        setFocusBank((previous) => recordFocusMiss(previous, token));
      }
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
    setState((previous) => ({
      ...applyLesson(previous, lesson),
      focusActive: false,
    }));
  }

  function startFocusPractice() {
    const tokens = focusTokens(focusBank);
    if (tokens.length === 0) {
      setStatus("Focus bank empty · mistype to collect tokens");
      return;
    }
    setLastResult(null);
    setProgress((previous) =>
      previous.mode === "guided" ? { ...previous, mode: "free" } : previous,
    );
    setState((previous) => {
      const base = previous.settings[previous.source];
      const focusSettings = {
        ...base,
        scope: tokens.length,
        combination: Math.min(2, tokens.length),
        repetition: 3,
      };
      return {
        ...previous,
        focusActive: true,
        sessions: {
          ...previous.sessions,
          [previous.source]: newSession(
            previous.source,
            focusSettings,
            previous.customWords,
            { values: tokens },
          ),
        },
      };
    });
    setStatus(`Focus · ${tokens.length} tokens from recent misses`);
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
    setState((previous) => ({ ...previous, focusActive: false }));
    setStatus("Free practice · change dataset anytime in Settings");
  }

  function resumeGuidedTrack() {
    const lesson = getLesson(progress.currentLessonId) ?? firstLesson();
    startLesson(lesson, `Resume guided · ${lesson.title}`);
  }

  function changeSource(value: string) {
    if (value in sourceTitles) {
      setLastResult(null);
      setStatus("Start typing when ready");
      setProgress((previous) =>
        previous.mode === "guided" ? { ...previous, mode: "free" } : previous,
      );
      setState((previous) => ({
        ...previous,
        source: value as Source,
        focusActive: false,
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
  ) {
    setStatus("New settings ready");
    setLastResult(null);
    setProgress((previous) => {
      if (previous.mode !== "guided") return previous;
      const lesson = getLesson(previous.currentLessonId);
      if (
        lesson &&
        source === lesson.source &&
        settingsMatchLesson(nextSettings[lesson.source], lesson)
      ) {
        return previous;
      }
      return { ...previous, mode: "free" };
    });
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
        settings: nextSettings,
        sessions,
        focusActive: false,
      };
    });
    navigation.pop();
  }

  if (!loaded) return null;

  return (
    <Form
      navigationTitle={
        state.focusActive
          ? `Focus · ${focusBank.entries.length} tokens${hasPhrase ? ` · ${(session?.phraseIndex ?? 0) + 1}/${session?.phrases.length ?? 0}` : ""}`
          : guided
            ? `${guided.title}${hasPhrase ? ` · ${(session?.phraseIndex ?? 0) + 1}/${session?.phrases.length ?? 0}` : ""}`
            : `Ngram Type · ${sourceTitles[state.source]} · ${hasPhrase ? `${(session?.phraseIndex ?? 0) + 1}/${session?.phrases.length ?? 0}` : "Setup"}`
      }
      actions={
        <ActionPanel>
          {/* Primary action = Return/Enter. Reset Phrase must stay first. */}
          {hasPhrase && (
            <ActionPanel.Section title="Practice">
              <Action
                title="Reset Phrase"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: [], key: "return" }}
                onAction={() => resetPhrase()}
              />
              <Action
                title="New Round"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                onAction={restartRound}
              />
              <Action
                title={
                  state.soundEnabled
                    ? "Mute Typing Sounds"
                    : "Enable Typing Sounds"
                }
                icon={Icon.Music}
                shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
                onAction={toggleSound}
              />
              <Action.CopyToClipboard title="Copy Phrase" content={expected} />
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
            {guided && canAdvanceLesson && guided.next && (
              <Action
                title="Next Lesson"
                icon={Icon.ArrowRight}
                shortcut={{ modifiers: ["cmd"], key: "return" }}
                onAction={goToNextLesson}
              />
            )}
            {guided && (
              <Action
                title="Retry Lesson"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["cmd", "shift"], key: "l" }}
                onAction={retryLesson}
              />
            )}
            {guided && (
              <Action
                title="Jump to Free Practice"
                icon={Icon.Tray}
                shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                onAction={jumpToFreePractice}
              />
            )}
          </ActionPanel.Section>
          <ActionPanel.Section title="Reflex">
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
            <Action.Push
              title="Open History"
              icon={Icon.Clock}
              shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
              target={<HistoryList history={history} />}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Configure">
            <Action.Push
              title="Practice Settings"
              icon={Icon.Gear}
              target={
                <SettingsForm
                  source={state.source}
                  settings={state.settings}
                  customWords={state.customWords}
                  soundEnabled={state.soundEnabled}
                  onSave={saveSettings}
                />
              }
            />
            <ActionPanel.Submenu
              title="Change Dataset"
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
        title="Track"
        text={
          state.focusActive
            ? `Focus · ${focusBank.entries.length} recent misses · Amphetype-style drill`
            : formatTrackProgressDescription(progress)
        }
      />
      <Form.Description
        title="Type this"
        text={expected || "Add custom words in Practice Settings"}
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
          info="Completion is automatic. Correct mistakes with Delete."
        />
      ) : (
        <Form.Description
          title="Your turn"
          text="Open Practice Settings and add words to begin."
        />
      )}
      <Form.Description title="Feedback" text={feedback} />
      <Form.Description
        title="Goal"
        text={`${settings.minimumWPM} WPM · ${settings.minimumAccuracy}% accuracy · round average ${averageWPM || "—"} WPM${lastResult ? ` · last ${lastResult.wpm}/${lastResult.accuracy}%` : ""}${guidedCompleted ? " · lesson complete" : ""}${canAdvanceLesson && guided?.next ? " · Next lesson ready" : ""}`}
      />
    </Form>
  );
}


function HistoryList({ history }: { history: PracticeHistory }) {
  return (
    <List navigationTitle="Practice History">
      {history.rounds.length === 0 ? (
        <List.EmptyView
          title="No rounds yet"
          description="Finish a round to see average WPM and accuracy here."
        />
      ) : (
        history.rounds.map((round, index) => (
          <List.Item
            key={`${round.at}-${index}`}
            title={formatRoundTitle(round)}
            subtitle={formatRoundSubtitle(round)}
            icon={round.source === "focus" ? Icon.BullsEye : Icon.BarChart}
            accessories={[
              {
                tag: {
                  value: `${round.avgWpm} WPM`,
                  color: Color.Blue,
                },
              },
              {
                tag: {
                  value: `${round.accuracy}%`,
                  color: round.accuracy >= 100 ? Color.Green : Color.Orange,
                },
              },
            ]}
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
    <List navigationTitle={`Curriculum · ${CURRICULUM_TRACK_ID}`}>
      {ENGLISH_TRACK_V1.map((lesson, index) => {
        const completed = isLessonCompleted(progress, lesson.id);
        const isCurrent = lesson.id === progress.currentLessonId;
        const accessories: List.Item.Accessory[] = [];
        if (completed) {
          accessories.push({
            icon: Icon.CheckCircle,
            tooltip: "Done",
          });
        }
        if (isCurrent) {
          accessories.push({
            tag: { value: "Current", color: Color.Blue },
          });
        } else if (!completed) {
          accessories.push({
            tag: { value: "Pending", color: Color.SecondaryText },
          });
        }

        return (
          <List.Item
            key={lesson.id}
            title={`${index + 1}. ${lesson.title}`}
            subtitle={formatLessonSubtitle(lesson)}
            icon={
              isCurrent
                ? Icon.Play
                : completed
                  ? Icon.CheckCircle
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
                  shortcut={{ modifiers: ["cmd"], key: "return" }}
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
    </List>
  );
}

function SettingsForm({
  source,
  settings,
  customWords,
  soundEnabled,
  onSave,
}: {
  source: Source;
  settings: Record<Source, SourceSettings>;
  customWords: string[];
  soundEnabled: boolean;
  onSave: (
    source: Source,
    settings: Record<Source, SourceSettings>,
    customWords: string[],
    soundEnabled: boolean,
  ) => void;
}) {
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
    );
  }

  return (
    <Form
      navigationTitle={`${sourceTitles[selectedSource]} settings`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Start Practice"
            icon={Icon.CheckCircle}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Session"
        text="Changes are kept for every dataset until you start practice."
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
        <Form.Description title="Scope" text="All custom words" />
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
        title="Minimum WPM"
        value={String(draft.minimumWPM)}
        onChange={(value) => updateSetting("minimumWPM", value)}
      >
        {[20, 30, 40, 50, 60, 80, 100].map((value) => (
          <Form.Dropdown.Item
            key={value}
            value={String(value)}
            title={String(value)}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="minimumAccuracy"
        title="Minimum accuracy"
        value={String(draft.minimumAccuracy)}
        onChange={(value) => updateSetting("minimumAccuracy", value)}
      >
        {[90, 95, 98, 100].map((value) => (
          <Form.Dropdown.Item
            key={value}
            value={String(value)}
            title={`${value}%`}
          />
        ))}
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
