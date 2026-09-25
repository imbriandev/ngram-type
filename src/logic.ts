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

/**
 * User-chosen goals, kept apart from lesson goals. null = not set
 * (guided uses the lesson goal; free uses the dataset default).
 */
export type UserGoals = {
  minimumWPM: number | null;
  minimumAccuracy: number | null;
};

export type Session = {
  /** Deterministic shuffle seed; phrases are regenerated, not persisted. */
  seed: number;
  /** Settings used when the session was created (regeneration must match). */
  settings: SourceSettings;
  phrases: string[];
  phraseIndex: number;
  wpms: number[];
  accuracies: number[];
  /** Optional token list (Focus bank snapshot) used instead of the dataset. */
  values?: string[];
  /** Optional round cap (guided lessons): keep only the first N seeded phrases. */
  maxPhrases?: number;
};

export type PracticeState = {
  version: number;
  source: Source;
  soundEnabled: boolean;
  settings: Record<Source, SourceSettings>;
  customWords: string[];
  sessions: Record<Source, Session>;
  /** When true, practice runs from `focusSession` (Focus miss bank). */
  focusActive: boolean;
  /** Dedicated Focus session; never stored in a dataset's session slot. */
  focusSession: Session | null;
  /** Curriculum mode to restore when Focus ends. */
  focusReturnMode: "guided" | "free" | null;
  /** User goals; never overwritten by lessons. */
  goals: UserGoals;
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

export const STATE_VERSION = 7;

/** Focus sessions use their own token list; this source only drives generation. */
export const FOCUS_GENERATION_SOURCE: Source = "custom_words";

/** Mulberry32 PRNG — same seed always yields the same shuffle. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

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
  words: "Words",
  english_core: "English Core",
  english_phrases: "English Phrases",
  custom_words: "Custom Words",
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
 * English Core → Custom. Classic Words stay demoted. English Phrases stay
 * demoted in the picker but are reachable via guided curriculum after Core 200
 * (title labeled optional when shown).
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

export type GeneratePhrasesOptions = {
  seed?: number;
  /** When set (e.g. Focus bank), use these tokens instead of the dataset. */
  values?: string[];
  /** When set, keep only the first N phrases of the seeded shuffle. */
  maxPhrases?: number;
};

export function generatePhrases(
  source: Source,
  settings: SourceSettings,
  customWords: string[],
  options: GeneratePhrasesOptions = {},
): string[] {
  const values =
    options.values ??
    (source === "custom_words" ? customWords : builtInSources[source]);
  const scoped = values.slice(0, settings.scope ?? values.length);
  const random =
    options.seed !== undefined ? mulberry32(options.seed >>> 0) : Math.random;
  const shuffled = [...scoped];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const cap = (phrases: string[]) =>
    options.maxPhrases && options.maxPhrases > 0
      ? phrases.slice(0, options.maxPhrases)
      : phrases;

  // Focus / override lists are always treated as item banks (not natural sentences).
  if (isPhraseSource(source) && !options.values) return cap(shuffled);

  const combination = Math.max(1, Math.floor(settings.combination) || 1);
  const repetition = Math.max(1, Math.floor(settings.repetition) || 1);
  const phrases: string[] = [];
  for (let i = 0; i < shuffled.length; i += combination) {
    const phrase = shuffled.slice(i, i + combination).join(" ");
    phrases.push(Array(repetition).fill(phrase).join(" "));
  }
  return cap(phrases);
}

export function newSession(
  source: Source,
  settings: SourceSettings,
  customWords: string[],
  options: GeneratePhrasesOptions = {},
): Session {
  const seed = options.seed ?? createSeed();
  const values = options.values;
  const maxPhrases = options.maxPhrases;
  const snapshot: SourceSettings = { ...settings };
  return {
    seed,
    settings: snapshot,
    phrases: generatePhrases(source, snapshot, customWords, {
      seed,
      values,
      maxPhrases,
    }),
    phraseIndex: 0,
    wpms: [],
    accuracies: [],
    ...(values && values.length > 0 ? { values: [...values] } : {}),
    ...(maxPhrases ? { maxPhrases } : {}),
  };
}

