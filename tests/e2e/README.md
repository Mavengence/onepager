# E2E QA suite

Playwright-driven end-to-end tests for the CV editor. Uses headless
Chromium to validate every shipped feature against the live editor.

## Run

```bash
# 1. Start the editor
python3 tools/editor/server.py

# 2. In another shell, run the suite
pip install playwright
playwright install chromium
python3 -u tests/e2e/test_full_qa.py
```

## What it covers

70 checks across 23 areas: editor bootstrap, topbar elements,
appearance bar (font/density/accent), topbar stability on save,
brand-coloured contact icons in the preview, Form ↔ YAML view
toggle, collapsible form sections (with localStorage persistence),
mode toggle (continuous ↔ paged), auto-render toggle (live ↔
manual), zoom controls + wrap-scroll-when-zoomed, outline
navigation, theme picker, all REST API endpoints, build endpoint
(returns binary PDF), Cmd+S save flow, form add/remove of an
experience entry, tour overlay, dark mode, section render order,
brand-glyph SVG, postMessage content-height pipeline.

A run prints `PASS` / `FAIL` per check and exits non-zero on any
failure. There must be no console errors and no uncaught page
errors during the run.
