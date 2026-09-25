import assert from "node:assert/strict";
import test from "node:test";
import {
  availableScopes,
  completeSessionPhrase,
  createAttempt,
  createPracticeState,
  defaultSources,
  describeTextEdit,
  exitFocus,
  FOCUS_GENERATION_SOURCE,
  generatePhrases,
  instantFailIndex,
  hydratePracticeState,
  isPhraseSource,
  metrics,
  newSession,
  recordAttempt,
  sanitizeTypedInput,
  serializePracticeState,
  sourcesForPicker,
  startFocus,
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
  const seeded = newSession("bigrams", settings, [], {
    seed: 99,
    values: ["th", "he"],
  });
  // Force a 2-phrase session for the advance check.
  const first = completeSessionPhrase(
    {
      ...seeded,
      phrases: ["th", "he"],
      phraseIndex: 0,
      wpms: [],
      accuracies: [],
    },
    "bigrams",
    settings,
    [],
    50,
    100,
  );
  assert.equal(first.phraseIndex, 1);
  assert.deepEqual(first.wpms, [50]);
  assert.deepEqual(first.accuracies, [100]);

  const nextRound = completeSessionPhrase(
    first,
    "bigrams",
    settings,
    [],
    60,
    98,
  );
  assert.equal(nextRound.phraseIndex, 0);
  assert.deepEqual(nextRound.wpms, []);
  assert.deepEqual(nextRound.accuracies, []);
  assert.ok(nextRound.phrases.length > 0);
  assert.ok(typeof nextRound.seed === "number");
});

