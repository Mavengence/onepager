"""Render the CV for the live editor preview.

Mirrors ``marketing/books/tools/editor/render_preview.py``: the same
HTML the engine produces, wrapped with mode-specific overrides.

  * ``continuous``: drop ``@page`` print rules, content scrolls naturally
    with the page rendered as a centred floating card.
  * ``paged``: keep ``@page`` rules, run paged.js inside the iframe so
    pagination matches what WeasyPrint will produce. A second
    ``.pagedjs_page`` (overflow) gets a red outline.

``file://`` URLs in the rendered HTML are rewritten to the editor's local
``http://`` origin so the browser can fetch fonts and the optional photo.
"""
from __future__ import annotations

import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
REPO = THIS_DIR.parent.parent

if str(REPO / "engine") not in sys.path:
    sys.path.insert(0, str(REPO / "engine"))

from render import content as content_mod  # noqa: E402
from render import css_base, templates  # noqa: E402


PAGEDJS_URL = "https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js"


def render_cv_html(
    cv_path: Path,
    host: str,
    theme: str = "light",
    mode: str = "continuous",
    density: str = "normal",
    font_override: str | None = None,
) -> str:
    """Build the iframe HTML for one preview render.

    Args:
        cv_path: Path to ``content/cv.yaml``.
        host: Editor origin, e.g. ``http://127.0.0.1:5567``.
        theme: ``"light"`` or ``"dark"``.
        mode: ``"continuous"`` or ``"paged"``.
        density: ``"tight"`` | ``"normal"`` | ``"airy"``.
        font_override: editor-only override for ``cv.font``. The YAML
            value remains the source of truth at build time.
    """
    # density="" or invalid → defer to the YAML's density field below
    if density and density not in {"tight", "normal", "airy"}:
        density = ""

    try:
        cv = content_mod.load(cv_path)
    except Exception as exc:
        return _error_html(str(exc))

    accent = cv.get("accent", "#111111")
    font = font_override or cv.get("font", "serif")
    # If the URL didn't specify a density, fall back to the YAML field
    # (so opening the preview without overrides honours cv.yaml).
    effective_density = density if density else cv.get("density", "normal")
    base_url = f"file://{REPO}"
    css = css_base.build_css(base_url, accent, font=font)
    base_doc = templates.render_document(cv, css, density=effective_density)

    if mode == "paged":
        overrides = _PAGED_OVERRIDES
        scripts = _PAGED_SCRIPTS
    else:
        overrides = _CONTINUOUS_OVERRIDES
        scripts = _CONTINUOUS_SCRIPTS

    dark_overrides = _DARK_OVERRIDES if theme == "dark" else ""

    head_inject = (
        f'<style id="preview-overrides">{overrides}</style>'
        f'{dark_overrides}'
        f'{scripts}'
    )

    if "</head>" in base_doc:
        full = base_doc.replace("</head>", head_inject + "</head>", 1)
    else:
        full = base_doc.replace("<body>", "<body>" + head_inject, 1)

    full = full.replace(
        "<html lang=\"en\">",
        f'<html lang="en" data-preview-theme="{theme}" data-preview-mode="{mode}" data-density="{density}">',
        1,
    )

    rel_repo = str(REPO).lstrip("/")
    full = full.replace(f"file://{REPO}", f"{host}/asset/{rel_repo}")
    return full


_CONTINUOUS_OVERRIDES = """
@page { size: auto; margin: 0; }
html, body {
  background: #e9e9ea;
  transition: background-color 240ms cubic-bezier(0.32, 0.72, 0, 1);
}
body { padding: 24pt 0; }
.page {
  margin: 0 auto;
  box-shadow: 0 8px 32px rgba(11, 9, 8, 0.10), 0 2px 6px rgba(11, 9, 8, 0.04);
}
"""


