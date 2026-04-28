#!/usr/bin/env python3
"""Local CV editor — Flask app on :5567.

Two-pane editor: outline + CodeMirror in the middle, paged.js preview on
the right. Talks to ``engine/render`` to turn ``content/cv.yaml`` into the
same HTML WeasyPrint will use.

Run from the project root:

    python3 tools/editor/server.py

Then open http://127.0.0.1:5567.
"""
from __future__ import annotations

import sys
from pathlib import Path

from flask import (
    Flask,
    abort,
    jsonify,
    request,
    send_file,
    send_from_directory,
)

THIS_DIR = Path(__file__).resolve().parent
REPO = THIS_DIR.parent.parent
CONTENT_DIR = REPO / "content"
STATIC_DIR = THIS_DIR / "static"
CV_FILE = CONTENT_DIR / "cv.yaml"

if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))
if str(REPO / "engine") not in sys.path:
    sys.path.insert(0, str(REPO / "engine"))

from render_preview import render_cv_html  # noqa: E402
from render import ai_extract  # noqa: E402
from render import content as content_mod  # noqa: E402
from render import importers  # noqa: E402
from render import sections as sections_mod  # noqa: E402

DEFAULT_PORT = 5567
DEFAULT_CV_FILENAME = "cv.yaml"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")


def _resolve_cv_path(rel: str | None) -> Path:
    """Resolve ?path= against ``content/``. Defaults to ``cv.yaml``.

    Path-traversal-safe: the resolved path must stay inside
    ``content/``. Returns the absolute path even if the file doesn't
    exist yet (so callers can write to a new path).
    """
    name = (rel or DEFAULT_CV_FILENAME).strip().lstrip("/")
    if not name.endswith((".yaml", ".yml")):
        name = name + ".yaml"
    candidate = (CONTENT_DIR / name).resolve()
    try:
        candidate.relative_to(CONTENT_DIR.resolve())
    except ValueError:
        abort(400, description="path must stay inside content/")
    return candidate


def _safe_repo_path(rel: str) -> Path:
    """Resolve ``rel`` to an absolute path under the project root."""
    abs_path = Path("/" + rel.lstrip("/")).resolve()
    try:
        abs_path.relative_to(REPO.resolve())
    except ValueError:
        abort(404)
    return abs_path


@app.route("/")
def index() -> object:
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/api/cv", methods=["GET", "POST"])
def api_cv() -> object:
    """Read or write a CV YAML file.

    Query/body param ``path`` selects which file under ``content/`` to
    operate on; defaults to ``cv.yaml``. Path-traversal-safe via
    :func:`_resolve_cv_path`.
    """
    rel = request.args.get("path") or (request.get_json(silent=True) or {}).get("path")
    cv_path = _resolve_cv_path(rel)

    if request.method == "GET":
        if not cv_path.exists():
            abort(404)
        return (
            cv_path.read_text(encoding="utf-8"),
            200,
            {"Content-Type": "text/plain; charset=utf-8"},
        )

    payload = request.get_json(silent=True) or {}
    src = payload.get("content")
    if src is None:
        abort(400)
    cv_path.parent.mkdir(parents=True, exist_ok=True)
    cv_path.write_text(src, encoding="utf-8")
    return jsonify({
        "saved": True,
        "bytes": len(src.encode("utf-8")),
        "path": cv_path.name,
    })


@app.route("/api/cvs")
def api_cvs() -> object:
    """List all CV variants in ``content/`` (yaml/yml files).

    Returns ``{cvs: [{path, name, mtime, bytes}, ...], default: "cv.yaml"}``.
    The frontend uses this for the topbar variants dropdown.
    """
    out: list[dict[str, object]] = []
    if CONTENT_DIR.is_dir():
        for p in sorted(CONTENT_DIR.glob("*.y*ml")):
            try:
                stat = p.stat()
            except FileNotFoundError:
                continue
            out.append({
                "path": p.name,
                "name": p.stem,
                "mtime": int(stat.st_mtime),
                "bytes": stat.st_size,
            })
    return jsonify({"cvs": out, "default": DEFAULT_CV_FILENAME})


@app.route("/api/outline")
def api_outline() -> object:
    """Return outline entries (slug + label) the sidebar uses for jumps."""
    try:
        cv = content_mod.load(CV_FILE)
    except Exception as exc:
        return jsonify({"error": str(exc), "items": []}), 200
    return jsonify({"items": content_mod.section_outline(cv)})


