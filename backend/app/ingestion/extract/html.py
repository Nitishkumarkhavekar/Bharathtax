"""HTML -> clean text. Strips scripts/styles/nav; keeps readable body text."""
from __future__ import annotations

from bs4 import BeautifulSoup


def extract(raw: bytes) -> str:
    soup = BeautifulSoup(raw, "lxml")
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        tag.decompose()
    # newline-separated text preserves line structure the parser relies on.
    text = soup.get_text("\n")
    lines = [ln.strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)
