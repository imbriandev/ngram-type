# Ngram Type

Build 10-finger typing as muscle memory, right inside Raycast. Ngram Type drills
the most common letter chunks of English (bigrams → trigrams → tetragrams →
the top English words, then optional full sentences) until your fingers type
them by reflex. Accuracy comes first: every guided lesson requires 100%
accuracy, and speed follows.

> macOS only (typing sounds use the macOS audio system).

## Getting started

1. Open **Practice Ngrams** in Raycast.
2. You land on the first lesson of the guided curriculum (**Bigrams · Top 50**, Warm-up).
   Read the phrase under **Type this** and start typing in **Your turn**.
3. Phrases complete automatically when typed correctly. Finish a round to
   complete the lesson, then move on with **Next Lesson** (`⌘↵` or `⌘⇧N`).

Open the Action Panel (`⌘K`) at any time to see every action.

## How practice works

- **Correct with Backspace.** A wrong key shows an inline `Expected "x"` hint.
  Fix it with Backspace and keep going; the field is never cleared on you.
- **Accuracy counts every keystroke**, including mistakes you corrected. Once
  your accuracy drops below the goal, the hint and the Feedback row say
  _this phrase will repeat_. Finish the phrase anyway: a phrase that misses the
  goal plays the fail sound and comes back; a passing phrase advances.
- **Return is not a keystroke.** It never counts as a mistake. `⌘↵` resets the
  phrase (or goes to the next lesson once the current one is complete).
- **Paste is disabled** during a drill so WPM stays honest.
- **Lesson rounds are 25 phrases**, sampled from the lesson's scope. Your
  position in a round is saved and restored the next time you open Raycast.
- **Goals: yours vs. the lesson's.** Set _Your WPM goal_ and _Your accuracy goal_
  in **Practice Settings**. They persist across lessons. In guided mode the
  effective goal is the higher of your goal and the lesson goal; choose
  _Lesson default_ to clear yours. The **Goal** row shows where the number
  comes from: `80 WPM (yours)`, `45 WPM (lesson)`, or `40 WPM (default)`.
- A toast appears at the end of each round (**Lesson complete** or
  **Round complete**), with a **Next Lesson** button when the next lesson is
  unlocked.

## Sounds

With **Sound effects** on (default):

| Event                                        | Sound                                    |
| -------------------------------------------- | ---------------------------------------- |
| Mistyped key (or paste attempt)              | Clack                                    |
| First key that drops a phrase below the goal | Soft low cue (Basso)                     |
| Phrase passed                                | Tink                                     |
| Phrase failed (it will repeat)               | Fail sound                               |
| Lesson passed, or Focus round finished       | Ding                                     |
| Correct key                                  | Click, only with **Keystroke clicks** on |

A finished round that doesn't pass the lesson plays Tink, not the ding. Only
one sound plays per keystroke. `⌘⇧M` mutes everything; both switches are also
in **Practice Settings**.

## Guided curriculum

Open it with **Open Curriculum** (`⌘L`). Lessons are grouped into N-grams,
English Core, and Phrases (optional), each with an "x/y done" count. Every row
shows the lesson goal and your best WPM. The track has 11 lessons:

| #     | Lesson                                           | Goal   |
| ----- | ------------------------------------------------ | ------ |
| 1–2   | Bigrams Top 50 / Top 100 · Warm-up (2 items × 3) | 40 WPM |
| 3     | Trigrams Top 50 · Warm-up                        | 40 WPM |
| 4     | Trigrams Top 100 · Build (5 items × 2)           | 40 WPM |
| 5–6   | Tetragrams Top 50 / Top 100 · Build              | 40 WPM |
| 7     | English Core Top 50 · Build                      | 40 WPM |
| 8     | English Core Top 100 · Flow (20 items × 1)       | 45 WPM |
| 9     | English Core Top 200 · Flow                      | 50 WPM |
| 10–11 | English Phrases Top 200 / Top 500 (optional)     | 40 WPM |

