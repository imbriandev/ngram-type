import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGLISH_TRACK_V1,
  LESSON_ROUND_PHRASES,
  applyLesson,
  effectiveGoals,
  ensureLessonSession,
  migrateLegacyGoals,
  createProgress,
  firstLesson,
  formatLessonSubtitle,
  formatTrackProgressDescription,
  getLesson,
  hydrateProgress,
  isGuidedSource,
  lessonForSourceSettings,
  lessonIndex,
  lessonSettings,
  markLessonComplete,
  nextLesson,
  roundAverageMeetsLesson,
  settingsMatchLesson,
} from "../src/curriculum";
import {
  createPracticeState,
  createUserGoals,
  hydratePracticeState,
  newSession,
  serializePracticeState,
  PracticeState,
  SourceSettings,
  UserGoals,
} from "../src/logic";

test("english-v1 track chains every lesson through next links", () => {
  assert.equal(ENGLISH_TRACK_V1.length, 11);
  assert.equal(firstLesson().id, "bi-50-warmup");
  assert.equal(ENGLISH_TRACK_V1.at(-1)?.next, null);

  let current = firstLesson();
  const visited: string[] = [current.id];
  while (current.next) {
    const following = nextLesson(current.id);
    assert.ok(following, `missing next for ${current.id}`);
    assert.equal(following.id, current.next);
    visited.push(following.id);
    current = following;
  }

  assert.deepEqual(
    visited,
    ENGLISH_TRACK_V1.map((lesson) => lesson.id),
  );
  assert.equal(getLesson("missing"), undefined);
  assert.equal(nextLesson("core-200-flow")?.id, "phrases-200-flow");
  assert.equal(nextLesson("phrases-500-flow"), undefined);
});

test("english-v1 lessons use Warm-up → Build → Flow with accuracy 100", () => {
  const early = ENGLISH_TRACK_V1.slice(0, 3);
  const mid = ENGLISH_TRACK_V1.slice(3, 7);
  const coreFlow = ENGLISH_TRACK_V1.slice(7, 9);
  const phrasesFlow = ENGLISH_TRACK_V1.slice(9);

  for (const lesson of early) {
    assert.equal(lesson.preset, "warm_up");
    assert.equal(lesson.combination, 2);
    assert.equal(lesson.repetition, 3);
    assert.equal(lesson.minWPM, 40);
    assert.equal(lesson.minAccuracy, 100);
  }
  for (const lesson of mid) {
    assert.equal(lesson.preset, "build");
    assert.equal(lesson.combination, 5);
    assert.equal(lesson.repetition, 2);
    assert.equal(lesson.minAccuracy, 100);
  }
  for (const lesson of coreFlow) {
    assert.equal(lesson.preset, "flow");
    assert.equal(lesson.combination, 20);
    assert.equal(lesson.repetition, 1);
    assert.ok(lesson.minWPM >= 45);
    assert.equal(lesson.minAccuracy, 100);
  }
  for (const lesson of phrasesFlow) {
    assert.equal(lesson.preset, "flow");
    assert.equal(lesson.source, "english_phrases");
    assert.equal(lesson.combination, 20);
    assert.equal(lesson.repetition, 1);
    assert.equal(lesson.minWPM, 40);
    assert.equal(lesson.minAccuracy, 100);
  }

  assert.deepEqual(
    ENGLISH_TRACK_V1.map((lesson) => [lesson.source, lesson.scope]),
    [
      ["bigrams", 50],
      ["bigrams", 100],
      ["trigrams", 50],
      ["trigrams", 100],
      ["tetragrams", 50],
      ["tetragrams", 100],
      ["english_core", 50],
      ["english_core", 100],
      ["english_core", 200],
      ["english_phrases", 200],
      ["english_phrases", 500],
    ],
  );
});

test("isGuidedSource covers track datasets only", () => {
  assert.equal(isGuidedSource("bigrams"), true);
  assert.equal(isGuidedSource("english_core"), true);
  assert.equal(isGuidedSource("custom_words"), false);
  assert.equal(isGuidedSource("words"), false);
  assert.equal(isGuidedSource("english_phrases"), true);
});

test("lessonForSourceSettings matches drill shape", () => {
  const lesson = lessonForSourceSettings("tetragrams", {
    scope: 100,
    combination: 5,
    repetition: 2,
  });
  assert.equal(lesson?.id, "tetra-100-build");
  assert.equal(
    lessonForSourceSettings("bigrams", {
      scope: 50,
      combination: 20,
      repetition: 1,
    }),
    undefined,
  );
});

