import { Source } from "./logic";

export const FOCUS_STORAGE_KEY = "ngram-type-focus";
export const FOCUS_VERSION = 1;
export const FOCUS_BANK_CAP = 40;

export const HISTORY_STORAGE_KEY = "ngram-type-history";
export const HISTORY_VERSION = 1;
export const HISTORY_CAP = 100;

export type FocusEntry = {
  token: string;
  misses: number;
  lastMissedAt: number;
};

export type FocusBank = {
  version: number;
  entries: FocusEntry[];
};

export type RoundSummary = {
  at: number;
  lessonId: string | null;
  source: Source | "focus";
  scope: number | null;
  avgWpm: number;
  accuracy: number;
};

export type PracticeHistory = {
  version: number;
  rounds: RoundSummary[];
};

export function createFocusBank(): FocusBank {
  return { version: FOCUS_VERSION, entries: [] };
}

export function createHistory(): PracticeHistory {
  return { version: HISTORY_VERSION, rounds: [] };
}

/** Whitespace-delimited token covering `index` in the expected phrase. */
export function tokenAtIndex(expected: string, index: number): string | null {
  if (expected.length === 0) return null;
  let cursor = index;
  if (cursor < 0) return null;
  if (cursor >= expected.length) cursor = expected.length - 1;
  if (expected[cursor] === " ") {
    if (cursor > 0) cursor -= 1;
    else return null;
  }

  let start = cursor;
  while (start > 0 && expected[start - 1] !== " ") start -= 1;
  let end = cursor;
  while (end < expected.length && expected[end] !== " ") end += 1;
  const token = expected.slice(start, end);
  return token.length > 0 ? token : null;
}

export function recordFocusMiss(
  bank: FocusBank,
  token: string,
  now = Date.now(),
): FocusBank {
  const normalized = token.trim();
  if (!normalized || normalized.length > 64) return bank;

  const entries = bank.entries.map((entry) => ({ ...entry }));
  const existing = entries.findIndex((entry) => entry.token === normalized);
  if (existing >= 0) {
    entries[existing] = {
      ...entries[existing],
      misses: entries[existing].misses + 1,
      lastMissedAt: now,
    };
  } else {
    entries.push({ token: normalized, misses: 1, lastMissedAt: now });
  }

  entries.sort(
    (a, b) => b.misses - a.misses || b.lastMissedAt - a.lastMissedAt,
  );
  return { version: FOCUS_VERSION, entries: entries.slice(0, FOCUS_BANK_CAP) };
}

/** Decay tokens after a clean drill; remove when misses hit zero. */
export function recordFocusSuccess(
  bank: FocusBank,
  tokens: string[],
): FocusBank {
  const drilled = new Set(
    tokens.map((token) => token.trim()).filter((token) => token.length > 0),
  );
  if (drilled.size === 0) return bank;

  const entries = bank.entries
    .map((entry) =>
      drilled.has(entry.token)
        ? { ...entry, misses: entry.misses - 1 }
        : entry,
    )
    .filter((entry) => entry.misses > 0)
    .sort((a, b) => b.misses - a.misses || b.lastMissedAt - a.lastMissedAt);

  return { version: FOCUS_VERSION, entries };
}

export function focusTokens(bank: FocusBank): string[] {
  return bank.entries.map((entry) => entry.token);
}

export function hydrateFocusBank(value: unknown): FocusBank {
  const fresh = createFocusBank();
  if (!isRecord(value)) return fresh;
  if (!Array.isArray(value.entries)) return fresh;

  const entries: FocusEntry[] = [];
  for (const candidate of value.entries) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.token !== "string") continue;
    const token = candidate.token.trim();
    if (!token || token.length > 64) continue;
    if (typeof candidate.misses !== "number" || !Number.isFinite(candidate.misses))
      continue;
    const misses = Math.floor(candidate.misses);
    if (misses < 1 || misses > 10_000) continue;
    if (
      typeof candidate.lastMissedAt !== "number" ||
      !Number.isFinite(candidate.lastMissedAt)
    ) {
      continue;
    }
    entries.push({
      token,
      misses,
      lastMissedAt: Math.floor(candidate.lastMissedAt),
    });
  }

  entries.sort(
    (a, b) => b.misses - a.misses || b.lastMissedAt - a.lastMissedAt,
  );
  return { version: FOCUS_VERSION, entries: entries.slice(0, FOCUS_BANK_CAP) };
}

export function appendRound(
  history: PracticeHistory,
  summary: RoundSummary,
): PracticeHistory {
  const rounds = [summary, ...history.rounds].slice(0, HISTORY_CAP);
  return { version: HISTORY_VERSION, rounds };
}

export function hydrateHistory(value: unknown): PracticeHistory {
  const fresh = createHistory();
  if (!isRecord(value)) return fresh;
  if (!Array.isArray(value.rounds)) return fresh;

  const rounds: RoundSummary[] = [];
  for (const candidate of value.rounds) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.at !== "number" || !Number.isFinite(candidate.at))
      continue;
    if (typeof candidate.source !== "string" || candidate.source.length === 0)
      continue;
    if (
      typeof candidate.avgWpm !== "number" ||
      !Number.isFinite(candidate.avgWpm)
    ) {
      continue;
    }
    if (
      typeof candidate.accuracy !== "number" ||
      !Number.isFinite(candidate.accuracy)
    ) {
      continue;
    }
    const avgWpm = Math.round(candidate.avgWpm);
    const accuracy = Math.round(candidate.accuracy);
    if (avgWpm < 0 || avgWpm > 2_000) continue;
    if (accuracy < 0 || accuracy > 100) continue;

    const lessonId =
      typeof candidate.lessonId === "string" && candidate.lessonId.length > 0
        ? candidate.lessonId
        : null;
    const scope =
      candidate.scope === null
        ? null
        : typeof candidate.scope === "number" &&
            Number.isFinite(candidate.scope) &&
            candidate.scope >= 1
          ? Math.floor(candidate.scope)
          : null;

    rounds.push({
      at: Math.floor(candidate.at),
      lessonId,
      source: candidate.source as Source | "focus",
      scope,
      avgWpm,
      accuracy,
    });
    if (rounds.length >= HISTORY_CAP) break;
  }

  return { version: HISTORY_VERSION, rounds };
}

export function formatRoundTitle(summary: RoundSummary): string {
  const when = new Date(summary.at);
  const stamp = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${stamp} · ${summary.avgWpm} WPM · ${summary.accuracy}%`;
}

export function formatRoundSubtitle(summary: RoundSummary): string {
  if (summary.source === "focus") return "Focus bank";
  const scope =
    summary.scope === null ? "Custom" : `Top ${summary.scope}`;
  const lesson = summary.lessonId ? ` · ${summary.lessonId}` : "";
  return `${summary.source} · ${scope}${lesson}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
