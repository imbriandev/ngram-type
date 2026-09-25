import assert from "node:assert/strict";
import test from "node:test";
import {
  crossedRepeatThreshold,
  keystrokeSound,
  phrasePassSound,
} from "../src/sounds";
import {
  createAttempt,
  describeTextEdit,
  recordAttempt,
  willRepeatPhrase,
} from "../src/logic";

const key = {
  grew: true,
  completesPhrase: false,
  isWrong: false,
  crossedRepeat: false,
  keystrokeClicks: false,
};

test("correct keystrokes click only when Keystroke Clicks is on", () => {
  assert.equal(keystrokeSound(key), null);
  assert.equal(keystrokeSound({ ...key, keystrokeClicks: true }), "key");
});

test("mistakes always clack; deletions and phrase completion are silent", () => {
  assert.equal(keystrokeSound({ ...key, isWrong: true }), "error");
  assert.equal(
    keystrokeSound({ ...key, isWrong: true, keystrokeClicks: true }),
    "error",
  );
  assert.equal(keystrokeSound({ ...key, grew: false, isWrong: true }), null);
  assert.equal(
    keystrokeSound({ ...key, completesPhrase: true, keystrokeClicks: true }),
    null,
  );
});

test("crossing below the goal plays the will-repeat cue instead of the clack", () => {
  assert.equal(
    keystrokeSound({ ...key, isWrong: true, crossedRepeat: true }),
    "repeat",
  );
});

test("the will-repeat cue fires once per phrase attempt", () => {
  const expected = "the";
  let attempt = createAttempt();
  let typed = "";
  const cues: boolean[] = [];
  // "x" (wrong) then backspace-and-retype: accuracy stays below 100%.
  for (const next of ["x", "", "t", "tx", "t", "th"]) {
    const before = willRepeatPhrase(attempt, 100);
    attempt = recordAttempt(attempt, expected, describeTextEdit(typed, next));
    cues.push(crossedRepeatThreshold(before, willRepeatPhrase(attempt, 100)));
    typed = next;
  }
  assert.equal(cues.filter(Boolean).length, 1);
  assert.equal(cues[0], true);
});

test("ding only for a passed lesson or a finished Focus round", () => {
  const base = { finishedRound: true, lessonPassed: false, focusRound: false };
  assert.equal(phrasePassSound({ ...base, lessonPassed: true }), "pass");
  assert.equal(phrasePassSound({ ...base, focusRound: true }), "pass");
  assert.equal(phrasePassSound(base), "phrase");
  assert.equal(
    phrasePassSound({ ...base, finishedRound: false, lessonPassed: true }),
    "phrase",
  );
});
