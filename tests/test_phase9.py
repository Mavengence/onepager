"""Tests for the Phase 9 batch — multi-CV, polish, theme import, photo asset."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "engine"))
sys.path.insert(0, str(REPO / "tools" / "editor"))

from render import ai_extract  # noqa: E402


@pytest.fixture
def app_client(tmp_path, monkeypatch):
    """Spin up the Flask app with content/themes redirected to tmp dirs."""
    # Redirect CONTENT_DIR + THEMES_DIR + REPO output to a temp tree so
    # tests can't clobber the real cv.yaml.
    repo_tmp = tmp_path / "cv-test"
    (repo_tmp / "content").mkdir(parents=True)
    (repo_tmp / "themes").mkdir(parents=True)
    (repo_tmp / "design").mkdir(parents=True)
    (repo_tmp / "output").mkdir(parents=True)
    # Seed minimal cv.yaml so /api/cv works
    (repo_tmp / "content" / "cv.yaml").write_text(
        "name: Test\ncontact:\n  - { label: x, href: 'mailto:x@example.com' }\n"
        "experience:\n  - role: Eng\n    company: Acme\n    location: x\n    "
        "start: '2020'\n    end: 'Present'\n    bullets:\n      - 'A bullet'\n",
        encoding="utf-8",
    )
    # Existing theme to start with
    (repo_tmp / "themes" / "default.json").write_text(
        json.dumps({"name": "Default", "accent": "#111111", "font": "serif", "density": "normal"}),
        encoding="utf-8",
    )

    # Patch path constants in the server module before import so the
    # routes wire up against the tmp tree.
    import importlib

    server = importlib.import_module("server")
    monkeypatch.setattr(server, "REPO", repo_tmp)
    monkeypatch.setattr(server, "CONTENT_DIR", repo_tmp / "content")
    monkeypatch.setattr(server, "STATIC_DIR", repo_tmp / "static")
    monkeypatch.setattr(server, "CV_FILE", repo_tmp / "content" / "cv.yaml")
    monkeypatch.setattr(server, "THEMES_DIR", repo_tmp / "themes")

    server.app.config.update(TESTING=True)
    return server.app.test_client(), repo_tmp


class TestMultiCvEndpoints:
    def test_list_cvs(self, app_client):
        client, repo = app_client
        # Add a second CV
        (repo / "content" / "cv-research.yaml").write_text("name: Test\ncontact: []\n", encoding="utf-8")
        res = client.get("/api/cvs")
        assert res.status_code == 200
        data = res.get_json()
        names = [c["path"] for c in data["cvs"]]
        assert "cv.yaml" in names
        assert "cv-research.yaml" in names

    def test_load_specific_cv(self, app_client):
        client, repo = app_client
        (repo / "content" / "cv-other.yaml").write_text("name: Other\n", encoding="utf-8")
        res = client.get("/api/cv?path=cv-other.yaml")
        assert res.status_code == 200
        assert "name: Other" in res.get_data(as_text=True)

    def test_save_to_path(self, app_client):
        client, repo = app_client
        body = {"path": "cv-new.yaml", "content": "name: New\n"}
        res = client.post("/api/cv", json=body)
        assert res.status_code == 200
        assert (repo / "content" / "cv-new.yaml").exists()

    def test_path_traversal_rejected(self, app_client):
        client, _ = app_client
        res = client.get("/api/cv?path=../../etc/passwd")
        assert res.status_code in (400, 404)


class TestPhotoUpload:
    def test_upload_jpg(self, app_client):
        client, repo = app_client
        from io import BytesIO
        res = client.post(
            "/api/asset/photo",
            data={"file": (BytesIO(b"\xff\xd8\xff\xe0fake"), "test.jpg")},
            content_type="multipart/form-data",
        )
        assert res.status_code == 200
        data = res.get_json()
        assert data["path"] == "design/photo.jpg"
        assert (repo / "design" / "photo.jpg").exists()

    def test_unsupported_extension_rejected(self, app_client):
        client, _ = app_client
        from io import BytesIO
        res = client.post(
            "/api/asset/photo",
            data={"file": (BytesIO(b"hello"), "test.txt")},
            content_type="multipart/form-data",
        )
        assert res.status_code == 400

    def test_delete_photo(self, app_client):
        client, repo = app_client
        (repo / "design" / "photo.jpg").write_bytes(b"x")
        res = client.delete("/api/asset/photo")
        assert res.status_code == 200
        assert not (repo / "design" / "photo.jpg").exists()


class TestThemeImport:
    def test_import_invalid_url_rejected(self, app_client):
        client, _ = app_client
        res = client.post("/api/themes/import", json={"url": "ftp://invalid"})
        assert res.status_code == 400


class TestPolishEndpoint:
    def test_returns_503_without_key(self, app_client, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        client, _ = app_client
        res = client.post("/api/polish/bullet", json={"text": "did stuff"})
        assert res.status_code == 503

    def test_validates_input(self, app_client, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-fake")
        # Even with a (fake) key set, an empty body must 400 before any
        # network call.
        client, _ = app_client
        res = client.post("/api/polish/bullet", json={})
        assert res.status_code == 400

    def test_section_validates_input(self, app_client, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-fake")
        client, _ = app_client
        res = client.post("/api/polish/section", json={"bullets": []})
        assert res.status_code == 400


class TestRepoRouteSafety:
    def test_repo_route_serves_existing_file(self, app_client):
        client, repo = app_client
        (repo / "design" / "test.txt").write_text("ok", encoding="utf-8")
        res = client.get("/repo/design/test.txt")
        assert res.status_code == 200
        assert res.get_data(as_text=True) == "ok"

    def test_repo_route_rejects_traversal(self, app_client):
        client, _ = app_client
        res = client.get("/repo/../etc/passwd")
        # Either Flask normalises to 404 or our guard kicks in (404).
        assert res.status_code in (400, 404)
