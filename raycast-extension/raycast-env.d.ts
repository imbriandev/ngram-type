/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Default mode - Cold-start practice mode when no saved progress exists. */
  "defaultMode": "guided" | "free",
  /** Sound effects - Play keystroke and feedback sounds on cold start (Settings still toggles per session). */
  "soundEnabled": boolean,
  /** Default minimum WPM - Free-practice minimum WPM applied on cold start (guided lessons keep their own thresholds). */
  "defaultMinWPM": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `practice` command */
  export type Practice = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `practice` command */
  export type Practice = {}
}

