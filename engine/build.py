"""Build a one-page CV PDF from ``content/cv.yaml``.

Usage:
    python3 engine/build.py
    python3 engine/build.py --density tight
    python3 engine/build.py --config content/cv.yaml --output output/cv.pdf
    python3 engine/build.py --skip-pdf

Hard constraint: the output PDF MUST be exactly one A4 page. If WeasyPrint
produces more than one page, the build exits non-zero with a message that
identifies the first heading on the overflowing page (best effort, via the
PDF bookmark tree). To fix overflow, re-run with ``--density tight`` or
trim a bullet from ``content/cv.yaml``.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "engine"))

from render import content, css_base, templates  # noqa: E402


DEFAULT_CONFIG = REPO / "content" / "cv.yaml"
DEFAULT_OUTPUT = REPO / "output" / "cv.pdf"
DEFAULT_HTML = REPO / "output" / "cv.html"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Render a one-page CV PDF from YAML.")
    p.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    # Default None so the YAML's ``density:`` field wins when not specified.
    p.add_argument("--density", choices=("tight", "normal", "airy"), default=None)
    p.add_argument("--skip-pdf", action="store_true", help="Write HTML only, skip PDF.")
    return p.parse_args()


def _walk_bookmarks(tree):
    """Yield (label, page_index) from WeasyPrint's bookmark tree.

    Each entry is a 4-tuple: ``(label, destination, children, state)`` where
    ``destination`` is ``(page_index, x, y)``.
    """
    if not tree:
        return
    for entry in tree:
        label, destination, children, _state = entry
        page_index = destination[0] if destination else None
        yield label, page_index
        yield from _walk_bookmarks(children)


def _find_overflow_label(doc) -> str:
    """Return the label of the first heading whose target page > 0."""
    try:
        bookmarks = doc.make_bookmark_tree()
    except Exception:
        return "(unknown — could not read bookmark tree)"
    for label, target_page in _walk_bookmarks(bookmarks):
        if target_page and target_page > 0:
            return label
    return "(unknown)"


def main() -> int:
    args = parse_args()

    cv = content.load(args.config)
    accent = cv.get("accent", "#111111")
    font = cv.get("font", "serif")
    # CLI --density overrides YAML's density: handy for testing tight/airy
    # without editing the file.
    density = args.density if args.density else cv.get("density", "normal")

    base_url = f"file://{REPO}"
    css = css_base.build_css(base_url, accent, font=font)
    full_html = templates.render_document(cv, css, density=density)

    DEFAULT_HTML.parent.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_HTML.write_text(full_html, encoding="utf-8")

    if args.skip_pdf:
        print(f"✅ Wrote {DEFAULT_HTML.relative_to(REPO)} (PDF skipped)")
        return 0

    try:
        from weasyprint import HTML
    except ImportError:
        print(
            "❌ WeasyPrint is not installed. Run: pip install weasyprint",
            file=sys.stderr,
        )
        return 2

    doc = HTML(string=full_html, base_url=base_url).render()
    pages = list(doc.pages)
    page_count = len(pages)

    if page_count > 1:
        overflow_label = _find_overflow_label(doc)
        print(
            f"❌ CV overflowed to {page_count} pages.\n"
            f"   First section on the overflow page: {overflow_label!r}.\n"
            f"   Try: --density tight, or trim a bullet in {args.config}.",
            file=sys.stderr,
        )
        return 1

    doc.write_pdf(args.output)
    try:
        rel = args.output.resolve().relative_to(REPO)
        display = str(rel)
    except ValueError:
        # Output path is outside the repo — print as-is.
        display = str(args.output)
    print(f"✅ Built {display} (1 page, density={density})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