test("hydrateProgress sanitizes corrupt progress defensively", () => {
  const restored = hydrateProgress({
    version: 99,
    trackId: "",
    currentLessonId: "not-a-lesson",
    completedLessonIds: ["bi-50-warmup", "bogus", 3, "bi-50-warmup"],
    bestWpmByLesson: {
      "bi-50-warmup": 55.7,
      missing: 90,
      "bi-100-warmup": -1,
      "tri-50-warmup": "fast",
    },
    mode: "maybe",
  });

  assert.equal(restored.version, 1);
  assert.equal(restored.trackId, "english-v1");
  assert.equal(restored.currentLessonId, "bi-50-warmup");
  assert.deepEqual(restored.completedLessonIds, ["bi-50-warmup"]);
  assert.deepEqual(restored.bestWpmByLesson, { "bi-50-warmup": 56 });
  assert.equal(restored.mode, "guided");
});

test("hydrateProgress preserves a valid saved checkpoint", () => {
  const saved = createProgress("tri-100-build");
  saved.mode = "free";
  saved.completedLessonIds = ["bi-50-warmup", "bi-100-warmup"];
  saved.bestWpmByLesson = { "bi-50-warmup": 62 };

  const restored = hydrateProgress(saved);
  assert.equal(restored.currentLessonId, "tri-100-build");
  assert.equal(restored.mode, "free");
  assert.deepEqual(restored.completedLessonIds, [
    "bi-50-warmup",
    "bi-100-warmup",
  ]);
  assert.equal(restored.bestWpmByLesson["bi-50-warmup"], 62);
});

test("applyLesson sets source settings and starts a matching session", () => {
  const lesson = getLesson("core-100-flow");
  assert.ok(lesson);
  const state = applyLesson(createPracticeState(), lesson);

  assert.equal(state.source, "english_core");
  assert.deepEqual(state.settings.english_core, lessonSettings(lesson));
  assert.ok(settingsMatchLesson(state.settings.english_core, lesson));
  assert.equal(state.sessions.english_core.phraseIndex, 0);
  assert.deepEqual(state.sessions.english_core.wpms, []);
  // Flow 20×1 over top 100 → 5 phrases
  assert.equal(state.sessions.english_core.phrases.length, 5);
});

test("markLessonComplete and round gate track progress", () => {
  const lesson = getLesson("bi-50-warmup");
  assert.ok(lesson);
  let progress = createProgress(lesson.id);
  assert.equal(roundAverageMeetsLesson([38, 39], lesson), false);
  assert.equal(roundAverageMeetsLesson([40, 44], lesson), true);

  progress = markLessonComplete(progress, lesson.id, 43);
  progress = markLessonComplete(progress, lesson.id, 41);
  assert.deepEqual(progress.completedLessonIds, ["bi-50-warmup"]);
  assert.equal(progress.bestWpmByLesson["bi-50-warmup"], 43);
});

test("formatTrackProgressDescription covers guided and free modes", () => {
  const guided = createProgress("bi-50-warmup");
  assert.match(
    formatTrackProgressDescription(guided),
    /^Guided · 1\/11 · 0 done · Bi · Top 50 · Warm-up → next: Bi · Top 100 · Warm-up$/,
  );

  guided.completedLessonIds = ["bi-50-warmup"];
  guided.currentLessonId = "bi-100-warmup";
  assert.match(
    formatTrackProgressDescription(guided),
    /^Guided · 2\/11 · 1 done · Bi · Top 100 · Warm-up → next: Tri · Top 50 · Warm-up$/,
  );

  const free = createProgress("tri-50-warmup");
  free.mode = "free";
  assert.equal(
    formatTrackProgressDescription(free),
    "Free practice · Resume Guided Track from Actions",
  );

  const last = createProgress("phrases-500-flow");
  last.completedLessonIds = ENGLISH_TRACK_V1.map((lesson) => lesson.id);
  assert.match(formatTrackProgressDescription(last), /track complete$/);
});

test("lessonIndex and formatLessonSubtitle describe track entries", () => {
  assert.equal(lessonIndex("bi-50-warmup"), 1);
  assert.equal(lessonIndex("core-200-flow"), 9);
  assert.equal(lessonIndex("phrases-500-flow"), 11);
  assert.equal(lessonIndex("missing"), 0);

  const lesson = getLesson("tetra-100-build");
  assert.ok(lesson);
  assert.equal(
    formatLessonSubtitle(lesson),
    "Tetragrams · Top 100 · Build · 40 WPM",
  );
});

