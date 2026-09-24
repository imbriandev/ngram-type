import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGLISH_TRACK_V1,
  applyLesson,
  createProgress,
  firstLesson,
  getLesson,
  markLessonComplete,
  nextLesson,
  roundAverageMeetsLesson,
  settingsMatchLesson,
} from "../src/curriculum";
import {
  FOCUS_BANK_CAP,
  HISTORY_CAP,
  appendRound,
  createFocusBank,
  createHistory,
  focusTokens,
  recordFocusMiss,
  recordFocusSuccess,
} from "../src/focus";
import {
  createPracticeState,
  defaultSources,
  hydratePracticeState,
  newSession,
  serializePracticeState,
  sourcesForPicker,
} from "../src/logic";

/**
 * Lightweight logic e2e smoke: curriculum → applyLesson → seeded hydrate →
 * Focus bank → history cap. No Raycast UI automation.
 */
test("e2e smoke: curriculum, seed restore, focus practice, history cap", () => {
  // 1) Curriculum chain 1→11
  assert.equal(ENGLISH_TRACK_V1.length, 11);
  let cursor = firstLesson();
  const chain: string[] = [cursor.id];
  while (cursor.next) {
    const following = nextLesson(cursor.id);
    assert.ok(following, `broken next link at ${cursor.id}`);
    assert.equal(following.id, cursor.next);
    chain.push(following.id);
    cursor = following;
  }
  assert.deepEqual(
    chain,
    ENGLISH_TRACK_V1.map((lesson) => lesson.id),
  );
  assert.equal(cursor.id, "phrases-500-flow");
  assert.equal(cursor.next, null);

  // 2) applyLesson for every step leaves matching settings + fresh session
  let state = createPracticeState();
  let progress = createProgress();
  for (const lesson of ENGLISH_TRACK_V1) {
    state = applyLesson(state, lesson);
    progress = { ...progress, currentLessonId: lesson.id, mode: "guided" };
    assert.equal(state.source, lesson.source);
    assert.ok(settingsMatchLesson(state.settings[lesson.source], lesson));
    assert.equal(state.focusActive, false);
    const session = state.sessions[lesson.source];
    assert.ok(session.phrases.length > 0, `${lesson.id} must generate phrases`);
    assert.equal(session.phraseIndex, 0);
    assert.deepEqual(session.wpms, []);
    assert.ok(typeof session.seed === "number");

    // Qualifying round can mark complete and point at next
    assert.equal(
      roundAverageMeetsLesson([lesson.minWPM, lesson.minWPM + 2], lesson),
      true,
    );
    progress = markLessonComplete(progress, lesson.id, lesson.minWPM + 5);
  }
  assert.equal(progress.completedLessonIds.length, 11);
  assert.equal(getLesson(progress.currentLessonId)?.id, "phrases-500-flow");

  // 3) Seeded session restore: same phrases after serialize → hydrate
  const seedLesson = getLesson("bi-50-warmup");
  assert.ok(seedLesson);
  state = applyLesson(createPracticeState(), seedLesson);
  const before = state.sessions.bigrams;
  const midRound = {
    ...state,
    sessions: {
      ...state.sessions,
      bigrams: {
        ...before,
        phraseIndex: 3,
        wpms: [42, 44, 41],
        accuracies: [100, 100, 98],
      },
    },
  };
  const serialized = serializePracticeState(midRound);
  assert.equal("phrases" in serialized.sessions.bigrams, false);
  const restored = hydratePracticeState(serialized);
  assert.ok(restored);
  assert.deepEqual(restored.sessions.bigrams.phrases, before.phrases);
  assert.equal(restored.sessions.bigrams.phraseIndex, 3);
  assert.deepEqual(restored.sessions.bigrams.wpms, [42, 44, 41]);
  assert.equal(restored.sessions.bigrams.seed, before.seed);

  // 4) Focus bank record → practice values regenerate from those tokens
  let bank = createFocusBank();
  bank = recordFocusMiss(bank, "th", 100);
  bank = recordFocusMiss(bank, "he", 200);
  bank = recordFocusMiss(bank, "th", 300);
  bank = recordFocusMiss(bank, "an", 400);
  const tokens = focusTokens(bank);
  assert.deepEqual(tokens, ["th", "an", "he"]);

  const focusSettings = {
    ...createPracticeState().settings.bigrams,
    scope: tokens.length,
    combination: 2,
    repetition: 3,
  };
  const focusSession = newSession("bigrams", focusSettings, [], {
    seed: 9_001,
    values: tokens,
  });
  assert.ok(focusSession.phrases.length > 0);
  assert.ok(
    focusSession.phrases.every((phrase) =>
      phrase.split(/\s+/).every((part) => tokens.includes(part)),
    ),
    "Focus practice phrases must only use bank tokens",
  );

  const focusPersisted = hydratePracticeState({
    source: "bigrams",
    focusActive: true,
    sessions: {
      bigrams: {
        seed: 9_001,
        settings: focusSettings,
        phraseIndex: 1,
        wpms: [38],
        accuracies: [100],
        values: tokens,
      },
    },
  });
  assert.ok(focusPersisted);
  assert.equal(focusPersisted.focusActive, true);
  assert.deepEqual(
    focusPersisted.sessions.bigrams.phrases,
    focusSession.phrases,
  );
  assert.deepEqual(focusPersisted.sessions.bigrams.values, tokens);

  bank = recordFocusSuccess(bank, tokens);
  assert.deepEqual(focusTokens(bank), ["th"]);
  assert.ok(bank.entries.length <= FOCUS_BANK_CAP);

  // 5) History append + hard cap
  let history = createHistory();
  for (let i = 0; i < HISTORY_CAP + 12; i++) {
    history = appendRound(history, {
      at: 2_000 + i,
      lessonId: i % 2 === 0 ? "bi-50-warmup" : null,
      source: i % 3 === 0 ? "focus" : "bigrams",
      scope: i % 3 === 0 ? null : 50,
      avgWpm: 40 + (i % 20),
      accuracy: 100,
    });
  }
  assert.equal(history.rounds.length, HISTORY_CAP);
  assert.equal(history.rounds[0].at, 2_000 + HISTORY_CAP + 11);

  // Phrases stay demoted from the default picker but remain on the track
  assert.ok(!defaultSources.includes("english_phrases"));
  assert.ok(!sourcesForPicker().includes("english_phrases"));
  assert.ok(sourcesForPicker("english_phrases").includes("english_phrases"));
  assert.ok(
    ENGLISH_TRACK_V1.some((lesson) => lesson.source === "english_phrases"),
  );
});
