# English data banks

`english-core-5k.txt` is an offline, ranked English word bank generated from
`wordfreq` 3.1.1. It is deliberately committed so the Raycast extension never
downloads data at runtime.

Regenerate it with a Python environment containing `wordfreq==3.1.1`:

```sh
PYTHONPATH=/path/to/wordfreq python3 scripts/extract-english-core.py
npm run build:data
```

The source, version, license, normalization policy, and target count are
recorded in `manifest.json`.

`english-phrases-2000.txt` is an original, deterministic Ngram Type editorial
bank. It keeps capitalization and ASCII punctuation so learners can practice
natural sentence transitions. Regenerate it with
`node scripts/generate-english-phrases.mjs`, then run `npm run build:data`.

### English Core exclusion policy

- Keep single letters **`a`** and **`i`** (high-frequency English words).
- Exclude other leftover single letters (`g`, `j`, `k`, `q`, `z`, and earlier stubs).
- Exclude junk digraphs / abbreviations that are not useful standalone practice
  tokens (see `manifest.json` → `normalization.excludedTokens`, including
  `fa`, `ll`, `mm`, `dc`, `jr`, `hd`, `dj`, `ex`, `ed`, …).

UI practice scopes for Core are capped at Top 50–200 even though the bank is ~5k.

