"""Claude-powered CV extraction.

Takes any pasted text (resume in plain text, Markdown, LinkedIn export,
etc.) and uses Claude to map it into our YAML schema. Falls back to the
heuristic plain-text parser when no API key is available.

The system prompt is designed for prompt caching (Anthropic's
``cache_control: {"type": "ephemeral"}``) — it stays static across calls
so subsequent extractions are ~90% cheaper on the cached portion.

Required env: ``ANTHROPIC_API_KEY``.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import yaml

from . import importers


DEFAULT_MODEL = "claude-sonnet-4-5"  # cheapest "smart" tier; bump to opus for harder cases


# Per-shape YAML schema fragments — used by build_system_prompt() to
# construct the schema description Claude sees. Adding a section to
# DEFAULT_SECTIONS automatically extends the prompt.
_SHAPE_SCHEMAS: dict[str, str] = {
    "experience": (
        "  - role: <string>              # e.g. \"Senior Software Engineer\"\n"
        "    company: <string>\n"
        "    location: <string>\n"
        "    start: <string>             # MM/YYYY or YYYY format preferred\n"
        "    end: <string>               # MM/YYYY, YYYY, or \"Present\"\n"
        "    bullets:\n"
        "      - <one impact-driven sentence per bullet, no leading dash>\n"
        "    stack: <optional comma-separated technologies>"
    ),
    "education": (
        "  - degree: <string>            # e.g. \"M.Sc. Computer Science (Minor: Data Science)\"\n"
        "    school: <string>\n"
        "    location: <string>\n"
        "    start: <string>\n"
        "    end: <string>\n"
        "    note: <optional one-line note, e.g. \"Graduated with distinction\">"
    ),
    "skills": (
        "  - { label: <category>, items: <comma-separated items> }"
    ),
    "compact": (
        "  - { title: <string>, date: <string>, desc: <one-line description> }"
    ),
    "publication": (
        "  - title: <string>\n"
        "    authors: <string — comma-separated, you first if applicable>\n"
        "    venue: <journal / conference / preprint server>\n"
        "    date: <YYYY or MM/YYYY>\n"
        "    doi: <optional DOI>\n"
        "    url: <optional URL>"
    ),
}


def build_system_prompt() -> str:
    """Build the Claude system prompt from the section registry.

    The schema block lists every registered section with its per-shape
    YAML fragment. The prompt is wrapped in cache_control:ephemeral by
    the caller so the cache key matches across calls — but it changes
    when DEFAULT_SECTIONS changes (which is rare; intentional).
    """
    from .sections import DEFAULT_SECTIONS

    sections_yaml = "\n\n".join(
        f"{s.key}:" +
        (f"   # {s.ai_hint}" if s.ai_hint else "") +
        "\n" + _SHAPE_SCHEMAS.get(s.shape, _SHAPE_SCHEMAS["compact"])
        for s in DEFAULT_SECTIONS
    )

    return (
        "You are a CV/resume data extractor.\n\n"
        "You will be given the text of a resume (any format — plain text, "
        "Markdown, PDF dump, LinkedIn export). Your job is to extract "
        "structured data into the EXACT schema below and return it as a "
        "single YAML document. Output ONLY the YAML — no prose, no code "
        "fences, no commentary.\n\n"
        "# Schema\n\n"
        "```yaml\n"
        "name: <string, required — full name>\n"
        "accent: \"#111111\"               # hex; default to #111111\n"
        "font: serif                     # serif | sans | mono — default serif\n\n"
        "contact:                        # 1+ entries; use brand-network shape when known\n"
        "  - { network: <network>, username: <handle or value>, label?: <display text>, href?: <override URL> }\n"
        "  # OR (when no known network applies)\n"
        "  - { label: <text>, href: <url> }\n\n"
        f"{sections_yaml}\n"
        "```\n\n"
        "# Network values (use these exactly when applicable)\n\n"
        "mail, phone, web, linkedin, github, gitlab, x, mastodon, bluesky, "
        "instagram, youtube, telegram, whatsapp, reddit, stackoverflow, "
        "leetcode, orcid, googlescholar, researchgate, imdb\n\n"
        "For known networks, set `username` to the handle (e.g. `alex-hartman` "
        "for linkedin, not the full URL). The renderer auto-resolves the URL.\n\n"
        "# Rules\n\n"
        "1. Output ONLY YAML. The first character of your response is the "
        "first character of the YAML document.\n"
        "2. NEVER invent facts. If the source doesn't mention something, "
        "omit it.\n"
        "3. Bullets should be short, impact-focused (verb + what + why/impact). "
        "Don't include the leading \"•\" or \"-\".\n"
        "4. For contact entries, prefer `network` + `username` over plain "
        "`{label, href}` whenever a known network applies.\n"
        "5. If a section has no entries, omit it entirely (don't emit empty "
        "arrays).\n"
        "6. Order experience and education NEWEST FIRST.\n"
        "7. Render mathematical/special characters (–, &, %) as Unicode, not "
        "HTML entities."
    )


# Eagerly built at import time so it can be reused (matches cache-control
# semantics — same string on every call until DEFAULT_SECTIONS changes).
SYSTEM_PROMPT: str = build_system_prompt()


# Some files arrive as PDF or DOCX bytes. We extract text first and then
# pass the text to Claude. Keep these helpers pure-Python and dependency-light.


def extract_text_from_pdf(data: bytes) -> str:
    """Best-effort PDF text extraction via pypdf."""
    from io import BytesIO

    from pypdf import PdfReader

    reader = PdfReader(BytesIO(data))
    chunks: list[str] = []
    for page in reader.pages:
        try:
            chunks.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001 — page may be image-only
            chunks.append("")
    return "\n\n".join(chunks).strip()


def extract_text_from_docx(data: bytes) -> str:
    """DOCX is a zip — pull the body text from word/document.xml."""
    import io
    import zipfile
    from xml.etree import ElementTree as ET

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        try:
            xml = zf.read("word/document.xml")
        except KeyError as exc:
            raise ValueError("Not a valid .docx file (missing word/document.xml)") from exc

    root = ET.fromstring(xml)
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs: list[str] = []
    for p in root.iter(f"{ns}p"):
        runs = [t.text or "" for t in p.iter(f"{ns}t")]
        text = "".join(runs).strip()
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


def is_available() -> bool:
    """Whether the Claude API can be called (key is set, SDK installed)."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def extract(text: str, *, model: str | None = None) -> str:
    """Run Claude over ``text`` and return raw YAML.

    Raises ``RuntimeError`` if the API isn't available; the caller should
    fall back to ``importers.from_plain_text``.
    """
    if not is_available():
        raise RuntimeError("ANTHROPIC_API_KEY not set or anthropic SDK missing.")

    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model or DEFAULT_MODEL,
        max_tokens=4096,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": text}],
    )
    raw = "".join(b.text for b in response.content if getattr(b, "type", None) == "text").strip()
    return _strip_code_fences(raw)


