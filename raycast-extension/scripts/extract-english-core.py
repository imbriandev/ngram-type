"""Regenerate the pinned English Core 5k source list from wordfreq 3.1.1.

Exclusions come from data/english/manifest.json → normalization.excludedTokens.
Policy notes:
- Keep single letters ``a`` and ``i`` (high-frequency English words).
- Exclude other leftover single letters (g, j, k, q, z, plus earlier stubs).
- Exclude junk digraphs / abbreviations that are not standalone practice words
  (e.g. fa, ll, mm, dc, jr, hd, dj, ex, ed, …).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from wordfreq import top_n_list

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "data" / "english" / "manifest.json"
OUTPUT_PATH = ROOT / "data" / "english" / "english-core-5k.txt"
# Over-fetch so exclusions still leave enough ranked words for the target count.
WORDFREQ_POOL = 20_000


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text())
    bank = manifest["banks"][0]
    excluded = set(bank["normalization"]["excludedTokens"])
    pattern = re.compile(bank["normalization"]["allowPattern"])
    words: list[str] = []
    seen: set[str] = set()

    for word in top_n_list("en", WORDFREQ_POOL, wordlist="best"):
        normalized = word.lower()
        if (
            normalized in excluded
            or normalized in seen
            or not pattern.fullmatch(normalized)
        ):
            continue
        seen.add(normalized)
        words.append(normalized)
        if len(words) == bank["count"]:
            break

    if len(words) != bank["count"]:
        raise RuntimeError(f"Expected {bank['count']} words, generated {len(words)}")

    OUTPUT_PATH.write_text("\n".join(words) + "\n")


if __name__ == "__main__":
    main()
