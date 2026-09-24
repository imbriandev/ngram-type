import {
  bigrams,
  englishCoreWords,
  englishPhrases,
  tetragrams,
  trigrams,
  words,
} from "./data";

export type Source =
  | "bigrams"
  | "trigrams"
  | "tetragrams"
  | "words"
  | "english_core"
  | "english_phrases"
  | "custom_words";

export type SourceSettings = {
  scope: number | null;
  combination: number;
  repetition: number;
  minimumWPM: number;
  minimumAccuracy: number;
};

export type Session = {
  phrases: string[];
  phraseIndex: number;
  wpms: number[];
};

export type PracticeState = {
  version: number;
  source: Source;
  soundEnabled: boolean;
  settings: Record<Source, SourceSettings>;
  customWords: string[];
  sessions: Record<Source, Session>;
};

export type Attempt = {
  correctKeystrokes: number;
  wrongKeystrokes: number;
};

export type TextEdit = {
  index: number;
  inserted: string;
  removed: string;
};

export const STATE_VERSION = 4;

const builtInSources: Record<Exclude<Source, "custom_words">, string[]> = {
  bigrams,
  trigrams,
  tetragrams,
  words,
  english_core: englishCoreWords,
  english_phrases: englishPhrases,
};

export const sourceTitles: Record<Source, string> = {
  bigrams: "Bigrams",
  trigrams: "Trigrams",
  tetragrams: "Tetragrams",
  words: "Words (legacy)",
  english_core: "English Core",
  english_phrases: "English Phrases (legacy)",
  custom_words: "Custom words",
};

/** Full source list for state, hydrate, and session maps. */
export const sources: Source[] = [
  "bigrams",
  "trigrams",
  "tetragrams",
  "english_core",
  "custom_words",
  "words",
  "english_phrases",
];

/**
 * Default picker order for new users: Bigrams → Trigrams → Tetragrams →
 * English Core → Custom. Classic Words and English Phrases stay in `sources`
 * for hydrate / power users but are hidden from the default UI.
 */
export const defaultSources: Source[] = [
  "bigrams",
  "trigrams",
  "tetragrams",
  "english_core",
  "custom_words",
];

export const ENGLISH_CORE_MAX_SCOPE = 200;

export function isPhraseSource(source: Source) {
  return source === "english_phrases";
}

export function isDefaultSource(source: Source) {
  return defaultSources.includes(source);
}

/** Sources shown in Settings / Change Dataset; keeps a demoted source if already selected. */
export function sourcesForPicker(current?: Source): Source[] {
  if (current && !isDefaultSource(current)) {
    return [...defaultSources, current];
  }
  return defaultSources;
}

export function availableScopes(source: Source) {
  if (source === "custom_words") return [];
  const sourceLength = builtInSources[source].length;
  const standardScopes =
    source === "english_core"
      ? [50, 100, 150, ENGLISH_CORE_MAX_SCOPE]
      : [50, 100, 150, 200, 500, 1_000, 5_000];
  const scopes = standardScopes.filter((scope) => scope <= sourceLength);
  if (source !== "english_core" && scopes.at(-1) !== sourceLength) {
    scopes.push(sourceLength);
  }
  return scopes;
}

export function defaultSettings(): Record<Source, SourceSettings> {
  return Object.fromEntries(
    sources.map((source) => [
      source,
      {
        scope: source === "custom_words" ? null : 50,
        combination: isPhraseSource(source) ? 1 : 2,
        repetition: isPhraseSource(source) ? 1 : 3,
        minimumWPM: 40,
        minimumAccuracy: 100,
      },
    ]),
  ) as Record<Source, SourceSettings>;
}

export function generatePhrases(
  source: Source,
  settings: SourceSettings,
  customWords: string[],
): string[] {
  const values =
    source === "custom_words" ? customWords : builtInSources[source];
  const scoped = values.slice(0, settings.scope ?? values.length);
  const shuffled = [...scoped];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  if (isPhraseSource(source)) return shuffled;

  const combination = Math.max(1, Math.floor(settings.combination) || 1);
  const repetition = Math.max(1, Math.floor(settings.repetition) || 1);
  const phrases: string[] = [];
  for (let i = 0; i < shuffled.length; i += combination) {
    const phrase = shuffled.slice(i, i + combination).join(" ");
    phrases.push(Array(repetition).fill(phrase).join(" "));
  }
  return phrases;
}

export function newSession(
  source: Source,
  settings: SourceSettings,
  customWords: string[],
): Session {
  return {
    phrases: generatePhrases(source, settings, customWords),
    phraseIndex: 0,
    wpms: [],
  };
}

export function completeSessionPhrase(
  session: Session,
  source: Source,
  settings: SourceSettings,
  customWords: string[],
  wpm: number,
): Session {
  const wpms = [...session.wpms, wpm];
  if (session.phraseIndex + 1 < session.phrases.length) {
    return { ...session, phraseIndex: session.phraseIndex + 1, wpms };
  }

  return newSession(source, settings, customWords);
}

export function createAttempt(): Attempt {
  return { correctKeystrokes: 0, wrongKeystrokes: 0 };
}

export function describeTextEdit(previous: string, next: string): TextEdit {
  let prefixLength = 0;
  while (
    prefixLength < previous.length &&
    prefixLength < next.length &&
    previous[prefixLength] === next[prefixLength]
  ) {
    prefixLength++;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > prefixLength &&
    nextEnd > prefixLength &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }

  return {
    index: prefixLength,
    inserted: next.slice(prefixLength, nextEnd),
    removed: previous.slice(prefixLength, previousEnd),
  };
}