def extract_to_dict(text: str, *, model: str | None = None) -> dict[str, Any]:
    """Run Claude and parse the result back into our cv dict shape.

    Falls back to the heuristic parser on any failure (network error, key
    missing, parse error). The fallback path is documented in the response
    so the UI can show "AI extraction unavailable, used heuristic fallback".
    """
    try:
        raw = extract(text, model=model)
        parsed = yaml.safe_load(raw)
        if not isinstance(parsed, dict):
            raise ValueError("Claude returned non-mapping YAML.")
        return parsed
    except Exception:
        # Fall back to heuristic — the user still gets *something*.
        return importers.from_plain_text(text)


_FENCE_RE = re.compile(r"^```(?:yaml|ya?ml)?\s*\n(.*?)\n```\s*$", re.DOTALL | re.IGNORECASE)


def _strip_code_fences(text: str) -> str:
    """Remove any accidental ```yaml fences Claude might add."""
    m = _FENCE_RE.match(text.strip())
    return m.group(1).strip() if m else text.strip()


# ──────────────────────────────────────────────────────────────────────
#  POLISH — tighten a bullet or rewrite an entire section.
#
#  These prompts are short and intentionally cheap. Each call is
#  independent (no shared cache prefix between polish and extract — the
#  use-cases are too different to share).
# ──────────────────────────────────────────────────────────────────────

POLISH_BULLET_PROMPT = """You rewrite resume bullet points so they're tighter, more impact-focused, and FAANG-style.

Rules:
1. Output ONE rewritten bullet. No bullet character, no quotes, no preamble, no commentary.
2. Verb-led. Start with a strong action verb in past tense (or present tense for current roles).
3. Numbers > adjectives. Prefer "reduced X by 40%" over "significantly improved X".
4. Aim for 100-180 characters. Trim adverbs and filler.
5. Keep the original facts. Don't invent metrics, scope, or technologies.
6. If the bullet is already tight (< 100 chars and verb-led with numbers), return it unchanged.
7. NEVER use Markdown formatting (**, _, `) — plain prose only."""


POLISH_SECTION_PROMPT = """You rewrite resume bullet points for a single role so they're tighter and more impact-focused. FAANG/YC convention.

Rules:
1. Output one bullet per line. No bullet character, no quotes, no preamble, no commentary, no numbering.
2. Same number of bullets as the input — keep the structure.
3. Verb-led. Numbers > adjectives. 100-180 characters per bullet.
4. Don't invent facts. Keep scope, tools, and metrics from the originals.
5. Preserve the role's voice (technical vs. managerial vs. research).
6. Output PLAIN prose. No Markdown formatting (**, _, `)."""


def polish_bullet(text: str, *, model: str | None = None) -> str:
    """Rewrite a single resume bullet via Claude. Raises on no key/SDK."""
    if not is_available():
        raise RuntimeError("ANTHROPIC_API_KEY not set or anthropic SDK missing.")
    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model or DEFAULT_MODEL,
        max_tokens=400,
        system=POLISH_BULLET_PROMPT,
        messages=[{"role": "user", "content": text}],
    )
    raw = "".join(b.text for b in response.content if getattr(b, "type", None) == "text").strip()
    # Strip any leading bullet character or quotes the model might emit.
    raw = re.sub(r"^[•\-*]\s*", "", raw).strip()
    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
        raw = raw[1:-1].strip()
    return raw


def polish_section(bullets: list[str], context: str = "", *, model: str | None = None) -> list[str]:
    """Rewrite a whole role's bullets at once. Returns the new bullets in
    the same order; empty input → empty output.
    """
    if not bullets:
        return []
    if not is_available():
        raise RuntimeError("ANTHROPIC_API_KEY not set or anthropic SDK missing.")
    import anthropic

    user_msg = (context.strip() + "\n\n" if context.strip() else "") + "\n".join(
        f"- {b}" for b in bullets
    )
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model or DEFAULT_MODEL,
        max_tokens=1200,
        system=POLISH_SECTION_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    raw = "".join(b.text for b in response.content if getattr(b, "type", None) == "text").strip()
    out: list[str] = []
    for line in raw.splitlines():
        line = re.sub(r"^[•\-*]\s*", "", line).strip()
        if line:
            out.append(line)
    # Match the original count if possible — if Claude returned more or
    # fewer, just trim/pad with the originals.
    if len(out) > len(bullets):
        out = out[: len(bullets)]
    while len(out) < len(bullets):
        out.append(bullets[len(out)])
    return out
