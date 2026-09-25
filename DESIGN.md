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
- Report a mismatch on the input itself. Never interrupt typing with a toast;
  toasts appear only at round boundaries (round/lesson complete, Focus done)
  or when guided mode is left implicitly.
- At a 100% accuracy goal, the first wrong key fails and restarts the phrase.
- Return is not a keystroke (stripped from input). The Form primary action is
  `⌘↵` (Reset Phrase, or Next Lesson once the lesson is complete).
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

**Words** remain demoted (legacy). **English Phrases** stay demoted in the
default dataset picker but are reachable via guided curriculum after Core 200
(labeled “optional” when shown). Hydration still works if already selected.

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
10. English Phrases Top 200 · Flow · 40 WPM (optional late transfer)
11. English Phrases Top 500 · Flow · 40 WPM

All lessons require **100% accuracy** (enforced by the existing phrase-complete gate). Progress is stored separately under LocalStorage key `ngram-type-progress` (`currentLessonId`, `completedLessonIds`, `bestWpmByLesson`).

UX:

- Each guided lesson round is capped at `LESSON_ROUND_PHRASES` (25) phrases, the first 25 of the seeded shuffle over the lesson scope (Phrases lessons too). Older uncapped sessions are re-capped from the same seed on load (progress kept when it fits, otherwise a fresh round).
- Navigation title shows the lesson title plus phrase index (e.g. `Bi · Top 50 · Warm-up · 3/25`).
- Practice Form shows a **Track** progress line (`Guided · 1/11 · N done · … → next: …`, or free-mode resume hint).
- **Open Curriculum** (⌘L) pushes a List of all 11 english-v1 lessons with Done / Current / Pending marks; any lesson can be started; **Resume Current** returns to the checkpoint without regenerating an in-progress round (`ensureLessonSession`).
- Finishing a round at or above the lesson’s min WPM marks the lesson complete and shows a success toast with a **Next Lesson** action; advance is an Action (`⌘↵` once complete, `⌘⇧N` always), not forced. Otherwise a “Round complete” toast shows the lesson’s WPM goal.
- Action Panel: **Open Curriculum**, **Resume Guided Track** (when free), **Next Lesson**, **Retry Lesson**, **Jump to Free Practice**.
- Free practice keeps the current Settings/dataset picker (Phase 0 `defaultSources`); changing dataset, starting Focus, or saving mismatched settings leaves guided mode with a “Left guided track” toast (resume with ⌘⇧G).

## Phase 2 — reflex training

Seeded sessions, Focus miss bank, and light round history.

### Seeded sessions

Practice state version **6** (adds `focusSession`, `focusReturnMode`, optional session `maxPhrases`). Each session stores `{ seed, settings snapshot, phraseIndex, wpms, accuracies, values? }` — **not** the phrase array. `generatePhrases` uses mulberry32 so the same seed + settings (+ optional Focus `values`) regenerates identical phrases on hydrate. Reloading Raycast mid-round restores the same phrases and progress. The old sanitize that wiped sessions with `phrases.length > 1000` is gone; legacy phrase arrays still hydrate once, then migrate to the seed model on the next save.

### Focus-from-errors bank

LocalStorage key `ngram-type-focus`. Only actually mistyped keystrokes record their whitespace-delimited token into a capped bank (40); slow-but-clean failures bank nothing. **Practice Focus Bank** (⌘⇧E) in the Reflex action section starts a Warm-up-style drill in a dedicated `focusSession` (never a dataset's session slot). Focus ends after one round (toast) or via **Exit Focus** (⌘⇧E again) and returns to the previous mode/lesson. Clean 100% phrase completions decay those tokens; zero misses removes them.

### Light history

LocalStorage key `ngram-type-history`, append-only, cap 100. Each finished round stores date, lessonId/source (or `focus`), scope, avg WPM, accuracy. **Open History** (⌘⇧H) pushes a simple List.

## Phase 3 — phrases + polish

### Phrase bank (manifest v3)

Regenerated `english-phrases-2000.txt` for reflex transfer:

- Interleave template families so Top 50/100 scopes mix shapes (not 100× one family).
- Fix **a/an** and singular/plural count agreement.
- Drop tautology loops and `/path-N` junk templates.
- Broader lexicon; keep useful punctuation (`? ! ' -- : ; , "`).

Rebuild: `npm run build:data` (generate + build scripts). Provenance in
`data/english/manifest.json` (`english_phrases` source version **3**).

### Optional Phrases stage

After Core 200 the track continues:

- `phrases-200-flow` — English Phrases Top 200 · Flow · 40 WPM · 100% accuracy
- `phrases-500-flow` — English Phrases Top 500 · Flow · 40 WPM · 100% accuracy

Bi→Core ordering is unchanged. Phrases stay out of `defaultSources` but appear
in the picker when the active source is Phrases (curriculum Start Lesson).

### Raycast Preferences

`package.json` preferences (cold start only when LocalStorage is empty):

| Key             | Type                      | Default  | Effect                              |
| --------------- | ------------------------- | -------- | ----------------------------------- |
| `defaultMode`   | dropdown `guided`\|`free` | `guided` | Initial curriculum mode             |
| `soundEnabled`  | checkbox                  | true     | Initial sound toggle                |
| `defaultMinWPM` | textfield                 | `40`     | Free-practice min WPM on cold start |

Guided lesson thresholds still come from the track. Saved sessions/progress win
over preferences after the first run.

### Store polish

Richer extension `description`, `keywords` (typing, ngram, wpm, practice, …),
and command blurb reflecting guided curriculum + optional phrase transfer.

## Ready to use

Daily checklist for Brian after `ray develop` / install:

1. Open **Practice Ngrams** — guided track should land on the current lesson (cold start: Bi · Top 50 · Warm-up).
2. **Preferences** (Raycast → Extensions → Ngram Type): default mode, sound, free-practice min WPM (cold start only).
3. **Curriculum** `⌘L` — 11 english-v1 lessons; Start / Resume Current.
4. While typing, **⌘↵** = Reset Phrase (Form primary action); **Next Lesson** takes ⌘↵ once the lesson is complete (also ⌘⇧N).
5. **Practice Focus Bank** `⌘⇧E` — empty until misses accumulate; then Warm-up-style drill from the bank.
6. **Open History** `⌘⇧H` — capped round log (WPM / accuracy).
7. Confirm **English Phrases** are absent from Change Dataset (`⌘D`) until a Phrases lesson is active; they still appear via Curriculum after Core 200.