export function completeSessionPhrase(
  session: Session,
  source: Source,
  settings: SourceSettings,
  customWords: string[],
  wpm: number,
  accuracy: number,
): Session {
  const wpms = [...session.wpms, wpm];
  const accuracies = [...session.accuracies, accuracy];
  if (session.phraseIndex + 1 < session.phrases.length) {
    return {
      ...session,
      phraseIndex: session.phraseIndex + 1,
      wpms,
      accuracies,
    };
  }

  return newSession(source, session.settings, customWords, {
    values: session.values,
    maxPhrases: session.maxPhrases,
  });
}

/** Persistable session fields — phrases are regenerated from seed on load. */
export function serializeSession(session: Session) {
  return {
    seed: session.seed,
    settings: session.settings,
    phraseIndex: session.phraseIndex,
    wpms: session.wpms,
    accuracies: session.accuracies,
    ...(session.values && session.values.length > 0
      ? { values: session.values }
      : {}),
    ...(session.maxPhrases ? { maxPhrases: session.maxPhrases } : {}),
  };
}

export function serializePracticeState(state: PracticeState) {
  const sessions = Object.fromEntries(
    sources.map((source) => [source, serializeSession(state.sessions[source])]),
  ) as Record<Source, ReturnType<typeof serializeSession>>;
  return {
    version: state.version,
    source: state.source,
    soundEnabled: state.soundEnabled,
    settings: state.settings,
    customWords: state.customWords,
    sessions,
    focusActive: state.focusActive,
    focusSession: state.focusSession
      ? serializeSession(state.focusSession)
      : null,
    focusReturnMode: state.focusReturnMode,
    goals: state.goals,
  };
}

/**
 * Normalize TextArea input: Return/newlines are never typing keystrokes
 * (the Form primary action is ⌘↵), and leading whitespace is ignored.
 */
export function sanitizeTypedInput(value: string): string {
  return value.replace(/[\r\n]/g, "").trimStart();
}

/**
 * Accuracy counts every keystroke, including corrected mistakes, so once the
 * live accuracy is below the goal the phrase is certain to repeat. Used for
 * an early, non-blocking hint while typing.
 */
export function willRepeatPhrase(
  attempt: Attempt,
  minimumAccuracy: number,
): boolean {
  const total = attempt.correctKeystrokes + attempt.wrongKeystrokes;
  if (total === 0) return false;
  return (attempt.correctKeystrokes / total) * 100 < minimumAccuracy;
}

/** End-of-phrase gate: failing phrases repeat; passing ones advance. */
export function phrasePasses(
  result: { wpm: number; accuracy: number },
  settings: Pick<SourceSettings, "minimumWPM" | "minimumAccuracy">,
): boolean {
  return (
    result.wpm >= settings.minimumWPM &&
    result.accuracy >= settings.minimumAccuracy
  );
}

/** Enter Focus: builds a dedicated session; dataset sessions stay untouched. */
export function startFocus(
  state: PracticeState,
  tokens: string[],
  returnMode: "guided" | "free",
  seed?: number,
): PracticeState {
  if (tokens.length === 0) return state;
  const base = state.settings[state.source];
  const focusSettings: SourceSettings = {
    ...base,
    scope: null,
    combination: Math.min(2, tokens.length),
    repetition: 3,
  };
  return {
    ...state,
    focusActive: true,
    focusReturnMode: returnMode,
    focusSession: newSession(FOCUS_GENERATION_SOURCE, focusSettings, [], {
      values: tokens,
      seed,
    }),
  };
}

/** Leave Focus; dataset sessions (and their progress) are untouched. */
export function exitFocus(state: PracticeState): PracticeState {
  return {
    ...state,
    focusActive: false,
    focusSession: null,
    focusReturnMode: null,
  };
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
    focusActive: false,
    focusSession: null,
    focusReturnMode: null,
    goals: createUserGoals(),
  };
}

export function createUserGoals(): UserGoals {
  return { minimumWPM: null, minimumAccuracy: null };
}

