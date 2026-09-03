# Ngram Type for Raycast

A Raycast typing trainer based on [ranelpadon/ngram-type](https://github.com/ranelpadon/ngram-type).

## Development

```sh
cd raycast-extension
npm install
npm run dev
```

Then open Raycast and run **Practice Ngrams**. Settings and progress are stored locally by Raycast.

## Publish

```sh
npm run lint
npm run build
npm run publish
```

The extension includes the original bigram, trigram, tetragram, and word datasets. Custom words are entered from the **Settings** action. Raycast does not expose the browser's low-level audio behavior consistently, so sound effects were intentionally left out; completion and failure are shown with toasts instead.
