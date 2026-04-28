"""Load and validate the CV YAML source.

Schema (see ``content/cv.yaml`` for an example):

    name:        str (required)
    contact:     list[dict] (required) — entries accept either:
                   {label: str, href?: str}                   # plain
                   {network: str, username: str, label?, href?}  # branded
    accent:      str hex colour (optional, default ``#111111``)
    font:        "serif" | "sans" | "mono"  (optional, default ``serif``)
    photo:       str relative path to image (optional)

Sections (defined in ``engine/render/sections.py``):
    experience, education, skills, projects, leadership, others, …

# 🤖 ADD-A-SECTION-HERE
#
# This file derives its section list from ``sections.DEFAULT_SECTIONS``.
# To add a section, edit ``engine/render/sections.py`` — nothing here
# needs to change.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from . import brand_icons
from .sections import DEFAULT_SECTIONS, by_key


REQUIRED_TOP = ("name", "contact")
SUPPORTED_FONTS = ("serif", "sans", "mono")
SUPPORTED_DENSITIES = ("tight", "normal", "airy")
# Section keys, derived. Used for outline ordering.
SECTION_KEYS: tuple[str, ...] = tuple(s.key for s in DEFAULT_SECTIONS)


def load(path: str | Path) -> dict[str, Any]:
    src = Path(path).read_text(encoding="utf-8")
    cv = yaml.safe_load(src) or {}
    if not isinstance(cv, dict):
        raise ValueError(f"{path}: top-level YAML must be a mapping")

    for key in REQUIRED_TOP:
        if key not in cv or cv[key] in (None, "", []):
            raise ValueError(f"{path}: missing required field {key!r}")

    # At least one substantive section must be present. We treat the first
    # three registered sections (typically experience/education/skills) as
    # the "spine" — the CV is degenerate without at least one of them.
    spine = [s.key for s in DEFAULT_SECTIONS[:3]]
    if not any(cv.get(k) for k in spine):
        raise ValueError(
            f"{path}: at least one of {'/'.join(spine)} must be non-empty"
        )

    if not isinstance(cv["contact"], list):
        raise ValueError(f"{path}: contact must be a list of entries")
    cv["contact"] = [
        _normalise_contact(c, i, path) for i, c in enumerate(cv["contact"])
    ]

    # Per-section required-field validation, driven entirely by the
    # registry. Adding a new section in sections.py automatically wires
    # validation here.
    for section in DEFAULT_SECTIONS:
        items = cv.get(section.key) or []
        if not isinstance(items, list):
            raise ValueError(
                f"{path}: {section.key!r} must be a list (got {type(items).__name__})"
            )
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                raise ValueError(
                    f"{path}: {section.key}[{i}] must be a mapping (got {type(item).__name__})"
                )
            for field_name in section.required_fields:
                if field_name not in item:
                    raise ValueError(
                        f"{path}: {section.key}[{i}] missing required field {field_name!r}"
                    )
            # Per-shape extra checks (kept tight — the registry handles
            # the bulk of validation via required_fields).
            if section.shape == "experience" and "bullets" in item:
                if not isinstance(item["bullets"], list):
                    raise ValueError(
                        f"{path}: {section.key}[{i}].bullets must be a list"
                    )

    cv.setdefault("accent", "#111111")
    font = (cv.get("font") or "serif").strip().lower()
    if font not in SUPPORTED_FONTS:
        raise ValueError(
            f"{path}: font={font!r} not supported. Use one of {SUPPORTED_FONTS}."
        )
    cv["font"] = font
    density = (cv.get("density") or "normal").strip().lower()
    if density not in SUPPORTED_DENSITIES:
        raise ValueError(
            f"{path}: density={density!r} not supported. Use one of {SUPPORTED_DENSITIES}."
        )
    cv["density"] = density
    return cv


def _normalise_contact(c: Any, idx: int, path: str | Path) -> dict[str, Any]:
    """Coerce a contact entry into ``{network, label, href, icon_svg}`` shape.

    Accepts:
      - ``{label, href?}``                          legacy shape
      - ``{network, username, label?, href?}``      rendercv-style shape
      - ``{network, label, href?}``                 minimal with explicit label
    """
    if not isinstance(c, dict):
        raise ValueError(f"{path}: contact[{idx}] must be a mapping")

    network = c.get("network") or c.get("kind") or ""
    username = c.get("username") or c.get("user") or ""
    label = c.get("label")
    href = c.get("href")

    if not (label or username or href):
        raise ValueError(
            f"{path}: contact[{idx}] needs at least 'label', 'username', or 'href'"
        )

    canonical = brand_icons.normalise(network) if network else None
    icon_svg = brand_icons.svg_for(network) if network else ""
    final_href = (
        brand_icons.url_for(network, username, href)
        if (network or href)
        else (href or "")
    )
    final_label = (
        brand_icons.label_for(network, username, label)
        if network
        else (label or username or final_href)
    )

    return {
        "network": canonical or network or "",
        "label": final_label,
        "href": final_href,
        "icon_svg": icon_svg,
    }


_OUTLINE_RESERVED_TOP_LEVEL = frozenset(
    {"name", "contact", "accent", "font", "photo"}
)


def section_outline(cv: dict[str, Any] | None = None) -> list[dict[str, str]]:
    """Return outline entries (slug + label) in render order.

    Always includes a "Header" entry first, then the configured sections,
    then any custom top-level keys the user added directly to the YAML
    (so a freshly typed ``awards:`` section appears in the sidebar
    immediately on save).
    """
    out = [{"slug": "header", "label": "Header"}]
    registered = {s.key for s in DEFAULT_SECTIONS}
    for section in DEFAULT_SECTIONS:
        out.append({"slug": section.key, "label": section.label})
    if cv:
        # Import lazily to avoid a circular dependency.
        from .templates import humanize_key

        for key, value in cv.items():
            if key in registered or key in _OUTLINE_RESERVED_TOP_LEVEL:
                continue
            if not isinstance(value, list):
                continue
            out.append({"slug": key, "label": humanize_key(key), "custom": True})
    return out
