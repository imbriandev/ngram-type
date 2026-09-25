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

/**
 * Sound name → file. Relative names live in the extension's `assets/sounds`;
 * absolute paths are macOS system sounds. The helper looks sounds up by
 * name, so order here doesn't matter.
 */
export const soundFiles = {
  key: "click.wav",
  error: "clack.wav",
  pass: "ding.wav",
  fail: "failed.mp3",
  /** Per-phrase pass; the ding is kept for lesson/Focus completion. */
  phrase: "/System/Library/Sounds/Tink.aiff",
  /** Soft cue when a phrase first drops below the accuracy goal. */
  repeat: "/System/Library/Sounds/Basso.aiff",
} satisfies Record<Sound, string>;

/** Absolute path for every sound, given the extension's assets folder. */
export function resolveSoundPaths(assetsPath: string): Record<Sound, string> {
  return Object.fromEntries(
    Object.entries(soundFiles).map(([name, file]) => [
      name,
      file.startsWith("/") ? file : `${assetsPath}/sounds/${file}`,
    ]),
  ) as Record<Sound, string>;
}

/**
 * JXA source for the long-lived `osascript` helper: registers one
 * SystemSoundID per name, then plays `sounds[name]` for each stdin line.
 */
export function soundHelperScript(paths: Record<Sound, string>): string {
  return `
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
}