test("same seed regenerates identical phrases", () => {
  const settings = createPracticeState().settings.bigrams;
  const a = generatePhrases("bigrams", settings, [], { seed: 42 });
  const b = generatePhrases("bigrams", settings, [], { seed: 42 });
  const c = generatePhrases("bigrams", settings, [], { seed: 43 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 25);
});

test("hydrate restores mid-round progress from seed without phrases", () => {
  const session = newSession(
    "bigrams",
    createPracticeState().settings.bigrams,
    [],
    { seed: 1_234_567 },
  );
  const persisted = {
    source: "bigrams",
    soundEnabled: true,
    focusActive: false,
    customWords: [],
    settings: createPracticeState().settings,
    sessions: {
      bigrams: {
        seed: session.seed,
        settings: session.settings,
        phraseIndex: 2,
        wpms: [40, 45],
        accuracies: [100, 98],
      },
    },
  };

  const restored = hydratePracticeState(persisted);
  assert.ok(restored);
  assert.deepEqual(restored.sessions.bigrams.phrases, session.phrases);
  assert.equal(restored.sessions.bigrams.phraseIndex, 2);
  assert.deepEqual(restored.sessions.bigrams.wpms, [40, 45]);
  assert.deepEqual(restored.sessions.bigrams.accuracies, [100, 98]);
  assert.equal(restored.sessions.bigrams.seed, 1_234_567);
});

test("serializePracticeState omits phrase arrays", () => {
  const state = createPracticeState();
  const serialized = serializePracticeState(state);
  assert.equal("phrases" in serialized.sessions.bigrams, false);
  assert.equal(typeof serialized.sessions.bigrams.seed, "number");
  assert.ok(serialized.sessions.bigrams.settings);

  const roundTrip = hydratePracticeState(serialized);
  assert.ok(roundTrip);
  assert.deepEqual(
    roundTrip.sessions.bigrams.phrases,
    state.sessions.bigrams.phrases,
  );
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
  assert.equal(restored.focusActive, false);
});

test("legacy phrase sessions above 1000 items still hydrate", () => {
  const phrases = Array.from({ length: 1_200 }, (_, i) => `w${i}`);
  const restored = hydratePracticeState({
    source: "bigrams",
    sessions: {
      bigrams: { phrases, phraseIndex: 10, wpms: [40] },
    },
  });
  assert.ok(restored);
  assert.equal(restored.sessions.bigrams.phrases.length, 1_200);
  assert.equal(restored.sessions.bigrams.phraseIndex, 10);
  assert.ok(typeof restored.sessions.bigrams.seed === "number");
});

test("focus session restores from its own slot with the same seed", () => {
  const values = ["aa", "bb", "cc", "dd"];
  const base = createPracticeState();
  const focused = startFocus(base, values, "guided", 7);
  const restored = hydratePracticeState(serializePracticeState(focused));
  assert.ok(restored);
  assert.equal(restored.focusActive, true);
  assert.equal(restored.focusReturnMode, "guided");
  assert.ok(restored.focusSession);
  assert.deepEqual(
    restored.focusSession.phrases,
    focused.focusSession?.phrases,
  );
  assert.deepEqual(restored.focusSession.values, values);
  // Dataset sessions are untouched by Focus.
  assert.equal(restored.sessions.bigrams.values, undefined);
});

test("legacy Focus values leaked into a dataset slot are stripped on hydrate", () => {
  const settings = createPracticeState().settings.bigrams;
  const clean = newSession("bigrams", settings, [], { seed: 7 });
  const restored = hydratePracticeState({
    source: "bigrams",
    focusActive: true,
    sessions: {
      bigrams: {
        seed: 7,
        settings,
        phraseIndex: 0,
        wpms: [],
        accuracies: [],
        values: ["aa", "bb"],
      },
    },
  });
  assert.ok(restored);
  assert.equal(restored.focusActive, false, "no focusSession → not in Focus");
  assert.equal(restored.focusSession, null);
  assert.equal(restored.sessions.bigrams.values, undefined);
  assert.deepEqual(restored.sessions.bigrams.phrases, clean.phrases);
});

test("startFocus/exitFocus never touch dataset sessions", () => {
  const base = createPracticeState();
  const before = base.sessions.bigrams;
  const midRound = {
    ...base,
    sessions: {
      ...base.sessions,
      bigrams: { ...before, phraseIndex: 4, wpms: [1, 2, 3, 4] },
    },
  };
  const focused = startFocus(midRound, ["th", "he"], "free");
  assert.equal(focused.focusActive, true);
  assert.equal(focused.sessions, midRound.sessions);
  assert.ok(focused.focusSession);
  assert.ok(
    focused.focusSession.phrases.every((phrase) =>
      phrase.split(" ").every((token) => token === "th" || token === "he"),
    ),
  );
  // Focus round completion keeps values; the round then ends in the UI.
  const advanced = completeSessionPhrase(
    focused.focusSession,
    FOCUS_GENERATION_SOURCE,
    focused.focusSession.settings,
    [],
    40,
    100,
  );
  assert.deepEqual(advanced.values, ["th", "he"]);

  const exited = exitFocus(focused);
  assert.equal(exited.focusActive, false);
  assert.equal(exited.focusSession, null);
  assert.equal(exited.focusReturnMode, null);
  assert.equal(exited.sessions.bigrams.phraseIndex, 4);
  assert.deepEqual(exited.sessions.bigrams.wpms, [1, 2, 3, 4]);
  assert.equal(startFocus(base, [], "free"), base, "empty bank is a no-op");
});

test("sanitizeTypedInput strips Return/newlines and leading spaces", () => {
  assert.equal(sanitizeTypedInput("th he\n"), "th he");
  assert.equal(sanitizeTypedInput("th\r\n he"), "th he");
  assert.equal(sanitizeTypedInput("\n"), "");
  assert.equal(sanitizeTypedInput("  th"), "th");
  // A stripped newline produces no edit → no keystroke, no miss.
  const edit = describeTextEdit("th", sanitizeTypedInput("th\n"));
  assert.equal(edit.inserted, "");
  assert.deepEqual(
    recordAttempt(createAttempt(), "th he", edit),
    createAttempt(),
  );
});

test("instantFailIndex fails on the first wrong key only at 100% goal", () => {
  const expected = "th he";
  const wrong = describeTextEdit("th", "thx");
  assert.equal(instantFailIndex(expected, wrong, 100), 2);
  assert.equal(instantFailIndex(expected, wrong, 98), null);
  assert.equal(
    instantFailIndex(expected, describeTextEdit("th", "th "), 100),
    null,
  );
  assert.equal(instantFailIndex(expected, describeTextEdit("", "x"), 100), 0);
  // Deletions and paste-sized inserts are not instant fails.
  assert.equal(
    instantFailIndex(expected, describeTextEdit("thx", "th"), 100),
    null,
  );
  assert.equal(
    instantFailIndex(expected, describeTextEdit("", "zz"), 100),
    null,
  );
});

test("maxPhrases caps a seeded round and survives serialize/hydrate", () => {
  const state = createPracticeState();
  const settings = { ...state.settings.english_phrases, scope: 500 };
  const uncapped = generatePhrases("english_phrases", settings, [], {
    seed: 11,
  });
  const capped = newSession("english_phrases", settings, [], {
    seed: 11,
    maxPhrases: 25,
  });
  assert.equal(uncapped.length, 500);
  assert.equal(capped.phrases.length, 25);
  assert.deepEqual(capped.phrases, uncapped.slice(0, 25));

  const midRound = {
    ...state,
    source: "english_phrases" as const,
    settings: { ...state.settings, english_phrases: settings },
    sessions: {
      ...state.sessions,
      english_phrases: {
        ...capped,
        phraseIndex: 5,
        wpms: [40, 41, 42, 43, 44],
      },
    },
  };
  const restored = hydratePracticeState(serializePracticeState(midRound));
  assert.ok(restored);
  const session = restored.sessions.english_phrases;
  assert.equal(session.maxPhrases, 25);
  assert.equal(session.phrases.length, 25);
  assert.deepEqual(session.phrases, capped.phrases);
  assert.equal(session.phraseIndex, 5);

  // Next round keeps the cap.
  const next = completeSessionPhrase(
    { ...capped, phraseIndex: 24 },
    "english_phrases",
    settings,
    [],
    40,
    100,
  );
  assert.equal(next.phraseIndex, 0);
  assert.equal(next.phrases.length, 25);
  assert.equal(next.maxPhrases, 25);
});

test("generates a non-empty phrase for each built-in practice preset", () => {
  const state = createPracticeState();
  for (const settings of [
    { ...state.settings.bigrams, combination: 2, repetition: 3 },
    { ...state.settings.bigrams, combination: 5, repetition: 2 },
    { ...state.settings.bigrams, combination: 20, repetition: 1 },
  ]) {
    const phrases = generatePhrases("bigrams", settings, [], { seed: 1 });
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
  const phrases = generatePhrases("english_phrases", settings, [], { seed: 5 });

  assert.equal(englishPhrases.length, 2_000);
  assert.equal(new Set(englishPhrases).size, englishPhrases.length);
  assert.ok(
    englishPhrases.every((phrase) => /^[A-Z].*[.!?]["']?$/.test(phrase)),
  );
  for (const mark of [",", ":", ";", "?", "!", "'", "-", '"']) {
    assert.ok(
      englishPhrases.some((phrase) => phrase.includes(mark)),
      `expected punctuation ${JSON.stringify(mark)} in phrase bank`,
    );
  }
  assert.ok(
    !englishPhrases.some((phrase) => /\/[A-Za-z0-9_-]+-\d+/.test(phrase)),
    "phrase bank must not include /path-N junk",
  );
  assert.ok(
    !englishPhrases.some(
      (phrase) =>
        /\ba [aeiou]/i.test(phrase) ||
        /\ban [bcdfghjklmnpqrstvwxyz]/i.test(phrase),
    ),
    "phrase bank must use correct a/an",
  );
  assert.ok(isPhraseSource("english_phrases"));
  assert.equal(isPhraseSource("english_core"), false);
  assert.deepEqual(
    availableScopes("english_phrases"),
    [50, 100, 150, 200, 500, 1_000, 2_000],
  );
  assert.equal(phrases.length, 50);
  assert.ok(phrases.every((phrase) => englishPhrases.includes(phrase)));
});