_PAGED_OVERRIDES = """
/* Hide content until paged.js finishes laying it out, otherwise the
   editor flashes the unpaginated single-document view first. */
html:not(.pagedjs-ready) > body { visibility: hidden; }
html.pagedjs-ready > body { visibility: visible; }

/* Force zero body padding — paged.js measures every direct body child
   for pagination, and any leading offset becomes a phantom blank
   page above the CV. */
body {
  background: #e9e9ea;
  padding: 0 !important;
  margin: 0 !important;
  transition: background-color 240ms cubic-bezier(0.32, 0.72, 0, 1);
}

/* Restore breathing room around the page stack via the paged.js wrapper. */
.pagedjs_pages {
  padding: 24pt 0 32pt 0;
  margin: 0 auto;
}

/* Each rendered page becomes a paper-white card with subtle shadow. */
.pagedjs_page {
  background: #ffffff !important;
  box-shadow: 0 8px 32px rgba(11, 9, 8, 0.10), 0 2px 6px rgba(11, 9, 8, 0.04);
  margin: 0 auto 28pt auto !important;
}

/* OVERFLOW HIGHLIGHT — any page after the first gets a red outline so
   the user immediately sees the CV no longer fits. */
.pagedjs_page:nth-child(n+2) {
  outline: 4px solid #ef4444;
  outline-offset: 4px;
}

/* Re-enable absolute positioning the page relies on inside paged.js. */
.page, main.page {
  margin: 0 !important;
  box-shadow: none !important;
}
"""


_PAGED_SCRIPTS = f"""
<script src="{PAGEDJS_URL}"></script>
<script>
  (function () {{
    if (typeof Paged === "undefined" || !Paged.registerHandlers) return;
    class CvPagedHandler extends Paged.Handler {{
      constructor(chunker, polisher, caller) {{ super(chunker, polisher, caller); }}
      afterRendered(pages) {{
        try {{
          window.parent.postMessage({{
            type: "paged-rendered",
            pages: pages.length,
            contentHeight: document.documentElement.scrollHeight,
            contentWidth: document.documentElement.scrollWidth,
            path: location.pathname + location.search,
          }}, "*");
        }} catch (e) {{}}
        document.documentElement.classList.add("pagedjs-ready");
      }}
    }}
    Paged.registerHandlers(CvPagedHandler);
  }})();
</script>
"""


_CONTINUOUS_SCRIPTS = """
<script>
  (function () {
    function pageWidth() {
      const page = document.querySelector('.page');
      if (!page) return document.documentElement.scrollWidth;
      const r = page.getBoundingClientRect();
      return Math.max(r.width, document.documentElement.scrollWidth);
    }
    function send() {
      try {
        window.parent.postMessage({
          type: "cv-content-rendered",
          contentHeight: document.documentElement.scrollHeight,
          contentWidth: pageWidth(),
        }, "*");
      } catch (e) {}
    }
    if (document.readyState === "complete") send();
    else window.addEventListener("load", send);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => setTimeout(send, 50));
    }
    // Also send after image / paint completes — content height can grow.
    window.addEventListener("resize", send);
    setTimeout(send, 200);
  })();
</script>
"""


_DARK_OVERRIDES = """
<style id="dark-preview-overrides">
  html, body { background: #1a1714 !important; color: #f3f0e9 !important; }
  .page {
    background: #221d18 !important;
    color: #f3f0e9 !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25) !important;
  }
  .pagedjs_page {
    background: #221d18 !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25) !important;
  }
  .name, .section-title,
  .item-head .left, .item-head .right,
  .item-sub .left, .item-sub .right,
  .row .left b, .row .right,
  .skills-grid dt {
    color: #f3f0e9 !important;
  }
  .contact, .skills-grid dd, ul.bullets li, .stack {
    color: #c0b8b0 !important;
  }
  .contact .sep { color: #8a807a !important; }
  .section-title { border-bottom-color: #f3f0e9 !important; }
  ul.bullets li::before { color: #f3f0e9 !important; }
</style>
"""


def _error_html(message: str) -> str:
    safe = (
        message.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body {{ font-family: ui-monospace, Menlo, monospace;
          background: #1a1714; color: #f3f0e9;
          padding: 32px; margin: 0; line-height: 1.5; }}
  h1 {{ color: #ef4444; font-size: 16px; margin: 0 0 12px; letter-spacing: .04em; }}
  pre {{ white-space: pre-wrap; word-break: break-word; }}
</style></head>
<body>
<h1>CV.YAML — VALIDATION ERROR</h1>
<pre>{safe}</pre>
</body></html>"""