@app.route("/api/preview")
def api_preview() -> object:
    cv_path = _resolve_cv_path(request.args.get("path"))
    if not cv_path.exists():
        abort(404)
    host = request.host_url.rstrip("/")
    theme = request.args.get("theme", "light")
    if theme not in {"light", "dark"}:
        theme = "light"
    mode = request.args.get("mode", "paged")
    if mode not in {"continuous", "paged"}:
        mode = "paged"
    density = request.args.get("density", "normal")
    if density not in {"tight", "normal", "airy"}:
        density = "normal"
    font = request.args.get("font") or None
    if font and font not in {"serif", "sans", "mono"}:
        font = None
    html = render_cv_html(
        cv_path,
        host=host,
        theme=theme,
        mode=mode,
        density=density,
        font_override=font,
    )
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/api/import", methods=["POST"])
def api_import() -> object:
    """Convert an external resume into our YAML format.

    Body: ``{"format": "rendercv"|"text", "content": "..."}``.
    Response: ``{"yaml": "...", "bytes": N}``.
    """
    payload = request.get_json(silent=True) or {}
    fmt = (payload.get("format") or "").strip().lower()
    src = payload.get("content")
    if not src or not isinstance(src, str):
        return jsonify({"error": "Missing 'content' string."}), 400
    try:
        if fmt == "rendercv":
            cv = importers.from_rendercv(src)
        elif fmt in {"text", "plain", "plaintext"}:
            cv = importers.from_plain_text(src)
        else:
            return jsonify({"error": f"Unknown format {fmt!r}."}), 400
    except Exception as exc:  # noqa: BLE001 — surface message to UI
        return jsonify({"error": f"{type(exc).__name__}: {exc}"}), 400
    return _yaml_response(cv)


@app.route("/api/extract/status")
def api_extract_status() -> object:
    """Tell the UI whether Claude extraction is available right now."""
    return jsonify(
        {
            "ai_available": ai_extract.is_available(),
            "model": ai_extract.DEFAULT_MODEL,
        }
    )


@app.route("/api/polish/bullet", methods=["POST"])
def api_polish_bullet() -> object:
    """Rewrite one bullet via Claude. Body: ``{text: str}``."""
    if not ai_extract.is_available():
        return jsonify({"error": "Claude unavailable. Set ANTHROPIC_API_KEY."}), 503
    payload = request.get_json(silent=True) or {}
    text = (payload.get("text") or "").strip()
    if not text:
        return jsonify({"error": "empty text"}), 400
    try:
        rewritten = ai_extract.polish_bullet(text)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"{type(exc).__name__}: {exc}"}), 500
    return jsonify({"original": text, "rewritten": rewritten})


@app.route("/api/polish/section", methods=["POST"])
def api_polish_section() -> object:
    """Rewrite the bullets in a role at once.

    Body: ``{bullets: [str], context: str}``. Context is freeform —
    typically ``f"Role: {role}\\nCompany: {company}\\nStack: {stack}"``
    so Claude can match the voice.
    """
    if not ai_extract.is_available():
        return jsonify({"error": "Claude unavailable. Set ANTHROPIC_API_KEY."}), 503
    payload = request.get_json(silent=True) or {}
    bullets = payload.get("bullets") or []
    if not isinstance(bullets, list) or not bullets:
        return jsonify({"error": "bullets must be a non-empty list"}), 400
    context = str(payload.get("context") or "")
    try:
        rewritten = ai_extract.polish_section(
            [str(b) for b in bullets], context=context
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"{type(exc).__name__}: {exc}"}), 500
    return jsonify({"original": bullets, "rewritten": rewritten})


@app.route("/api/extract", methods=["POST"])
def api_extract() -> object:  # noqa: C901 — keep linear, easy to follow
    """Run Claude (with prompt-cached system prompt) on resume text.

    Accepts either:
      * JSON body: ``{"content": "..."}`` for pasted plain text
      * multipart/form-data with a ``file`` field for PDF/DOCX/TXT/MD upload

    Falls back to the heuristic parser if no API key is configured.
    Response: ``{"yaml": "...", "bytes": N, "source": "claude"|"heuristic"}``.
    """
    text = _resolve_extraction_input()
    if text is None:
        return jsonify({"error": "Provide 'content' (JSON) or a 'file' (multipart)."}), 400
    if not text.strip():
        return jsonify({"error": "Extracted text is empty — file may be image-only."}), 400

    used_claude = False
    try:
        if ai_extract.is_available():
            cv = yaml_safe_load(ai_extract.extract(text))
            if not isinstance(cv, dict):
                raise ValueError("Claude returned non-mapping YAML.")
            used_claude = True
        else:
            cv = importers.from_plain_text(text)
    except Exception as exc:  # noqa: BLE001
        # Last-resort fallback so the user always gets something.
        try:
            cv = importers.from_plain_text(text)
        except Exception:
            return jsonify({"error": f"{type(exc).__name__}: {exc}"}), 500
    return _yaml_response(cv, source="claude" if used_claude else "heuristic")