test("guided lesson rounds are capped to LESSON_ROUND_PHRASES for every lesson", () => {
  for (const lesson of ENGLISH_TRACK_V1) {
    const state = applyLesson(createPracticeState(), lesson);
    const session = state.sessions[lesson.source];
    assert.ok(session.phrases.length > 0);
    assert.ok(
      session.phrases.length <= LESSON_ROUND_PHRASES,
      `${lesson.id}: ${session.phrases.length}`,
    );
    assert.equal(session.maxPhrases, LESSON_ROUND_PHRASES);
  }
  const phrases = getLesson("phrases-500-flow");
  assert.ok(phrases);
  assert.equal(
    applyLesson(createPracticeState(), phrases).sessions.english_phrases.phrases
      .length,
    LESSON_ROUND_PHRASES,
  );
});

test("ensureLessonSession keeps an in-progress lesson round (Resume/Start current)", () => {
  const lesson = getLesson("tri-100-build");
  assert.ok(lesson);
  const applied = applyLesson(createPracticeState(), lesson);
  const inProgress = {
    ...applied,
    sessions: {
      ...applied.sessions,
      trigrams: {
        ...applied.sessions.trigrams,
        phraseIndex: 7,
        wpms: [40, 41, 42, 43, 44, 45, 46],
        accuracies: [100, 100, 100, 100, 100, 100, 100],
      },
    },
  };
  // Simulate leaving to free practice on another dataset, then resuming.
  const away = { ...inProgress, source: "bigrams" as const };
  const resumed = ensureLessonSession(away, lesson);
  assert.equal(resumed.source, "trigrams");
  assert.equal(resumed.sessions.trigrams, inProgress.sessions.trigrams);
  assert.equal(resumed.sessions.trigrams.phraseIndex, 7);
  assert.equal(resumed.sessions.trigrams.wpms.length, 7);

  // A different lesson on the same dataset starts fresh.
  const other = getLesson("tri-50-warmup");
  assert.ok(other);
  const switched = ensureLessonSession(inProgress, other);
  assert.equal(switched.sessions.trigrams.phraseIndex, 0);
  assert.ok(settingsMatchLesson(switched.sessions.trigrams.settings, other));
});

test("ensureLessonSession migrates older uncapped lesson sessions gracefully", () => {
  const lesson = getLesson("phrases-200-flow");
  assert.ok(lesson);
  const base = createPracticeState();
  const oldSession = newSession("english_phrases", lessonSettings(lesson), [], {
    seed: 321,
  });
  assert.equal(oldSession.phrases.length, 200);
  const withOld = (phraseIndex: number) => ({
    ...base,
    sessions: {
      ...base.sessions,
      english_phrases: {
        ...oldSession,
        phraseIndex,
        wpms: Array(phraseIndex).fill(40),
        accuracies: Array(phraseIndex).fill(100),
      },
    },
  });

  // Progress fits inside the cap → same seed, same first phrases, progress kept.
  const kept = ensureLessonSession(withOld(3), lesson).sessions.english_phrases;
  assert.equal(kept.seed, 321);
  assert.equal(kept.phrases.length, LESSON_ROUND_PHRASES);
  assert.deepEqual(
    kept.phrases,
    oldSession.phrases.slice(0, LESSON_ROUND_PHRASES),
  );
  assert.equal(kept.phraseIndex, 3);
  assert.equal(kept.wpms.length, 3);

  // Progress beyond the cap → fresh capped round, no crash.
  const fresh = ensureLessonSession(withOld(150), lesson).sessions
    .english_phrases;
  assert.equal(fresh.phraseIndex, 0);
  assert.equal(fresh.phrases.length, LESSON_ROUND_PHRASES);

  // Hydrating the old persisted shape also works end to end.
  const hydrated = hydratePracticeState(serializePracticeState(withOld(150)));
  assert.ok(hydrated);
  assert.equal(hydrated.sessions.english_phrases.phrases.length, 200);
  const migrated = ensureLessonSession(hydrated, lesson);
  assert.equal(
    migrated.sessions.english_phrases.phrases.length,
    LESSON_ROUND_PHRASES,
  );
});