/** Sanitize saved user goals; missing or invalid values mean "not set". */
export function sanitizeUserGoals(value: unknown): UserGoals {
  const candidate = isRecord(value) ? value : {};
  const wpm = boundedInteger(candidate.minimumWPM, 1, 500, 0);
  const accuracy = boundedInteger(candidate.minimumAccuracy, 1, 100, 0);
  return {
    minimumWPM: wpm || null,
    minimumAccuracy: accuracy || null,
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
    // Dataset slots never carry Focus values (older versions leaked them here).
    sessions[currentSource] = sanitizeSession(
      rawSessions[currentSource],
      fallback,
      currentSource,
      settings[currentSource],
      customWords,
      { allowValues: false },
    );
  });

  const focusSession = hydrateFocusSession(value.focusSession);
  const focusActive = value.focusActive === true && focusSession !== null;

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
    focusActive,
    focusSession: focusActive ? focusSession : null,
    focusReturnMode:
      focusActive &&
      (value.focusReturnMode === "guided" || value.focusReturnMode === "free")
        ? value.focusReturnMode
        : null,
    goals: sanitizeUserGoals(value.goals),
  };
}

function hydrateFocusSession(value: unknown): Session | null {
  if (!isRecord(value)) return null;
  const values = sanitizeSessionValues(value.values);
  if (!values) return null;
  const settings = sanitizeSettings(
    FOCUS_GENERATION_SOURCE,
    value.settings,
    defaultSettings()[FOCUS_GENERATION_SOURCE],
  );
  const placeholder: Session = {
    seed: 0,
    settings,
    phrases: [],
    phraseIndex: 0,
    wpms: [],
    accuracies: [],
  };
  const session = sanitizeSession(
    value,
    placeholder,
    FOCUS_GENERATION_SOURCE,
    settings,
    values,
  );
  return session.phrases.length > 0 && session.values ? session : null;
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

function sanitizeSession(
  value: unknown,
  fallback: Session,
  source: Source,
  settings: SourceSettings,
  customWords: string[],
  options: { allowValues?: boolean } = {},
): Session {
  if (!isRecord(value)) return fallback;

  const values =
    options.allowValues === false
      ? undefined
      : sanitizeSessionValues(value.values);
  const maxPhrases = boundedInteger(value.maxPhrases, 1, 1_000, 0) || undefined;
  const seed = sanitizeSeed(value.seed);
  const snapshot = sanitizeSettings(source, value.settings, settings);

  // Preferred: regenerate phrases from seed (+ optional Focus values).
  if (seed !== null) {
    const phrases = generatePhrases(source, snapshot, customWords, {
      seed,
      values,
      maxPhrases,
    });
    if (phrases.length === 0) return fallback;
    const phraseIndex = boundedInteger(
      value.phraseIndex,
      0,
      phrases.length - 1,
      -1,
    );
    if (phraseIndex === -1) return fallback;
    return {
      seed,
      settings: snapshot,
      phrases,
      phraseIndex,
      wpms: sanitizeMetricList(value.wpms, phraseIndex),
      accuracies: sanitizeMetricList(value.accuracies, phraseIndex),
      ...(values ? { values } : {}),
      ...(maxPhrases ? { maxPhrases } : {}),
    };
  }

  // Legacy: accept any-length phrase arrays (no 1000 cap) and attach a seed
  // for the next persist cycle. Phrases kept as-is for this runtime only.
  if (
    Array.isArray(value.phrases) &&
    value.phrases.length > 0 &&
    value.phrases.every(
      (phrase) =>
        typeof phrase === "string" &&
        phrase.trim().length > 0 &&
        phrase.length <= 2_000,
    )
  ) {
    const phraseIndex = boundedInteger(
      value.phraseIndex,
      0,
      value.phrases.length - 1,
      -1,
    );
    if (phraseIndex === -1) return fallback;
    return {
      seed: createSeed(),
      settings: snapshot,
      phrases: [...value.phrases],
      phraseIndex,
      wpms: sanitizeMetricList(value.wpms, phraseIndex),
      accuracies: sanitizeMetricList(value.accuracies, phraseIndex),
      ...(values ? { values } : {}),
    };
  }

  return fallback;
}

function sanitizeSeed(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const integer = Math.floor(value);
  if (integer < 0 || integer > 0xffffffff) return null;
  return integer >>> 0;
}

function sanitizeSessionValues(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tokens = value
    .filter((token): token is string => typeof token === "string")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && token.length <= 64)
    .slice(0, 50);
  return tokens.length > 0 ? tokens : undefined;
}

function sanitizeMetricList(value: unknown, phraseIndex: number): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is number =>
        typeof entry === "number" &&
        Number.isFinite(entry) &&
        entry >= 0 &&
        entry <= 2_000,
    )
    .slice(0, phraseIndex);
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
