import { bigrams, trigrams, tetragrams, words } from "./data";

export type Source =
  "bigrams" | "trigrams" | "tetragrams" | "words" | "custom_words";

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

const builtInSources: Record<Exclude<Source, "custom_words">, string[]> = {
  bigrams,
  trigrams,
  tetragrams,
  words,
};

export const sourceTitles: Record<Source, string> = {
  bigrams: "Bigrams",
  trigrams: "Trigrams",
  tetragrams: "Tetragrams",
  words: "Words",
  custom_words: "Custom words",
};

export function defaultSettings(): Record<Source, SourceSettings> {
  return Object.fromEntries(
    (Object.keys(sourceTitles) as Source[]).map((source) => [
      source,
      {
        scope: source === "custom_words" ? null : 50,
        combination: 2,
        repetition: 3,
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

export function metrics(
  expected: string,
  typed: string,
  startedAt: number | null,
  now = Date.now(),
) {
  let correct = 0;
  for (let i = 0; i < Math.min(expected.length, typed.length); i++) {
    if (expected[i] === typed[i]) correct++;
  }
  const wrong = typed.length - correct;
  const seconds = startedAt ? Math.max((now - startedAt) / 1000, 0.001) : 0;
  const wpm = startedAt
    ? Math.round(((correct + wrong) / 5 / seconds) * 60)
    : 0;
  const accuracy =
    correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0;
  return { correct, wrong, wpm, accuracy };
}
