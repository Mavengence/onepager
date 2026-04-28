# CV — guide for Claude / coding agents

This is a one-page CV editor. The pipeline is intentionally small and
each extension point lives in **one file**. Don't redesign — find the
registry and edit it.

## Repo orientation

```
content/cv.yaml             ← the user's CV data (form/YAML edit it)
engine/build.py             ← CLI: cv.yaml → cv.html → cv.pdf (1 page or fail)
engine/render/sections.py   ← single source of truth for what sections exist
engine/render/templates.py  ← HTML renderers per shape (RENDERERS dispatch)
engine/render/content.py    ← schema validation (derives from sections.py)
engine/render/importers.py  ← rendercv + plain-text importers (derives from sections.py)
engine/render/ai_extract.py ← Claude system prompt (built from sections.py)
engine/render/css_base.py   ← typography, accent token, density variants
themes/<name>.json          ← swappable accent/font/density presets
tools/editor/server.py      ← Flask :5567, exposes /api/schema + /api/themes
tools/editor/static/        ← form-first editor (form.js, app.js, style.css)
tests/                      ← pytest, ~33 tests
docs/screenshots/           ← README assets (regenerate via Playwright)
```

## Common changes — where to edit

### One-off section (just put it in the YAML)

If the user wants a section on their own CV (e.g. "awards"), they can
add it directly to `content/cv.yaml`:

```yaml
awards:
  - title: Best Paper
    date: 2024
    desc: ICML
```

The sidebar, Form view, PDF preview, and printed PDF all pick it up
automatically on save. The shape is inferred from the first item's
keys (see `engine/render/templates.py:detect_shape`). The label is
title-cased from the key (`engine/render/templates.py:humanize_key`).

This is the no-code path. Use it for personal-CV customisation.

### Add a CV section as a default (e.g. "Publications", "Talks", "Press")

Edit **only** `engine/render/sections.py`. Append a `SectionDef` to
`DEFAULT_SECTIONS`:

```python
SectionDef(
    key="publications",
    label="Publications",
    eyebrow="Section 08 · Papers",
    singular="paper",
    shape="publication",        # or experience | education | skills | compact
    required_fields=("title",),
    rendercv_aliases=("publications", "papers"),
    text_header_pattern=r"^\s*(papers|publications|talks)\s*$",
)
```

That's it. The PDF renderer, validator, importer, AI extract prompt, form,
and outline all read from this registry.

### Add a new visual shape (e.g. an academic award block)

1. Add a Python renderer in `engine/render/templates.py` and register it
   in `_PER_ITEM_RENDERERS` (or `_WHOLE_LIST_RENDERERS` if it takes the
   full list).
2. Add a JS renderer in `tools/editor/static/form.js:SHAPE_RENDERERS`.
3. Add a YAML schema fragment in
   `engine/render/ai_extract.py:_SHAPE_SCHEMAS`.
4. Add CSS hooks in `engine/render/css_base.py` if the shape needs new
   styling.

### Add a theme

Drop `themes/<name>.json`:

```json
{
  "name": "Linear Blue",
  "accent": "#5e6ad2",
  "font": "sans",
  "density": "normal"
}
```

The editor's Theme picker lists everything in `themes/` automatically.

### Change typography or density numbers

`engine/render/css_base.py:build_css()`. The density classes
`.density-tight | .density-normal | .density-airy` override CSS
variables; tweak the values there.

### Change brand-icon SVGs or supported networks

`engine/render/brand_icons.py:_BRAND_PATHS`. Path data is from
[Simple Icons](https://simpleicons.org).

## Hard rules — do not violate

1. **The build refuses to ship a 2-page PDF.** `engine/build.py` uses
   WeasyPrint's bookmark tree to identify the overflow heading and exits
   non-zero. Don't bypass it.
2. **The form is the source of truth on save.** When the editor is in
   Form view, save serialises the in-memory model to YAML and writes
   the file. The YAML view buffer is a synced mirror. Don't introduce a
   third source of state.
3. **`refreshPreview()` saves first if dirty.** The /api/preview route
   reads `content/cv.yaml` from disk. If you call it before saving, the
   preview will be stale.
4. **The list order in `DEFAULT_SECTIONS` is the section order on the
   PDF and in the form.** Reorder there to reorder everywhere.
## Test + verify before shipping

```bash
python3 -m pytest tests/         # unit tests
python3 engine/build.py          # ensures PDF still 1 page
python3 tools/editor/server.py   # smoke-test editor
```

A change that breaks the 1-page guarantee, the form-first flow, or the
section registry is a regression. Fix it before merging.