def _resolve_extraction_input() -> str | None:
    """Pull text out of the request, preferring uploaded files over JSON."""
    file_obj = request.files.get("file") if request.files else None
    if file_obj and file_obj.filename:
        data = file_obj.read()
        name = (file_obj.filename or "").lower()
        if name.endswith(".pdf"):
            return ai_extract.extract_text_from_pdf(data)
        if name.endswith(".docx"):
            return ai_extract.extract_text_from_docx(data)
        return data.decode("utf-8", errors="replace")

    payload = request.get_json(silent=True) or {}
    src = payload.get("content")
    if isinstance(src, str):
        return src
    return None


def _yaml_response(cv: dict, source: str | None = None) -> object:
    """Common helper to dump a cv dict into our editor's YAML response."""
    import yaml as _yaml

    out_yaml = _yaml.safe_dump(
        cv,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=120,
    )
    body: dict[str, object] = {"yaml": out_yaml, "bytes": len(out_yaml.encode("utf-8"))}
    if source:
        body["source"] = source
    return jsonify(body)


def yaml_safe_load(text: str) -> object:
    import yaml as _yaml

    return _yaml.safe_load(text)


@app.route("/asset/<path:rel>")
def serve_asset(rel: str) -> object:
    abs_path = _safe_repo_path(rel)
    if not abs_path.exists() or not abs_path.is_file():
        abort(404)
    return send_file(str(abs_path))


@app.route("/repo/<path:rel>")
def serve_repo(rel: str) -> object:
    """Serve any file under the project root by its repo-relative path.

    Used by the editor for things like the photo thumbnail
    (``/repo/design/photo.jpg``) — neater than the absolute-path
    ``/asset/`` route.
    """
    candidate = (REPO / rel).resolve()
    try:
        candidate.relative_to(REPO.resolve())
    except ValueError:
        abort(404)
    if not candidate.exists() or not candidate.is_file():
        abort(404)
    return send_file(str(candidate))


# Allowed image extensions for the photo drag-drop. Limit to the formats
# WeasyPrint (and pretty much every browser) handles natively.
_PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


@app.route("/api/asset/photo", methods=["POST"])
def api_upload_photo() -> object:
    """Save an uploaded photo to ``design/photo.<ext>``.

    Returns the relative path the YAML should reference. The form
    auto-fills ``cv.yaml::photo:`` after a successful upload.
    """
    if not request.files or "file" not in request.files:
        return jsonify({"error": "no file part"}), 400
    upload = request.files["file"]
    if not upload.filename:
        return jsonify({"error": "empty filename"}), 400
    name = upload.filename.lower()
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ""
    if ext not in _PHOTO_EXTS:
        return jsonify({"error": f"unsupported extension {ext!r} — use {sorted(_PHOTO_EXTS)}"}), 400
    design_dir = REPO / "design"
    design_dir.mkdir(parents=True, exist_ok=True)
    out_path = design_dir / f"photo{ext}"
    # Wipe other photo.* variants so we don't leave stale photo.png lying
    # around when the user uploads photo.jpg.
    for stale in design_dir.glob("photo.*"):
        try: stale.unlink()
        except OSError: pass
    upload.save(out_path)
    rel = f"design/photo{ext}"
    return jsonify({"path": rel, "bytes": out_path.stat().st_size})


@app.route("/api/asset/photo", methods=["DELETE"])
def api_delete_photo() -> object:
    """Remove any design/photo.* on disk."""
    design_dir = REPO / "design"
    n = 0
    for stale in design_dir.glob("photo.*"):
        try:
            stale.unlink()
            n += 1
        except OSError:
            pass
    return jsonify({"deleted": n})


