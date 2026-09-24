import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGLISH_TRACK_V1,
  applyLesson,
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
import { createPracticeState } from "../src/logic";

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
  assert.match(
    formatTrackProgressDescription(last),
    /track complete$/,
  );
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
