# Ngram Type for Raycast

A focused typing trainer launched from Raycast, based on [ranelpadon/ngram-type](https://github.com/ranelpadon/ngram-type). Raycast opens the bundled local practice window so the UI can provide a large phrase, inline error colors, a visible caret, and an accessible settings dialog.

## Development

```sh
cd raycast-extension
npm install
npm run dev
```

Then open Raycast and run **Practice Ngrams**. The command opens the bundled local practice window in your default browser. Settings and progress are stored in that browser's local storage.

## Publish

```sh
npm run lint
npm run build
npm run publish
```

The extension includes the original bigram, trigram, tetragram, and word datasets. Custom words are entered from the **Settings** action. Raycast does not expose the browser's low-level audio behavior consistently, so sound effects were intentionally left out; completion and failure are shown with toasts instead.
