import assert from "node:assert/strict";
import test from "node:test";
import {
  FOCUS_BANK_CAP,
  HISTORY_CAP,
  appendRound,
  createFocusBank,
  createHistory,
  focusTokens,
  hydrateFocusBank,
  hydrateHistory,
  recordFocusMiss,
  recordFocusSuccess,
  tokenAtIndex,
} from "../src/focus";

test("tokenAtIndex finds the whitespace-delimited token", () => {
  assert.equal(tokenAtIndex("th he an", 0), "th");
  assert.equal(tokenAtIndex("th he an", 1), "th");
  assert.equal(tokenAtIndex("th he an", 3), "he");
  assert.equal(tokenAtIndex("th he an", 7), "an");
  assert.equal(tokenAtIndex("th he an", 2), "th"); // space → previous
  assert.equal(tokenAtIndex("", 0), null);
});

test("recordFocusMiss ranks and caps the Focus bank", () => {
  let bank = createFocusBank();
  bank = recordFocusMiss(bank, "th", 100);
  bank = recordFocusMiss(bank, "he", 200);
  bank = recordFocusMiss(bank, "th", 300);
  assert.deepEqual(focusTokens(bank), ["th", "he"]);
  assert.equal(bank.entries[0].misses, 2);

  for (let i = 0; i < FOCUS_BANK_CAP + 10; i++) {
    bank = recordFocusMiss(bank, `tok${i}`, 1_000 + i);
  }
  assert.equal(bank.entries.length, FOCUS_BANK_CAP);
});

test("recordFocusSuccess decays and removes drilled tokens", () => {
  let bank = createFocusBank();
  bank = recordFocusMiss(bank, "th");
  bank = recordFocusMiss(bank, "th");
  bank = recordFocusMiss(bank, "he");
  bank = recordFocusSuccess(bank, ["th", "he"]);
  assert.deepEqual(focusTokens(bank), ["th"]);
  assert.equal(bank.entries[0].misses, 1);
  bank = recordFocusSuccess(bank, ["th"]);
  assert.deepEqual(focusTokens(bank), []);
});

test("hydrateFocusBank sanitizes corrupt entries", () => {
  const restored = hydrateFocusBank({
    version: 9,
    entries: [
      { token: " ok ", misses: 2.7, lastMissedAt: 50 },
      { token: "", misses: 1, lastMissedAt: 1 },
      { token: "bad", misses: 0, lastMissedAt: 1 },
      { token: "x", misses: "no", lastMissedAt: 1 },
      3,
    ],
  });
  assert.deepEqual(restored.entries, [
    { token: "ok", misses: 2, lastMissedAt: 50 },
  ]);
});

test("appendRound keeps newest history capped", () => {
  let history = createHistory();
  for (let i = 0; i < HISTORY_CAP + 5; i++) {
    history = appendRound(history, {
      at: 1_000 + i,
      lessonId: null,
      source: "bigrams",
      scope: 50,
      avgWpm: 40 + i,
      accuracy: 100,
    });
  }
  assert.equal(history.rounds.length, HISTORY_CAP);
  assert.equal(history.rounds[0].at, 1_000 + HISTORY_CAP + 4);

  const restored = hydrateHistory(history);
  assert.equal(restored.rounds.length, HISTORY_CAP);
  assert.equal(restored.rounds[0].avgWpm, 40 + HISTORY_CAP + 4);
});
