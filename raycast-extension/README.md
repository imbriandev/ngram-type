# Ngram Type for Raycast

A focused typing trainer that runs entirely inside Raycast, based on [ranelpadon/ngram-type](https://github.com/ranelpadon/ngram-type). It uses a native Form with a stable target phrase, a dedicated typing area, and locally saved progress.

## Development

```sh
cd raycast-extension
npm install
npm run dev
```

Then open Raycast and run **Practice Ngrams**.

- Read the stable target at the top, then type in the native **Your turn** area; accuracy updates live, while WPM appears after each phrase.
- Correct mistakes in place using the inline character hint. Accuracy includes corrected mistakes, so the threshold represents the full attempt.
- Paste is disabled during a drill to keep WPM meaningful.
- Use **Reset Phrase** (`⌘R`) to clear the phrase or **Change Dataset** (`⌘D`) from Actions.
- Open **Actions** (`⌘K`) for settings, a new round, sound, or copying the phrase.
- Choose a Warm-up, Build, or Flow preset in Settings; advanced controls appear only for Custom, and drafts are retained while switching datasets.
- Use **English Core** for a ranked 5,000-word contemporary-English progression with scopes from Top 50 through Top 5,000.
- Use **English Phrases** for 2,000 original sentences that practice capitalization, punctuation, apostrophes, and numbers in context.
- Typing, mistake, pass, and fail sounds can be toggled in **Settings**.
- Lesson position, generated phrases, and average WPM are saved in Raycast LocalStorage and restored on the next launch.

## Publish

```sh
npm run lint
npm run build
npm run publish
```

The extension includes the original ngram and word datasets, **English Core**, a static 5,000-word bank generated offline from wordfreq 3.1.1, and **English Phrases**, an original 2,000-sentence editorial bank. Their provenance and normalization policy are recorded in [`data/english/manifest.json`](./data/english/manifest.json). Custom words are entered from **Settings**. Completion and threshold feedback stays inline, with optional sounds. Audio uses a warmed-up macOS AudioToolbox helper, avoiding a new process launch for every key; the extension targets Raycast on macOS. Run `npm test` to verify typing metrics, session transitions, state hydration, phrase generation, and generated data freshness.