test("user goals survive lesson change, Next, Retry, Resume, and Start", () => {
  const goals: UserGoals = { minimumWPM: 80, minimumAccuracy: null };
  let state: PracticeState = { ...createPracticeState(), goals };
  const first = getLesson("bi-50-warmup");
  assert.ok(first);
  state = applyLesson(state, first); // Curriculum start / Retry
  assert.deepEqual(state.goals, goals);
  const following = nextLesson(first.id); // Next Lesson
  assert.ok(following);
  state = ensureLessonSession(state, following);
  assert.deepEqual(state.goals, goals);
  state = ensureLessonSession(state, following); // Resume current
  assert.deepEqual(state.goals, goals);
  state = applyLesson(state, following); // Retry
  assert.deepEqual(state.goals, goals);

  // Persisted through serialize/hydrate (state v7).
  const restored = hydratePracticeState(serializePracticeState(state));
  assert.ok(restored);
  assert.deepEqual(restored.goals, goals);
  assert.equal(
    effectiveGoals(restored.goals, following, restored.settings.bigrams)
      .minimumWPM,
    80,
  );
});

test("effective goal = max(user, lesson); unset uses lesson; free uses user/default", () => {
  const lesson = getLesson("core-200-flow"); // 50 WPM, 100%
  assert.ok(lesson);
  const fallback = { minimumWPM: 40, minimumAccuracy: 100 };

  const unset = effectiveGoals(createUserGoals(), lesson, fallback);
  assert.equal(unset.minimumWPM, 50);
  assert.equal(unset.wpmSource, "lesson");

  const higher = effectiveGoals(
    { minimumWPM: 80, minimumAccuracy: null },
    lesson,
    fallback,
  );
  assert.equal(higher.minimumWPM, 80);
  assert.equal(higher.wpmSource, "yours");

  const lower = effectiveGoals(
    { minimumWPM: 30, minimumAccuracy: 95 },
    lesson,
    fallback,
  );
  assert.equal(lower.minimumWPM, 50, "lesson goal is a floor in guided mode");
  assert.equal(lower.wpmSource, "lesson");
  assert.equal(lower.minimumAccuracy, 100);

  // Free mode (no lesson): user goal, else dataset default.
  const free = effectiveGoals(
    { minimumWPM: 30, minimumAccuracy: 95 },
    undefined,
    fallback,
  );
  assert.equal(free.minimumWPM, 30);
  assert.equal(free.minimumAccuracy, 95);
  assert.equal(free.accuracySource, "yours");
  const freeDefault = effectiveGoals(createUserGoals(), undefined, fallback);
  assert.equal(freeDefault.minimumWPM, 40);
  assert.equal(freeDefault.wpmSource, "default");

  // Lesson completion uses the effective goal.
  assert.equal(
    roundAverageMeetsLesson([60, 62], lesson, higher.minimumWPM),
    false,
  );
  assert.equal(
    roundAverageMeetsLesson([80, 82], lesson, higher.minimumWPM),
    true,
  );
  assert.equal(roundAverageMeetsLesson([60, 62], lesson), true);
});

test("goal-only changes still match the lesson (no leaving guided)", () => {
  const lesson = getLesson("bi-50-warmup");
  assert.ok(lesson);
  const goalChanged: SourceSettings = {
    ...lessonSettings(lesson),
    minimumWPM: 80,
    minimumAccuracy: 95,
  };
  assert.ok(settingsMatchLesson(goalChanged, lesson));
  const shapeChanged: SourceSettings = {
    ...lessonSettings(lesson),
    scope: 100,
  };
  assert.equal(settingsMatchLesson(shapeChanged, lesson), false);
});

test("legacy saved goals migrate; state without goals hydrates as unset", () => {
  const legacy = hydratePracticeState({ source: "bigrams" });
  assert.ok(legacy);
  assert.deepEqual(legacy.goals, createUserGoals());

  const lesson = getLesson("bi-50-warmup");
  assert.ok(lesson);
  const base = createPracticeState();
  const custom = {
    ...base,
    settings: {
      ...base.settings,
      bigrams: { ...base.settings.bigrams, minimumWPM: 80 },
    },
  };
  assert.deepEqual(migrateLegacyGoals(custom, lesson), {
    minimumWPM: 80,
    minimumAccuracy: null,
  });
  assert.deepEqual(migrateLegacyGoals(base, lesson), createUserGoals());
  assert.deepEqual(migrateLegacyGoals(custom, undefined, 40).minimumWPM, 80);
  assert.deepEqual(migrateLegacyGoals(base, undefined, 40), createUserGoals());
});
