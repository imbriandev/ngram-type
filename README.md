# Ngram Type for Raycast

A focused typing trainer that runs entirely inside Raycast, based on [ranelpadon/ngram-type](https://github.com/ranelpadon/ngram-type). It uses a native Form with a stable target phrase, a dedicated typing area, and locally saved progress.

## Development

```sh
npm install
npm run dev
```

Then open Raycast and run **Practice Ngrams**.

- Read the stable target at the top, then type in the native **Your turn** area; accuracy updates live, while WPM appears after each phrase.
- Correct mistakes in place with Backspace using the inline `Expected "x"` hint. Accuracy includes corrected mistakes, so once it drops below the goal the hint and Feedback row note that the phrase will repeat; pass/fail is decided when the phrase is finished.
- Return never counts as a keystroke; completion is automatic.
- Paste is disabled during a drill to keep WPM meaningful.
- Use **Reset Phrase** (`⌘↵`, the Form primary action) to clear the phrase or **Change Dataset** (`⌘D`) from Actions. Once a lesson is complete, **Next Lesson** becomes the primary action (`⌘↵`) and is always available as `⌘⇧N`.
- Open **Actions** (`⌘K`) for settings, a new round, sound, or copying the phrase.
- Choose a Warm-up, Build, or Flow preset in Settings; advanced controls appear only for Custom, and drafts are retained while switching datasets.
- Follow the **guided english-v1** curriculum (⌘L): Bigrams → Trigrams → Tetragrams → English Core, then optional English Phrases for sentence transfer. Each lesson round is 25 phrases sampled from the lesson scope; finishing a round shows a toast (with **Next Lesson** when unlocked).
- **English Core** is a ranked ~5k bank; practice scopes stay Top 50–200.
- **English Phrases** (optional, after Core 200) are 2,000 interleaved editorial sentences for capitalization, punctuation, and apostrophes.
- Extension Preferences set cold-start mode (guided/free), default sound, and free-practice minimum WPM.
- Typing, mistake, pass, and fail sounds can be toggled in **Settings**.
- Lesson position, seeded sessions, Focus bank, and light history are saved in Raycast LocalStorage and restored on the next launch.

## Ready to use

1. Run `npm run dev`, then open **Practice Ngrams**.
2. Check Extension **Preferences** (mode / sound / free min WPM — cold start only).
3. **Curriculum** `⌘L` · **Focus** `⌘⇧E` (toggles Exit Focus) · **History** `⌘⇧H` · **Resume Guided** `⌘⇧G` · **Next Lesson** `⌘⇧N` · `⌘↵` resets the phrase.
4. Phrases stay out of the dataset picker until a Phrases curriculum lesson is started.

## Publish

```sh
npm run lint
npm run build
npm run publish
```

The extension includes the original ngram and word datasets, **English Core** (wordfreq 3.1.1 offline bank), and **English Phrases** (editorial v3 bank for late reflex transfer). Provenance lives in [`data/english/manifest.json`](./data/english/manifest.json). Guided curriculum, Focus-from-errors, and round history are documented in [`DESIGN.md`](./DESIGN.md). Custom words are entered from **Settings**. Audio uses a warmed-up macOS AudioToolbox helper. Run `npm test` to verify metrics, curriculum, seeded sessions, and generated data freshness.
