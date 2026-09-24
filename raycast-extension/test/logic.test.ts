import assert from "node:assert/strict";
import test from "node:test";
import {
  availableScopes,
  completeSessionPhrase,
  createAttempt,
  createPracticeState,
  defaultSources,
  describeTextEdit,
  generatePhrases,
  hydratePracticeState,
  isPhraseSource,
  metrics,
  recordAttempt,
  sourcesForPicker,
} from "../src/logic";
import { englishCoreWords, englishPhrases } from "../src/data";

test("records corrected mistakes across a completed phrase", () => {
  const expected = "test";
  let attempt = createAttempt();

  attempt = recordAttempt(attempt, expected, describeTextEdit("", "t"));
  attempt = recordAttempt(attempt, expected, describeTextEdit("t", "tx"));
  attempt = recordAttempt(attempt, expected, describeTextEdit("tx", "t"));
  attempt = recordAttempt(attempt, expected, describeTextEdit("t", "te"));
  attempt = recordAttempt(attempt, expected, describeTextEdit("te", "tes"));
  attempt = recordAttempt(attempt, expected, describeTextEdit("tes", "test"));

  assert.deepEqual(attempt, { correctKeystrokes: 4, wrongKeystrokes: 1 });
  assert.equal(
    metrics(expected, expected, 1_000, 61_000, attempt).accuracy,
    80,
  );
});

test("describes multi-character input so the UI can reject paste", () => {
  assert.deepEqual(describeTextEdit("te", "test"), {
    index: 2,
    inserted: "st",
    removed: "",
  });
  assert.deepEqual(describeTextEdit("tezt", "test"), {
    index: 2,
    inserted: "s",
    removed: "z",
  });
});

test("calculates WPM when an attempt starts at timestamp zero", () => {
  assert.equal(metrics("hello", "hello", 0, 60_000).wpm, 1);
});

test("starts a clean round after the final phrase", () => {
  const state = createPracticeState();
  const settings = state.settings.bigrams;
  const first = completeSessionPhrase(
    { phrases: ["th", "he"], phraseIndex: 0, wpms: [] },
    "bigrams",
    settings,
    [],
    50,
  );
  assert.deepEqual(first, {
    phrases: ["th", "he"],
    phraseIndex: 1,
    wpms: [50],
  });

  const nextRound = completeSessionPhrase(first, "bigrams", settings, [], 60);
  assert.equal(nextRound.phraseIndex, 0);
  assert.deepEqual(nextRound.wpms, []);
  assert.equal(nextRound.phrases.length, 25);
});

test("hydrates a malformed saved state into a safe session", () => {
  const restored = hydratePracticeState({
    source: "words",
    soundEnabled: false,
    customWords: [" alpha ", "", 3, "beta"],
    settings: {
      words: {
        scope: 999,
        combination: 0,
        repetition: "three",
        minimumWPM: -1,
        minimumAccuracy: 200,
      },
    },
    sessions: {
      words: { phrases: ["the"], phraseIndex: 99, wpms: [45] },
    },
  });

  assert.ok(restored);
  assert.equal(restored.source, "words");
  assert.equal(restored.soundEnabled, false);
  assert.deepEqual(restored.customWords, ["alpha", "beta"]);
  assert.deepEqual(restored.settings.words, {
    scope: 50,
    combination: 2,
    repetition: 3,
    minimumWPM: 40,
    minimumAccuracy: 100,
  });
  assert.equal(restored.sessions.words.phraseIndex, 0);
  assert.equal(restored.sessions.words.phrases.length, 25);
});

test("preserves valid saved progress and trims stale round statistics", () => {
  const state = createPracticeState();
  state.source = "words";
  state.sessions.words = {
    phrases: ["the", "and", "of"],
    phraseIndex: 1,
    wpms: [48, 52],
  };

  const restored = hydratePracticeState(state);
  assert.ok(restored);
  assert.deepEqual(restored.sessions.words, {
    phrases: ["the", "and", "of"],
    phraseIndex: 1,
    wpms: [48],
  });
});

