"""Build the CV's CSS string.

A4 single-page typography, three density modes (tight/normal/airy), an
accent token interpolated from the YAML source, and three font families
(serif / sans / mono) loaded as local @font-face files.

Visual conventions match ``cv-template/CV.html``:
  - Centered name + thin contact line, " · " separator
  - ALL-CAPS section headings with a hairline rule below
  - Job entries: bold company / italic location, then italic role / dates
  - Bullets: standard "•", hanging indent, justified
  - Brand icons rendered before each contact label (inline SVG)
"""
from __future__ import annotations


def build_css(base_url: str, accent: str = "#111111", font: str = "serif") -> str:
    """Return the full CSS string for the CV.

    Args:
        base_url: Either ``file://...`` (for WeasyPrint) or
            ``http://127.0.0.1:5567/asset/...`` (rewritten by the editor).
        accent: Hex colour for bullet dots, the section rule, and brand icons.
        font: ``"serif"`` (Source Serif 4), ``"sans"`` (Inter), or
            ``"mono"`` (system mono, kept for completeness).
    """
    if font == "serif":
        font_stack = (
            "'Source Serif 4', 'EB Garamond', 'Hoefler Text', "
            "Georgia, 'Times New Roman', serif"
        )
    elif font == "mono":
        font_stack = (
            "ui-monospace, 'JetBrains Mono', 'Menlo', 'Consolas', monospace"
        )
    else:
        font_stack = (
            "'Inter', -apple-system, BlinkMacSystemFont, "
            "'Helvetica Neue', Arial, sans-serif"
        )

    return f"""
/* ------------ Inter (sans) ------------ */
@font-face {{
  font-family: 'Inter';
  src: url('{base_url}/design/fonts/Inter-Light.ttf') format('truetype');
  font-weight: 300;
  font-style: normal;
}}
@font-face {{
  font-family: 'Inter';
  src: url('{base_url}/design/fonts/Inter-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
}}
@font-face {{
  font-family: 'Inter';
  src: url('{base_url}/design/fonts/Inter-Medium.ttf') format('truetype');
  font-weight: 500;
  font-style: normal;
}}
@font-face {{
  font-family: 'Inter';
  src: url('{base_url}/design/fonts/Inter-SemiBold.ttf') format('truetype');
  font-weight: 600;
  font-style: normal;
}}
@font-face {{
  font-family: 'Inter';
  src: url('{base_url}/design/fonts/Inter-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
}}

/* ------------ Source Serif 4 (serif) ------------ */
@font-face {{
  font-family: 'Source Serif 4';
  src: url('{base_url}/design/fonts/SourceSerif4-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
}}
@font-face {{
  font-family: 'Source Serif 4';
  src: url('{base_url}/design/fonts/SourceSerif4-It.ttf') format('truetype');
  font-weight: 400;
  font-style: italic;
}}
@font-face {{
  font-family: 'Source Serif 4';
  src: url('{base_url}/design/fonts/SourceSerif4-Semibold.ttf') format('truetype');
  font-weight: 600;
  font-style: normal;
}}
@font-face {{
  font-family: 'Source Serif 4';
  src: url('{base_url}/design/fonts/SourceSerif4-SemiboldIt.ttf') format('truetype');
  font-weight: 600;
  font-style: italic;
}}
@font-face {{
  font-family: 'Source Serif 4';
  src: url('{base_url}/design/fonts/SourceSerif4-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
}}

:root {{
  --accent:        {accent};
  --ink:           #111111;
  --body:          #1a1a1a;
  --muted:         #555555;
  --rule:          {accent};
  --paper:         #ffffff;

  --font-head:     {font_stack};
  --font-body:     {font_stack};
  --font-mono:     ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;

  --fs-name:       20pt;
  --fs-section:    9.5pt;
  --fs-role:       9pt;
  --fs-body:       8.75pt;
  --fs-meta:       8.75pt;
  --lh-body:       1.22;

  --gap-section:   6px;
  --gap-item:      4px;

  --page-w:        210mm;
  --page-h:        297mm;
  --page-pad-x:    14mm;
  --page-pad-y:    11mm;
}}

* {{ box-sizing: border-box; }}

@page {{
  size: A4;
  margin: 0;
}}

html, body {{
  margin: 0;
  padding: 0;
  background: var(--paper);
  color: var(--body);
  font-family: var(--font-body);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}}

.page {{
  width: var(--page-w);
  min-height: var(--page-h);
  padding: var(--page-pad-y) var(--page-pad-x);
  background: var(--paper);
  color: var(--ink);
  position: relative;
}}

/* ------------ Header (centered, classic) ------------ */
.header {{
  text-align: center;
  margin-bottom: 4px;
}}
.name {{
  font-family: var(--font-head);
  font-size: var(--fs-name);
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink);
  line-height: 1;
  margin: 0 0 5px;
}}
.contact {{
  font-size: var(--fs-meta);
  color: var(--body);
  line-height: 1.35;
}}
.contact a {{
  color: inherit;
  text-decoration: none;
  /* Keep icon and label on the same line — never break between them. */
  white-space: nowrap;
}}
.contact a:hover {{ text-decoration: underline; }}
.contact .sep {{ color: var(--muted); margin: 0 5px; user-select: none; }}

/* Brand icon — inline SVG sized to ~85% of the font size, sitting on the
   text baseline. No flexbox: the span stays a normal inline element so it
   doesn't change the line-box height vs. plain text. */
.contact .brand-icon {{
  display: inline;
  width: 0.85em;
  height: 0.85em;
  vertical-align: -0.12em;
  color: var(--ink);
  margin-right: 3px;
}}

.header.has-photo {{
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 14mm;
  text-align: left;
}}
.header.has-photo .header-text {{ text-align: center; }}
.header.has-photo .photo {{
  width: 22mm;
  height: 22mm;
  border-radius: 50%;
  object-fit: cover;
  border: 0.6pt solid var(--rule);
}}

/* ------------ Section chrome ------------ */
section {{ margin-bottom: var(--gap-section); }}
section:first-of-type {{ margin-top: 6px; }}
section:last-child {{ margin-bottom: 0; }}

.section-title {{
  font-family: var(--font-head);
  font-size: var(--fs-section);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink);
  margin: 0 0 4px;
  padding-bottom: 1px;
  border-bottom: 0.6pt solid var(--rule);
}}

/* ------------ Items ------------ */
.item {{ margin-bottom: var(--gap-item); break-inside: avoid; }}
.item:last-child {{ margin-bottom: 0; }}

.item-head, .item-sub {{
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}}
.item-head .left  {{ font-weight: 700; color: var(--ink); }}
.item-head .right {{ font-style: italic; color: var(--ink); }}
.item-sub  .left  {{ font-style: italic; color: var(--ink); font-size: var(--fs-role); }}
.item-sub  .right {{
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-role);
  white-space: nowrap;
}}

ul.bullets {{
  list-style: none;
  margin: 2px 0 0;
  padding: 0;
}}
ul.bullets li {{
  position: relative;
  padding-left: 14px;
  margin-bottom: 1px;
  color: var(--body);
  text-align: justify;
  hyphens: auto;
  -webkit-hyphens: auto;
  overflow-wrap: break-word;
}}
ul.bullets li::before {{
  content: "\\2022";
  position: absolute;
  left: 2px;
  top: 0;
  color: var(--accent);
  font-weight: 700;
}}

/* Skills (definition-list style — flat, dense) */
.skills-grid {{
  display: grid;
  grid-template-columns: max-content 1fr;
  row-gap: 1px;
  column-gap: 12px;
}}
.skills-grid dt {{
  font-weight: 700;
  font-style: italic;
  color: var(--ink);
}}
.skills-grid dd {{
  margin: 0;
  color: var(--body);
}}

/* Compact rows for projects/leadership/others */
.row {{
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 1px;
}}
.row .left b {{ color: var(--ink); font-weight: 700; }}
.row .right {{
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}}

/* Stack line — italic, muted */
.stack {{
  margin-top: 2px;
  font-size: var(--fs-meta);
  color: var(--muted);
  font-style: italic;
}}

/* Publication entry — title/date on top row, authors/venue on row 2.
   Tighter than experience.item — academics need to fit many on a page. */
.publication-item {{
  margin-bottom: var(--gap-item);
  break-inside: avoid;
}}
.publication-item .item-head .left a {{
  color: var(--ink);
  text-decoration: none;
  font-weight: 700;
}}
.publication-item .item-head .left a:hover {{
  text-decoration: underline;
}}
.publication-item .pub-sub {{
  color: var(--body);
  font-style: italic;
  font-size: 0.94em;
  line-height: 1.3;
  margin-top: 1px;
  text-align: justify;
  hyphens: auto;
}}

code.inline-code {{
  font-family: var(--font-mono);
  font-size: 0.92em;
  padding: 0 2px;
  background: rgba(0,0,0,0.04);
  border-radius: 2px;
}}

p, li {{ orphans: 3; widows: 3; }}

/* ------------ Density variants ------------ */
.density-tight  {{
  --gap-section: 4px;
  --gap-item:    2px;
  --lh-body:     1.16;
  --fs-body:     8.25pt;
  --fs-meta:     8.25pt;
  --fs-role:     8.5pt;
  --fs-section:  9pt;
  --fs-name:     18pt;
}}
.density-normal {{
  --gap-section: 6px;
  --gap-item:    4px;
  --lh-body:     1.22;
}}
.density-airy   {{
  --gap-section: 10px;
  --gap-item:    7px;
  --lh-body:     1.36;
  --fs-body:     9.75pt;
  --fs-meta:     9.75pt;
  --fs-role:     10pt;
  --fs-section:  10.5pt;
  --fs-name:     22pt;
}}
"""
