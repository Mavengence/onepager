# Extending this CV

Quick recipes for common changes. For an agent-focused guide, see
[CLAUDE.md](./CLAUDE.md).

---

## Add a section by typing it into the YAML (no code needed)

Switch the editor to **YAML** view and add a new top-level key:

```yaml
awards:
  - title: Best Paper Award
    date: 2024
    desc: ICML 2024 Honourable Mention
  - title: Germany Scholarship
    date: 2021
    desc: Deutschlandstipendium
```

Hit ⌘S. Three things happen:

1. The YAML is **auto-linted** — formatting normalised, header comment preserved.
2. The sidebar grows an **"Awards"** entry (with a green progress dot).
3. The Form view picks up the section. The PDF preview re-renders with the new heading.

The shape (compact / experience / publication / etc.) is **inferred from the
first item's keys**:

| Item shape | Inferred |
|---|---|
| `{title, date, desc}` | compact (one-liner with right-aligned date) |
| `{role, company, start, end, bullets}` | experience |
| `{degree, school, start, end}` | education |
| `{title, authors, venue, date}` | publication |
| `{label, items}` | skills (definition-list) |

The label is title-cased from the key (`speaking_engagements` → "Speaking Engagements").

### When you'd reach for the registry instead

Editing `cv.yaml` is the right move for **one-off** sections you'd put on
your own CV. If you want to ship a section as a default for everyone who
clones the repo (with a stable order, custom eyebrow, importer aliases,
etc.) — register it in code:

## Add a "Publications" section in 30 seconds (registered)

Open `engine/render/sections.py`, append to `DEFAULT_SECTIONS`:

```python
SectionDef(
    key="publications",
    label="Publications",
    eyebrow="Section 08 · Papers",
    singular="paper",
    shape="publication",
    required_fields=("title",),
    rendercv_aliases=("publications", "papers"),
    text_header_pattern=r"^\s*(papers|publications|talks)\s*$",
),
```

Restart the editor. The form now shows a Publications section. The PDF
renders it. The Claude AI extractor knows about it. Your YAML file
accepts:

```yaml
publications:
  - title: "Some Paper"
    authors: "A. Author, B. Author, C. Hartman"
    venue: "ICLR 2024"
    date: "04/2024"
    doi: "10.5555/abc"
    url: "https://..."
```

Available `shape` values:

| Shape | Best for | Required fields |
|---|---|---|
| `experience` | jobs | role, company, start, end |
| `education` | degrees | degree, school, start, end |
| `skills` | category lists | label |
| `compact` | one-liners with date | title |
| `publication` | papers / talks / press | title |

To add a new shape entirely, see [CLAUDE.md](./CLAUDE.md#add-a-new-visual-shape).

---

## Switch to a different theme

The editor's **Theme picker** (palette icon in the topbar) lists all
JSON files in `themes/`. Click one to apply.

To add a new one:

```json
// themes/midnight.json
{
  "name": "Midnight",
  "accent": "#7C3AED",
  "font": "serif",
  "density": "normal"
}
```

Refresh the editor; the new theme appears in the picker.

Themes set:

- `accent` — bullet dots, section rules, brand-icon colour, save button
- `font` — `serif` (Source Serif 4) | `sans` (Inter) | `mono`
- `density` — `tight` | `normal` | `airy`

---

## Fork it and own your CV pipeline

The whole thing is a small Python package + a Flask server + a few
hundred lines of CSS. Fork the repo, change the accent colour or the
density numbers in `engine/render/css_base.py`, add a section in
`sections.py`, add a theme in `themes/`. Everything load-bearing —
the one-page guarantee, the form-first flow, the live preview —
survives those changes.

To redistribute a custom theme: paste your `themes/<name>.json` into a
GitHub gist and tell people to drop it into their `themes/` folder.

---

## Import from anywhere

Three paths in the editor's **Import** modal:

1. **AI extract** — drop a PDF / DOCX / TXT / MD file (or paste text).
   Claude maps it into the schema. Set `ANTHROPIC_API_KEY` to enable;
   without a key, a regex fallback handles the basics.
2. **rendercv YAML** — paste a [rendercv](https://rendercv.com) YAML
   for a deterministic conversion.
3. **Plain text** — paste any resume text; heuristic regex parser
   tries its best.

For LinkedIn: open your profile → **More → Save to PDF** → drop the
file into the AI extract tab.

---

## Common questions

**My CV overflows. What do I do?**
1. Toggle density to **tight** (`Density · Tight` in the topbar)
2. Trim adjectives — favour numbers (`50%+`, `100+ hours/week`)
3. Drop the oldest entry from a long-tail section
4. Last resort: drop the `stack:` line on older roles

**Can I change the section order?**
Yes — reorder entries in `DEFAULT_SECTIONS` in
`engine/render/sections.py`. The order on disk is the order on the page.

**Can I have two pages?**
This tool intentionally enforces one page. If you really need two,
fork it, edit `engine/build.py`, and remove the page-count guard.
You'll lose the live overflow indicator too — they're paired by design.

**Where's my file?**
`content/cv.yaml`. The form view is just a UI on top.