All lessons require 100% accuracy. Start any lesson from the list, or use
**Resume Current** (`⌘↵` in the list) to go back to your checkpoint without
losing progress in the current round.

Changing the dataset or drill shape leaves the guided track (a toast tells you);
**Resume Guided Track** (`⌘⇧G`) brings you back. Changing only your goals keeps
you on the track.

## Free practice

Use **Change Dataset** (`⌘D`) or **Practice Settings** to practice any dataset
freely: Bigrams, Trigrams, Tetragrams, English Core (Top 50–200), or your own
**Custom Words**. Pick a preset (Warm-up, Build, Flow) or Custom items/repeats.

## Focus bank

Every character you mistype adds its word/chunk to the **Focus bank** (up to 40
entries, most-missed first). **Practice Focus Bank** (`⌘⇧E`) drills just those
chunks for one round, then returns you to where you were. Press `⌘⇧E` again to
**Exit Focus** early. Clean phrases gradually remove chunks from the bank.

**Open Focus Bank** (`⌘⇧B`) lists every chunk with its miss count. From there
you can practice the bank, remove a single chunk (`⌃D`), or clear the whole bank
(`⌃⇧D`, asks for confirmation).

## History

**Open History** (`⌘⇧H`) lists your last 100 finished rounds with the lesson,
average WPM, accuracy, and date. **Clear History** (`⌃⇧D`) removes them after a
confirmation.

## Keyboard shortcuts

| Shortcut | Action                                                                  |
| -------- | ----------------------------------------------------------------------- |
| `⌘↵`     | Reset Phrase (primary action), or Next Lesson once a lesson is complete |
| `⌘⇧↵`    | Secondary action (New Round, or Reset Phrase when Next Lesson is first) |
| `⌘⇧N`    | Next Lesson (when unlocked)                                             |
| `⌘⇧R`    | New Round                                                               |
| `⌘⇧M`    | Mute Sounds / Unmute Sounds                                             |
| `⌘L`     | Open Curriculum                                                         |
| `⌘⇧G`    | Resume Guided Track (in free practice)                                  |
| `⌘⇧L`    | Retry Lesson (fresh round)                                              |
| `⌘⇧J`    | Jump to Free Practice                                                   |
| `⌘⇧E`    | Practice Focus Bank / Exit Focus                                        |
| `⌘⇧B`    | Open Focus Bank                                                         |
| `⌘⇧H`    | Open History                                                            |
| `⌘E`     | Practice Settings                                                       |
| `⌘D`     | Change Dataset                                                          |
| `⌘K`     | All actions                                                             |

In the Curriculum list: `↵` Start Lesson, `⌘↵` Resume Current.

## Preferences

Found under Raycast Settings → Extensions → Ngram Type:

- **Default Mode**: Guided Curriculum (default) or Free Practice. Used on first
  launch, before any progress is saved.
- **Sound Effects** (on by default): mistake, will-repeat, pass, fail, and
  lesson-complete sounds. Used on first launch; later mute with `⌘⇧M` or change
  it in Practice Settings.
- **Keystroke Clicks** (off by default): also click on every correct
  keystroke. Used on first launch; later change it in Practice Settings.
- **Default WPM Goal** (20–100): the free-practice goal when you haven't set
  your own in Practice Settings. Guided lessons use their own goals. Applies
  immediately.

## Credits

Based on [ranelpadon/ngram-type](https://github.com/ranelpadon/ngram-type) by
Ranel Padon. The
original bigram, trigram, tetragram, and word datasets come from that project.
English Core is built from [wordfreq](https://github.com/rspeer/wordfreq) 3.1.1
(Apache-2.0); English Phrases is an original editorial bank. See
[`data/english/README.md`](./data/english/README.md) for provenance.

## Development

```sh
npm install
npm run dev    # ray develop: load the extension into Raycast
npm run lint
npm run build
npm test       # data freshness check + unit/e2e logic tests
```

More in [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) and the UI/UX notes in
[`docs/DESIGN.md`](./docs/DESIGN.md).
