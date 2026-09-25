import assert from "node:assert/strict";
import test from "node:test";
import {
  crossedRepeatThreshold,
  keystrokeSound,
  phrasePassSound,
  resolveSoundPaths,
  soundFiles,
  soundHelperScript,
} from "../src/sounds";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

test("sound names map to the intended files", () => {
  assert.deepEqual(soundFiles, {
    key: "click.wav",
    error: "clack.wav",
    pass: "ding.wav",
    fail: "failed.mp3",
    phrase: "/System/Library/Sounds/Tink.aiff",
    repeat: "/System/Library/Sounds/Basso.aiff",
  });
});

test("bundled sounds exist in assets/sounds; system sounds resolve verbatim", () => {
  const root = join(__dirname, "..", "..");
  const paths = resolveSoundPaths(join(root, "assets"));
  for (const [name, file] of Object.entries(soundFiles)) {
    const path = paths[name as keyof typeof paths];
    if (file.startsWith("/")) {
      assert.equal(path, file);
      if (process.platform === "darwin") assert.ok(existsSync(path), path);
    } else {
      assert.ok(existsSync(path), `${name} → ${path}`);
    }
  }
  // No bundled file shadows a system sound (e.g. a custom tink).
  for (const file of ["tink.wav", "Tink.aiff", "tink.aiff", "basso.wav"]) {
    assert.ok(!existsSync(join(root, "assets", "sounds", file)), file);
  }
});

test("helper registers and plays sounds by name (no index mapping)", () => {
  const paths = resolveSoundPaths("/assets");
  const script = soundHelperScript(paths);
  assert.ok(script.includes(`const paths = ${JSON.stringify(paths)};`));
  assert.match(script, /sounds\[name\] = id\[0\]/);
  assert.match(script, /AudioServicesPlaySystemSound\(sounds\[name\]\)/);
  assert.ok(script.includes("buffer.split(/\\r?\\n/)"));
  // Every name the TS side can send has a registered path.
  const sent = ["key", "error", "repeat", "phrase", "pass", "fail"];
  assert.deepEqual(Object.keys(paths).sort(), [...sent].sort());
});
