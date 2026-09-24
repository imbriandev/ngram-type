import {
  Source,
  SourceSettings,
  PracticeState,
  newSession,
  sourceTitles,
} from "./logic";

export const CURRICULUM_TRACK_ID = "english-v1";
export const PROGRESS_VERSION = 1;
export const PROGRESS_STORAGE_KEY = "ngram-type-progress";

export type LessonPreset = "warm_up" | "build" | "flow";

export type Lesson = {
  id: string;
  title: string;
  source: Source;
  scope: number;
  combination: number;
  repetition: number;
  minWPM: number;
  minAccuracy: number;
  next: string | null;
  preset: LessonPreset;
};

export type CurriculumProgress = {
  version: number;
  trackId: string;
  currentLessonId: string;
  completedLessonIds: string[];
  bestWpmByLesson: Record<string, number>;
  /** Guided is the default path; free keeps Settings but leaves the track. */
  mode: "guided" | "free";
};

const warm = {
  combination: 2,
  repetition: 3,
  preset: "warm_up" as const,
};
const build = {
  combination: 5,
  repetition: 2,
  preset: "build" as const,
};
const flow = {
  combination: 20,
  repetition: 1,
  preset: "flow" as const,
};

/**
 * Locked english-v1 track:
 * Bigrams 50 → 100 → Trigrams 50 → 100 → Tetragrams 50 → 100 →
 * English Core 50 → 100 → 200 → English Phrases 200 → 500 (optional late transfer).
 */
export const ENGLISH_TRACK_V1: Lesson[] = [
  {
    id: "bi-50-warmup",
    title: "Bi · Top 50 · Warm-up",
    source: "bigrams",
    scope: 50,
    ...warm,
    minWPM: 40,
    minAccuracy: 100,
    next: "bi-100-warmup",
  },
  {
    id: "bi-100-warmup",
    title: "Bi · Top 100 · Warm-up",
    source: "bigrams",
    scope: 100,
    ...warm,
    minWPM: 40,
    minAccuracy: 100,
    next: "tri-50-warmup",
  },
  {
    id: "tri-50-warmup",
    title: "Tri · Top 50 · Warm-up",
    source: "trigrams",
    scope: 50,
    ...warm,
    minWPM: 40,
    minAccuracy: 100,
    next: "tri-100-build",
  },
  {
    id: "tri-100-build",
    title: "Tri · Top 100 · Build",
    source: "trigrams",
    scope: 100,
    ...build,
    minWPM: 40,
    minAccuracy: 100,
    next: "tetra-50-build",
  },
  {
    id: "tetra-50-build",
    title: "Tetra · Top 50 · Build",
    source: "tetragrams",
    scope: 50,
    ...build,
    minWPM: 40,
    minAccuracy: 100,
    next: "tetra-100-build",
  },
  {
    id: "tetra-100-build",
    title: "Tetra · Top 100 · Build",
    source: "tetragrams",
    scope: 100,
    ...build,
    minWPM: 40,
    minAccuracy: 100,
    next: "core-50-build",
  },
  {
    id: "core-50-build",
    title: "Core · Top 50 · Build",
    source: "english_core",
    scope: 50,
    ...build,
    minWPM: 40,
    minAccuracy: 100,
    next: "core-100-flow",
  },
  {
    id: "core-100-flow",
    title: "Core · Top 100 · Flow",
    source: "english_core",
    scope: 100,
    ...flow,
    minWPM: 45,
    minAccuracy: 100,
    next: "core-200-flow",
  },
  {
    id: "core-200-flow",
    title: "Core · Top 200 · Flow",
    source: "english_core",
    scope: 200,
    ...flow,
    minWPM: 50,
    minAccuracy: 100,
    next: "phrases-200-flow",
  },
  {
    id: "phrases-200-flow",
    title: "Phrases · Top 200 · Flow",
    source: "english_phrases",
    scope: 200,
    ...flow,
    minWPM: 40,
    minAccuracy: 100,
    next: "phrases-500-flow",
  },
  {
    id: "phrases-500-flow",
    title: "Phrases · Top 500 · Flow",
    source: "english_phrases",
    scope: 500,
    ...flow,
    minWPM: 40,
    minAccuracy: 100,
    next: null,
  },
];

const lessonById = new Map(
  ENGLISH_TRACK_V1.map((lesson) => [lesson.id, lesson]),
);

const guidedSources = new Set<Source>(
  ENGLISH_TRACK_V1.map((lesson) => lesson.source),
);

export function getLesson(id: string): Lesson | undefined {
  return lessonById.get(id);
}

export function nextLesson(id: string): Lesson | undefined {
  const lesson = getLesson(id);
  if (!lesson?.next) return undefined;
  return getLesson(lesson.next);
}

export function firstLesson(): Lesson {
  return ENGLISH_TRACK_V1[0];
}

export function isGuidedSource(source: Source): boolean {
  return guidedSources.has(source);
}

export function lessonSettings(lesson: Lesson): SourceSettings {
  return {
    scope: lesson.scope,
    combination: lesson.combination,
    repetition: lesson.repetition,
    minimumWPM: lesson.minWPM,
    minimumAccuracy: lesson.minAccuracy,
  };
}

/** Find a lesson matching source + drill settings (scope/combo/rep). */
export function lessonForSourceSettings(
  source: Source,
  settings: Pick<
    SourceSettings,
    "scope" | "combination" | "repetition"
  >,
): Lesson | undefined {
  return ENGLISH_TRACK_V1.find(
    (lesson) =>
      lesson.source === source &&
      lesson.scope === settings.scope &&
      lesson.combination === settings.combination &&
      lesson.repetition === settings.repetition,
  );
}

