/** Pure sound-selection rules (no Raycast or audio imports, so they're testable). */

export type Sound = "key" | "error" | "repeat" | "phrase" | "pass" | "fail";

/**
 * Sound for a keystroke, or null for silence.
 * - Deletions and the keystroke that completes the phrase are silent here
 *   (the phrase result sound plays instead, so there's never a double sound).
 * - The first keystroke that drops accuracy below the goal plays the soft
 *   "will repeat" cue instead of the mistake clack.
 * - Correct keystrokes click only when Keystroke Clicks is on.
 */
export function keystrokeSound(input: {
  grew: boolean;
  completesPhrase: boolean;
  isWrong: boolean;
  crossedRepeat: boolean;
  keystrokeClicks: boolean;
}): Sound | null {
  if (!input.grew || input.completesPhrase) return null;
  if (input.crossedRepeat) return "repeat";
  if (input.isWrong) return "error";
  return input.keystrokeClicks ? "key" : null;
}

/** True only on the keystroke where the phrase first falls below the goal. */
export function crossedRepeatThreshold(before: boolean, after: boolean) {
  return !before && after;
}

/**
 * Sound for a passed phrase: the ding only for a passed lesson or a finished
 * Focus round; every other passed phrase (including a round that didn't pass
 * the lesson) gets the soft Tink.
 */
export function phrasePassSound(input: {
  finishedRound: boolean;
  lessonPassed: boolean;
  focusRound: boolean;
}): Sound {
  if (input.finishedRound && (input.lessonPassed || input.focusRound)) {
    return "pass";
  }
  return "phrase";
}
