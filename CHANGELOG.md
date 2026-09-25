# Ngram Type Changelog

## [Initial Version] - {PR_MERGE_DATE}

- Guided `english-v1` curriculum: 11 lessons from Bigrams → Trigrams →
  Tetragrams → English Core Top 50–200, then optional English Phrases, all at
  100% accuracy. Curriculum list (`⌘L`) grouped by stage with progress,
  goal and best WPM per lesson, Resume Current, Retry Lesson, Next Lesson, and
  Resume Guided Track.
- Accuracy-first practice loop: inline `Expected "x"` hint, correct with
  Backspace, early "this phrase will repeat" note when accuracy falls below the
  goal, automatic phrase completion, paste blocked, Return ignored.
- 25-phrase lesson rounds sampled from the lesson scope; round-end toasts
  (Lesson complete / Round complete) with a Next Lesson action.
- User WPM/accuracy goals kept separate from lesson goals; guided mode uses the
  higher of the two, with a "Lesson default" option and a Goal row that shows
  the source (yours / lesson / default).
- Seeded sessions: rounds are restored exactly (same phrases, position, and
  WPMs) after reopening Raycast.
- Focus bank from real mistakes (`⌘⇧E`): drills your most-missed chunks for one
  round in its own session, then returns you to your lesson; Exit Focus anytime.
- Focus Bank list (`⌘⇧B`): review missed chunks, remove one, or clear all.
- Round History (`⌘⇧H`): last 100 rounds with lesson, average WPM, accuracy,
  and date; Clear History with confirmation.
- Data bank hygiene: English Core built offline from wordfreq 3.1.1 (single
  letters and junk digraphs removed, scopes capped at Top 200); English Phrases
  editorial bank (2,000 sentences with capitalization and punctuation).
- Free practice with Warm-up / Build / Flow presets, per-dataset settings,
  Custom Words, and Change Dataset (`⌘D`).
- Preferences for default mode (guided/free), sound effects, and a default WPM
  goal for free practice; typing, mistake, pass, and fail sounds (`⌘⇧M` to
  mute).
- Toasts when guided mode is left implicitly, with the Resume Guided shortcut.
