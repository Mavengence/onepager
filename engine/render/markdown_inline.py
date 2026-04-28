"""Tiny inline-markdown processor for CV bullet text.

Ported (and trimmed) from ``marketing/books/engine/render/markdown.py:240-266``.
Handles, in order: HTML escape → backtick code → ``**bold**`` → ``*italic*``.
No links, no lists — bullets are already lists in YAML.
"""
from __future__ import annotations

import re


def inline(text: str) -> str:
    s = (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    s = re.sub(r"`([^`]+)`", r'<code class="inline-code">\1</code>', s)
    s = re.sub(r"\*\*\*([^*]+)\*\*\*", r"<strong><em>\1</em></strong>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", s)
    return s
