"""Tests for engine/render/brand_icons.py."""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "engine"))

from render import brand_icons  # noqa: E402


class TestNormalise:
    def test_known_network_lowercased(self):
        assert brand_icons.normalise("LinkedIn") == "linkedin"
        assert brand_icons.normalise("GitHub") == "github"

    def test_aliases_resolve(self):
        assert brand_icons.normalise("twitter") == "x"
        assert brand_icons.normalise("scholar") == "googlescholar"
        assert brand_icons.normalise("email") == "mail"
        assert brand_icons.normalise("Stack Overflow") == "stackoverflow"

    def test_unknown_returns_none(self):
        assert brand_icons.normalise("FacebookMessenger") is None
        assert brand_icons.normalise("") is None
        assert brand_icons.normalise(None) is None


class TestSvgFor:
    def test_returns_inline_svg_with_brand_color(self):
        svg = brand_icons.svg_for("linkedin")
        assert svg.startswith("<svg")
        assert "viewBox" in svg
        # LinkedIn's brand colour
        assert "#0A66C2" in svg
        assert "brand-icon" in svg

    def test_mono_uses_currentcolor(self):
        svg = brand_icons.svg_for("linkedin", mono=True)
        assert "currentColor" in svg
        assert "#0A66C2" not in svg

    def test_unknown_returns_empty(self):
        assert brand_icons.svg_for("nonexistent") == ""

    def test_size_is_passed(self):
        svg = brand_icons.svg_for("github", size=24)
        assert 'width="24"' in svg
        assert 'height="24"' in svg

    def test_color_for_known_brands(self):
        assert brand_icons.color_for("linkedin") == "#0A66C2"
        assert brand_icons.color_for("github") == "#181717"
        assert brand_icons.color_for("nonexistent") is None


class TestUrlFor:
    def test_explicit_href_wins(self):
        assert brand_icons.url_for("linkedin", "alice", "https://example.com") == "https://example.com"

    def test_template_applied(self):
        assert brand_icons.url_for("linkedin", "alice") == "https://www.linkedin.com/in/alice"
        assert brand_icons.url_for("github", "alice") == "https://github.com/alice"
        assert brand_icons.url_for("mail", "alice@example.com") == "mailto:alice@example.com"

    def test_no_username_returns_empty(self):
        assert brand_icons.url_for("linkedin") == ""


class TestLabelFor:
    def test_explicit_label_wins(self):
        assert brand_icons.label_for("linkedin", "alice", "My LinkedIn") == "My LinkedIn"

    def test_username_falls_through(self):
        assert brand_icons.label_for("linkedin", "alice") == "alice"

    def test_mail_shows_address(self):
        assert brand_icons.label_for("mail", "alice@example.com") == "alice@example.com"

    def test_phone_shows_number(self):
        assert brand_icons.label_for("phone", "+1 555 0100") == "+1 555 0100"


def test_supported_networks_includes_brands():
    assert "linkedin" in brand_icons.SUPPORTED_NETWORKS
    assert "github" in brand_icons.SUPPORTED_NETWORKS
    assert "mail" in brand_icons.SUPPORTED_NETWORKS  # generic icon also exposed