@app.route("/api/build", methods=["POST"])
def api_build() -> object:
    """Render content/cv.yaml to a 1-page PDF and return the file.

    Equivalent to running ``python3 engine/build.py`` from the shell, but
    in-process so the editor can offer a "Build PDF" button. On overflow
    or validation failure, returns 400 with a structured error so the UI
    can show a clear message.
    """
    from weasyprint import HTML

    payload = request.get_json(silent=True) or {}
    density = (payload.get("density") or "normal").strip().lower()
    if density not in {"tight", "normal", "airy"}:
        density = "normal"

    cv_path = _resolve_cv_path(payload.get("path") or request.args.get("path"))
    try:
        cv = content_mod.load(cv_path)
    except Exception as exc:
        return jsonify({"error": f"YAML invalid: {exc}"}), 400

    accent = cv.get("accent", "#111111")
    font = cv.get("font", "serif")

    # Imported lazily to keep the server boot light.
    from render import css_base, templates

    base_url = f"file://{REPO}"
    css = css_base.build_css(base_url, accent, font=font)
    full_html = templates.render_document(cv, css, density=density)

    output_dir = REPO / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    # One HTML/PDF per CV variant — keeps cv-research.pdf separate from
    # cv-software.pdf when the user is iterating on multiple.
    stem = cv_path.stem
    html_path = output_dir / f"{stem}.html"
    pdf_path = output_dir / f"{stem}.pdf"
    html_path.write_text(full_html, encoding="utf-8")

    doc = HTML(string=full_html, base_url=base_url).render()
    pages = list(doc.pages)
    if len(pages) > 1:
        # Find the overflowing heading.
        try:
            tree = doc.make_bookmark_tree()
            overflow_label = "(unknown)"
            for entry in _walk_bookmarks(tree):
                if entry["page"] and entry["page"] > 0:
                    overflow_label = entry["label"]
                    break
        except Exception:
            overflow_label = "(unknown)"
        return jsonify({
            "error": "overflow",
            "pages": len(pages),
            "section": overflow_label,
            "hint": f"CV overflowed to {len(pages)} pages. First section on page 2: {overflow_label!r}. Try density=tight or trim a bullet.",
        }), 400

    doc.write_pdf(pdf_path)
    return send_file(str(pdf_path), mimetype="application/pdf",
                     as_attachment=False, download_name="cv.pdf")


def _walk_bookmarks(tree):
    if not tree:
        return
    for entry in tree:
        label, destination, children, _state = entry
        page = destination[0] if destination else None
        yield {"label": label, "page": page}
        yield from _walk_bookmarks(children)


@app.route("/api/schema")
def api_schema() -> object:
    """Expose the section registry to the frontend.

    The form (``form.js``) and outline (``app.js``) consume this to build
    sections dynamically. Adding a SectionDef in
    ``engine/render/sections.py`` shows up here automatically.
    """
    return jsonify({"sections": sections_mod.to_json_dict()})


THEMES_DIR = REPO / "themes"


@app.route("/api/themes/import", methods=["POST"])
def api_themes_import() -> object:
    """Fetch a theme JSON from a URL and save it under ``themes/``.

    Body: ``{"url": "https://gist.githubusercontent.com/.../raw/.../theme.json"}``.
    Returns the saved theme metadata. Validates the JSON shape before
    writing — refuses to import anything that doesn't look like a theme.
    """
    import json as _json
    from urllib.parse import urlparse
    from urllib.request import Request, urlopen

    payload = request.get_json(silent=True) or {}
    url = (payload.get("url") or "").strip()
    if not url:
        return jsonify({"error": "missing url"}), 400
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return jsonify({"error": "url must be http or https"}), 400

    try:
        req = Request(url, headers={"User-Agent": "cv-editor/1.0"})
        with urlopen(req, timeout=8) as resp:  # noqa: S310 — explicit user URL
            raw = resp.read(64 * 1024)  # cap at 64 KB
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"fetch failed: {exc}"}), 400

    try:
        data = _json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"not valid JSON: {exc}"}), 400
    if not isinstance(data, dict):
        return jsonify({"error": "JSON root must be an object"}), 400
    if "accent" not in data or "name" not in data:
        return jsonify({"error": "JSON must include at least 'name' and 'accent'"}), 400

    # Sanitise the filename — derive from the theme name.
    raw_name = str(data.get("name") or "imported")
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in raw_name.lower())
    safe = safe.strip("-") or "imported"
    THEMES_DIR.mkdir(parents=True, exist_ok=True)
    out_path = THEMES_DIR / f"{safe}.json"
    out_path.write_text(_json.dumps(data, indent=2), encoding="utf-8")

    return jsonify({
        "id": safe,
        "name": data.get("name"),
        "accent": data.get("accent"),
        "font": data.get("font", "serif"),
        "density": data.get("density", "normal"),
        "saved": str(out_path.relative_to(REPO)),
    })


@app.route("/api/themes")
def api_themes() -> object:
    """List the JSON theme presets in ``themes/``.

    Each theme is a JSON file at the repo root's ``themes/`` folder.
    Schema: ``{name, accent, font, density}`` — extra fields ignored.
    """
    import json as _json

    out: list[dict[str, object]] = []
    if THEMES_DIR.is_dir():
        for path in sorted(THEMES_DIR.glob("*.json")):
            try:
                data = _json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            out.append({
                "id": path.stem,
                "name": data.get("name", path.stem.title()),
                "accent": data.get("accent", "#111111"),
                "font": data.get("font", "serif"),
                "density": data.get("density", "normal"),
            })
    return jsonify({"themes": out})


def main() -> int:
    port = DEFAULT_PORT
    print(f"CV editor → http://127.0.0.1:{port}")
    print(f"  cv.yaml: {CV_FILE.relative_to(REPO)}")
    print(f"  Ctrl+C to stop")
    app.run(host="127.0.0.1", port=port, debug=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