export function settingsMatchLesson(
  settings: SourceSettings,
  lesson: Lesson,
): boolean {
  return (
    settings.scope === lesson.scope &&
    settings.combination === lesson.combination &&
    settings.repetition === lesson.repetition &&
    settings.minimumWPM === lesson.minWPM &&
    settings.minimumAccuracy === lesson.minAccuracy
  );
}

/** Apply a lesson onto practice state: source, settings, fresh session. */
export function applyLesson(
  state: PracticeState,
  lesson: Lesson,
): PracticeState {
  const settings = {
    ...state.settings,
    [lesson.source]: lessonSettings(lesson),
  };
  return {
    ...state,
    source: lesson.source,
    settings,
    focusActive: false,
    sessions: {
      ...state.sessions,
      [lesson.source]: newSession(
        lesson.source,
        settings[lesson.source],
        state.customWords,
      ),
    },
  };
}

export function createProgress(
  lessonId: string = firstLesson().id,
): CurriculumProgress {
  return {
    version: PROGRESS_VERSION,
    trackId: CURRICULUM_TRACK_ID,
    currentLessonId: getLesson(lessonId)?.id ?? firstLesson().id,
    completedLessonIds: [],
    bestWpmByLesson: {},
    mode: "guided",
  };
}

export function hydrateProgress(value: unknown): CurriculumProgress {
  const fresh = createProgress();
  if (!isRecord(value)) return fresh;

  const currentLessonId =
    typeof value.currentLessonId === "string" &&
    getLesson(value.currentLessonId)
      ? value.currentLessonId
      : fresh.currentLessonId;

  const completedLessonIds = Array.isArray(value.completedLessonIds)
    ? [
        ...new Set(
          value.completedLessonIds.filter(
            (id): id is string =>
              typeof id === "string" && Boolean(getLesson(id)),
          ),
        ),
      ]
    : [];

  const bestWpmByLesson: Record<string, number> = {};
  if (isRecord(value.bestWpmByLesson)) {
    for (const [id, wpm] of Object.entries(value.bestWpmByLesson)) {
      if (!getLesson(id)) continue;
      if (typeof wpm !== "number" || !Number.isFinite(wpm)) continue;
      const rounded = Math.round(wpm);
      if (rounded >= 0 && rounded <= 2_000) bestWpmByLesson[id] = rounded;
    }
  }

  const mode =
    value.mode === "free" || value.mode === "guided" ? value.mode : "guided";

  return {
    version: PROGRESS_VERSION,
    trackId:
      typeof value.trackId === "string" && value.trackId.length > 0
        ? value.trackId
        : CURRICULUM_TRACK_ID,
    currentLessonId,
    completedLessonIds,
    bestWpmByLesson,
    mode,
  };
}

export function isLessonCompleted(
  progress: CurriculumProgress,
  lessonId: string,
): boolean {
  return progress.completedLessonIds.includes(lessonId);
}

export function markLessonComplete(
  progress: CurriculumProgress,
  lessonId: string,
  roundAverageWpm: number,
): CurriculumProgress {
  if (!getLesson(lessonId)) return progress;
  const completedLessonIds = progress.completedLessonIds.includes(lessonId)
    ? progress.completedLessonIds
    : [...progress.completedLessonIds, lessonId];
  const previousBest = progress.bestWpmByLesson[lessonId] ?? 0;
  const bestWpmByLesson = {
    ...progress.bestWpmByLesson,
    [lessonId]: Math.max(previousBest, Math.round(roundAverageWpm)),
  };
  return { ...progress, completedLessonIds, bestWpmByLesson };
}

export function advanceToLesson(
  progress: CurriculumProgress,
  lessonId: string,
): CurriculumProgress {
  if (!getLesson(lessonId)) return progress;
  return { ...progress, currentLessonId: lessonId, mode: "guided" };
}

export function roundAverageMeetsLesson(
  wpms: number[],
  lesson: Lesson,
): boolean {
  if (wpms.length === 0) return false;
  const average = Math.round(
    wpms.reduce((sum, value) => sum + value, 0) / wpms.length,
  );
  return average >= lesson.minWPM;
}


export const PRESET_TITLES: Record<LessonPreset, string> = {
  warm_up: "Warm-up",
  build: "Build",
  flow: "Flow",
};

/** 1-based index in english-v1, or 0 if unknown. */
export function lessonIndex(lessonId: string): number {
  const index = ENGLISH_TRACK_V1.findIndex((lesson) => lesson.id === lessonId);
  return index >= 0 ? index + 1 : 0;
}

export function formatLessonSubtitle(lesson: Lesson): string {
  return `${sourceTitles[lesson.source]} · Top ${lesson.scope} · ${PRESET_TITLES[lesson.preset]} · ${lesson.minWPM} WPM`;
}

/** Progress line shown at the top of Practice (Form.Description). */
export function formatTrackProgressDescription(
  progress: CurriculumProgress,
): string {
  if (progress.mode === "free") {
    return "Free practice · Resume Guided Track from Actions";
  }

  const lesson = getLesson(progress.currentLessonId);
  if (!lesson) {
    return "Guided · Open Curriculum from Actions";
  }

  const index = lessonIndex(lesson.id);
  const done = progress.completedLessonIds.length;
  const total = ENGLISH_TRACK_V1.length;
  const following = nextLesson(lesson.id);
  const nextPart = following
    ? ` → next: ${following.title}`
    : " · track complete";
  return `Guided · ${index}/${total} · ${done} done · ${lesson.title}${nextPart}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
