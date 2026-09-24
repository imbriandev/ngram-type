# Ngram Type UI/UX

This extension uses Raycast's native visual system. The interface should feel like
a focused command palette, not a dashboard.

## Experience goal

Keep the user in one uninterrupted loop:

1. Read the target.
2. Type it.
3. Correct an error in place or move automatically to the next phrase.

Accuracy is the primary learning signal. It covers every typed character in the
attempt, including errors that were later corrected. Speed is supporting
feedback.

## Practice view

- Keep the practice form to five rows or fewer.
- Put the target first. Move lesson context into the navigation title so it does
  not compete with the text being practiced.
- Keep focus in the typing field when the view opens or the phrase changes.
- Keep the target visually stable; do not add a moving caret or progress marker
  to it.
- Report a mismatch on the input itself. Never interrupt typing with a toast.
- Complete phrases automatically; do not require a submit action.
- Reject multi-character paste input so the speed measurement remains useful.
- Put secondary controls in the Action Panel and expose shortcuts for frequent
  actions.

## Settings

- Prefer the Warm-up, Build, and Flow presets over exposing training mechanics.
- Reveal item count and repetition only when Custom is selected.
- Show custom-word input only for the Custom Words dataset.
- Keep phrase banks intact: one natural sentence per lesson, without grouping or
  repetition controls.
- Save drill settings independently for every dataset.
- Keep unsaved dataset drafts while the user compares settings in one session.
- Use plain training language: “Items per phrase” and “Repeats,” not internal
  model terms such as “Combination.”

## Visual direction

- Stay entirely within Raycast native components and theme colors.
- Use a flat hierarchy with minimal separators and no decorative surfaces.
- Keep labels short and sentence case.
- Reserve status styling for actionable errors; use sound only as optional
  reinforcement.
- Use standard Raycast actions, icons, and shortcut conventions.

The direction is adapted from the Raycast reference in
`VoltAgent/awesome-design-md`, especially its restrained color use, compact
command-palette hierarchy, and keyboard-first interaction model.

## Phase 0 — data policy

Locked practice flow for new users:

1. Bigrams
2. Trigrams
3. Tetragrams
4. English Core (scopes **50 / 100 / 150 / 200** only)

**English Core** stays a ~5k ranked bank for generation, but the UI scope cap is
200 so practice stays inside the top frequency band. Hydrated scopes above 200
(e.g. an old “Top 5000” setting) clamp down to 200.

**Words** and **English Phrases** remain in code and hydrate correctly if already
selected, but they are removed from the default dataset picker (legacy /
advanced). New users should not see them in Settings or Change Dataset.

Single-letter policy for Core: keep **a** and **i** for frequency; exclude other
leftover single letters and junk digraphs listed in `data/english/manifest.json`.

## Phase 1 — guided curriculum

Default practice follows the locked **english-v1** track (see `src/curriculum.ts`):

1. Bigrams Top 50 · Warm-up (2×3) · 40 WPM
2. Bigrams Top 100 · Warm-up · 40 WPM
3. Trigrams Top 50 · Warm-up · 40 WPM
4. Trigrams Top 100 · Build (5×2) · 40 WPM
5. Tetragrams Top 50 · Build · 40 WPM
6. Tetragrams Top 100 · Build · 40 WPM
7. English Core Top 50 · Build · 40 WPM
8. English Core Top 100 · Flow (20×1) · 45 WPM
9. English Core Top 200 · Flow · 50 WPM

All lessons require **100% accuracy** (enforced by the existing phrase-complete gate). Progress is stored separately under LocalStorage key `ngram-type-progress` (`currentLessonId`, `completedLessonIds`, `bestWpmByLesson`).

UX:

- Navigation title shows the lesson title plus phrase index (e.g. `Bi · Top 50 · Warm-up · 3/25`).
- Practice Form shows a **Track** progress line (`Guided · 1/9 · N done · … → next: …`, or free-mode resume hint).
- **Open Curriculum** (⌘L) pushes a List of all 9 english-v1 lessons with Done / Current / Pending marks; any lesson can be started; **Resume Current** returns to the checkpoint.
- Finishing a round at or above the lesson’s min WPM marks the lesson complete and suggests **Next lesson** in status text; advance is an Action, not forced.
- Action Panel: **Open Curriculum**, **Resume Guided Track** (when free), **Next Lesson**, **Retry Lesson**, **Jump to Free Practice**.
- Free practice keeps the current Settings/dataset picker (Phase 0 `defaultSources`); changing dataset or saving mismatched settings leaves guided mode.

## Phase 2 — reflex training

Seeded sessions, Focus miss bank, and light round history.

### Seeded sessions

Practice state version **5**. Each session stores `{ seed, settings snapshot, phraseIndex, wpms, accuracies, values? }` — **not** the phrase array. `generatePhrases` uses mulberry32 so the same seed + settings (+ optional Focus `values`) regenerates identical phrases on hydrate. Reloading Raycast mid-round restores the same phrases and progress. The old sanitize that wiped sessions with `phrases.length > 1000` is gone; legacy phrase arrays still hydrate once, then migrate to the seed model on the next save.

### Focus-from-errors bank

LocalStorage key `ngram-type-focus`. Wrong keystrokes and failed phrase attempts record the whitespace-delimited token into a capped bank (40). **Practice Focus Bank** (⌘⇧E) in the Reflex action section starts a Warm-up-style drill from those tokens (virtual bank via session `values`). Clean 100% phrase completions decay those tokens; zero misses removes them.

### Light history

LocalStorage key `ngram-type-history`, append-only, cap 100. Each finished round stores date, lessonId/source (or `focus`), scope, avg WPM, accuracy. **Open History** (⌘⇧H) pushes a simple List.