export function recordAttempt(
  attempt: Attempt,
  expected: string,
  edit: TextEdit,
): Attempt {
  let correctKeystrokes = attempt.correctKeystrokes;
  let wrongKeystrokes = attempt.wrongKeystrokes;

  for (let index = 0; index < edit.inserted.length; index++) {
    if (expected[edit.index + index] === edit.inserted[index]) {
      correctKeystrokes++;
    } else {
      wrongKeystrokes++;
    }
  }

  return { correctKeystrokes, wrongKeystrokes };
}

export function metrics(
  expected: string,
  typed: string,
  startedAt: number | null,
  now = Date.now(),
  attempt?: Attempt,
) {
  let positionalCorrect = 0;
  for (let i = 0; i < Math.min(expected.length, typed.length); i++) {
    if (expected[i] === typed[i]) positionalCorrect++;
  }
  const positionalWrong = typed.length - positionalCorrect;
  const correct = attempt?.correctKeystrokes ?? positionalCorrect;
  const wrong = attempt?.wrongKeystrokes ?? positionalWrong;
  const seconds =
    startedAt === null ? 0 : Math.max((now - startedAt) / 1000, 0.001);
  const wpm =
    startedAt === null ? 0 : Math.round((typed.length / 5 / seconds) * 60);
  const accuracy =
    correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0;
  return { correct, wrong, wpm, accuracy };
}

export function createPracticeState(): PracticeState {
  const settings = defaultSettings();
  const sessions = {} as Record<Source, Session>;
  sources.forEach((source) => {
    sessions[source] = newSession(source, settings[source], []);
  });
  return {
    version: STATE_VERSION,
    source: "bigrams",
    soundEnabled: true,
    settings,
    customWords: [],
    sessions,
  };
}

export function hydratePracticeState(value: unknown): PracticeState | null {
  if (!isRecord(value)) return null;

  const fresh = createPracticeState();
  const source = isSource(value.source) ? value.source : fresh.source;
  const customWords = sanitizeCustomWords(value.customWords);
  const settings = {} as Record<Source, SourceSettings>;
  const rawSettings = isRecord(value.settings) ? value.settings : {};
  sources.forEach((currentSource) => {
    settings[currentSource] = sanitizeSettings(
      currentSource,
      rawSettings[currentSource],
      fresh.settings[currentSource],
    );
  });

  const sessions = {} as Record<Source, Session>;
  const rawSessions = isRecord(value.sessions) ? value.sessions : {};
  sources.forEach((currentSource) => {
    const fallback = newSession(
      currentSource,
      settings[currentSource],
      customWords,
    );
    sessions[currentSource] = sanitizeSession(
      rawSessions[currentSource],
      fallback,
    );
  });

  return {
    version: STATE_VERSION,
    source,
    soundEnabled:
      typeof value.soundEnabled === "boolean"
        ? value.soundEnabled
        : fresh.soundEnabled,
    settings,
    customWords,
    sessions,
  };
}

function sanitizeSettings(
  source: Source,
  value: unknown,
  fallback: SourceSettings,
): SourceSettings {
  const candidate = isRecord(value) ? value : {};
  const scopeLimit =
    source === "custom_words" ? 0 : builtInSources[source].length;
  const maxSelectableScope = availableScopes(source).at(-1) ?? scopeLimit;

  return {
    scope:
      source === "custom_words"
        ? null
        : sanitizeScope(
            candidate.scope,
            maxSelectableScope,
            fallback.scope ?? 50,
            source === "english_core",
          ),
    combination: boundedInteger(
      candidate.combination,
      1,
      200,
      fallback.combination,
    ),
    repetition: boundedInteger(
      candidate.repetition,
      1,
      10,
      fallback.repetition,
    ),
    minimumWPM: boundedInteger(
      candidate.minimumWPM,
      1,
      500,
      fallback.minimumWPM,
    ),
    minimumAccuracy: boundedInteger(
      candidate.minimumAccuracy,
      1,
      100,
      fallback.minimumAccuracy,
    ),
  };
}

function sanitizeSession(value: unknown, fallback: Session): Session {
  if (!isRecord(value)) return fallback;
  if (
    !Array.isArray(value.phrases) ||
    value.phrases.length === 0 ||
    value.phrases.length > 1_000 ||
    !value.phrases.every(
      (phrase) =>
        typeof phrase === "string" &&
        phrase.trim().length > 0 &&
        phrase.length <= 1_000,
    )
  ) {
    return fallback;
  }

  const phraseIndex = boundedInteger(
    value.phraseIndex,
    0,
    value.phrases.length - 1,
    -1,
  );
  if (phraseIndex === -1) return fallback;

  const wpms = Array.isArray(value.wpms)
    ? value.wpms
        .filter(
          (wpm): wpm is number =>
            typeof wpm === "number" &&
            Number.isFinite(wpm) &&
            wpm >= 0 &&
            wpm <= 2_000,
        )
        .slice(0, phraseIndex)
    : [];

  return { phrases: [...value.phrases], phraseIndex, wpms };
}

function sanitizeCustomWords(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((word): word is string => typeof word === "string")
    .map((word) => word.trim())
    .filter((word) => word.length > 0 && word.length <= 64)
    .slice(0, 1_000);
}

function sanitizeScope(
  value: unknown,
  maximum: number,
  fallback: number,
  clampOversized: boolean,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const integer = Math.floor(value);
  if (integer >= 1 && integer <= maximum) return integer;
  // Old english_core scopes (500 / 1000 / 5000) clamp down to the UI max (200).
  if (clampOversized && integer > maximum && maximum >= 1) return maximum;
  return fallback;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const integer = Math.floor(value);
  return integer >= minimum && integer <= maximum ? integer : fallback;
}

function isSource(value: unknown): value is Source {
  return typeof value === "string" && value in sourceTitles;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