test("generates a non-empty phrase for each built-in practice preset", () => {
  const state = createPracticeState();
  for (const settings of [
    { ...state.settings.bigrams, combination: 2, repetition: 3 },
    { ...state.settings.bigrams, combination: 5, repetition: 2 },
    { ...state.settings.bigrams, combination: 20, repetition: 1 },
  ]) {
    const phrases = generatePhrases("bigrams", settings, []);
    assert.ok(phrases.length > 0);
    assert.ok(phrases.every(Boolean));
  }
});

test("ships a validated English Core 5k bank with capped scopes", () => {
  assert.equal(englishCoreWords.length, 5_000);
  assert.equal(new Set(englishCoreWords).size, englishCoreWords.length);
  assert.ok(englishCoreWords.every((word) => /^[a-z]+$/.test(word)));
  assert.ok(englishCoreWords.includes("a"));
  assert.ok(englishCoreWords.includes("i"));
  assert.equal(englishCoreWords.includes("g"), false);
  assert.equal(englishCoreWords.includes("fa"), false);
  assert.deepEqual(availableScopes("english_core"), [50, 100, 150, 200]);
  assert.equal(createPracticeState().sessions.english_core.phrases.length, 25);
});

test("clamps hydrated English Core scope down to 200", () => {
  const restored = hydratePracticeState({
    source: "english_core",
    settings: {
      english_core: {
        scope: 5_000,
        combination: 2,
        repetition: 3,
        minimumWPM: 40,
        minimumAccuracy: 100,
      },
    },
  });
  assert.ok(restored);
  assert.equal(restored.settings.english_core.scope, 200);
});

test("hides Words and English Phrases from the default picker", () => {
  assert.deepEqual(defaultSources, [
    "bigrams",
    "trigrams",
    "tetragrams",
    "english_core",
    "custom_words",
  ]);
  assert.deepEqual(sourcesForPicker(), defaultSources);
  assert.ok(!sourcesForPicker().includes("words"));
  assert.ok(!sourcesForPicker().includes("english_phrases"));
  assert.deepEqual(sourcesForPicker("words"), [...defaultSources, "words"]);
  assert.deepEqual(sourcesForPicker("english_phrases"), [
    ...defaultSources,
    "english_phrases",
  ]);
});

test("keeps a hydrated Words or Phrases source mid-session", () => {
  const wordsState = hydratePracticeState({ source: "words" });
  assert.ok(wordsState);
  assert.equal(wordsState.source, "words");

  const phrasesState = hydratePracticeState({ source: "english_phrases" });
  assert.ok(phrasesState);
  assert.equal(phrasesState.source, "english_phrases");
});

test("ships English Phrases as natural, punctuated sentences", () => {
  const state = createPracticeState();
  const settings = {
    ...state.settings.english_phrases,
    combination: 20,
    repetition: 3,
  };
  const phrases = generatePhrases("english_phrases", settings, []);

  assert.equal(englishPhrases.length, 2_000);
  assert.equal(new Set(englishPhrases).size, englishPhrases.length);
  assert.ok(
    englishPhrases.every((phrase) => /^[A-Z].*[.!?]["']?$/.test(phrase)),
  );
  for (const mark of [",", ":", ";", "?", "!", "'", "-", "/"]) {
    assert.ok(englishPhrases.some((phrase) => phrase.includes(mark)));
  }
  assert.ok(isPhraseSource("english_phrases"));
  assert.equal(isPhraseSource("english_core"), false);
  assert.deepEqual(
    availableScopes("english_phrases"),
    [50, 100, 150, 200, 500, 1_000, 2_000],
  );
  assert.equal(phrases.length, 50);
  assert.ok(phrases.every((phrase) => englishPhrases.includes(phrase)));
});
