"""
tests/test_frontend.py - Lightweight static contract tests for the frontend.

pytest can't execute JS, so these tests use targeted parsing (regex / brace
matching) of the actual shipped files to catch the two classes of bug the
audit cares about most:

  1. A data-info="key" reference in index.html or app.js that has no
     matching entry in glossary.js (a dead/broken info icon).
  2. A glossary.js entry that's missing one of the required explanation
     fields (an incomplete info popover).

These are NOT a JS interpreter — they check structure/text, not runtime
behavior. That's intentional and sufficient for a static content contract.
"""

import re
from pathlib import Path

import pytest

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@pytest.fixture(scope="module")
def glossary_text():
    return (FRONTEND_DIR / "glossary.js").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def glossary_keys(glossary_text):
    """Top-level keys of the QV_GLOSSARY object, e.g. `rsi: {`."""
    # Matches lines like "  rsi: {" at 2-space indent inside the object body.
    return set(re.findall(r"^\s{2}([a-zA-Z_][a-zA-Z0-9_]*):\s*\{", glossary_text, re.MULTILINE))


@pytest.fixture(scope="module")
def index_html_text():
    return (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def app_js_text():
    return (FRONTEND_DIR / "app.js").read_text(encoding="utf-8")


def _referenced_info_keys(*texts):
    keys = set()
    for text in texts:
        keys |= set(re.findall(r"data-info=\"([a-zA-Z_0-9]+)\"", text))
        keys |= set(re.findall(r"info:\s*'([a-zA-Z_0-9]+)'", text))
        keys |= set(re.findall(r'info:\s*"([a-zA-Z_0-9]+)"', text))
    return keys


class TestGlossaryFiles:

    def test_glossary_file_exists(self):
        assert (FRONTEND_DIR / "glossary.js").exists()

    def test_infobox_file_exists(self):
        assert (FRONTEND_DIR / "infobox.js").exists()

    def test_glossary_exports_to_window(self, glossary_text):
        assert "window.QV_GLOSSARY" in glossary_text

    def test_glossary_has_a_meaningful_number_of_entries(self, glossary_keys):
        # Sanity floor — the full metric list in the audit spec is 30+.
        assert len(glossary_keys) >= 25, (
            f"Expected a comprehensive glossary, only found {len(glossary_keys)} entries"
        )


class TestGlossaryCompleteness:
    """Every glossary entry must answer: what is it / how to interpret it /
    how QuantView uses it / caution — per the audit's explanation spec."""

    REQUIRED_FIELDS = ["title", "what_it_is", "how_to_interpret", "how_quantview_uses_it", "caution"]

    def _entry_block(self, glossary_text, key):
        """Extract the raw text of one top-level entry by brace matching."""
        m = re.search(rf"^\s{{2}}{re.escape(key)}:\s*\{{", glossary_text, re.MULTILINE)
        assert m, f"Could not locate entry for '{key}'"
        start = m.end() - 1  # position of the opening brace
        depth = 0
        for i in range(start, len(glossary_text)):
            if glossary_text[i] == "{":
                depth += 1
            elif glossary_text[i] == "}":
                depth -= 1
                if depth == 0:
                    return glossary_text[start:i + 1]
        raise AssertionError(f"Unbalanced braces while parsing entry '{key}'")

    def test_every_entry_has_all_required_fields(self, glossary_text, glossary_keys):
        missing = {}
        for key in sorted(glossary_keys):
            block = self._entry_block(glossary_text, key)
            missing_fields = [f for f in self.REQUIRED_FIELDS if f"{f}:" not in block]
            if missing_fields:
                missing[key] = missing_fields
        assert not missing, f"Glossary entries missing required fields: {missing}"


class TestInfoIconCoverage:
    """Every ⓘ button referenced from the UI must resolve to a real glossary entry."""

    def test_every_referenced_info_key_exists_in_glossary(self, index_html_text, app_js_text, glossary_keys):
        referenced = _referenced_info_keys(index_html_text, app_js_text)
        missing = referenced - glossary_keys
        assert not missing, f"data-info keys referenced in the UI but missing from glossary.js: {missing}"

    def test_at_least_one_info_icon_present_in_html(self, index_html_text):
        assert 'class="info-btn"' in index_html_text

    def test_glossary_and_infobox_scripts_loaded_before_app_js(self, index_html_text):
        gi = index_html_text.index('glossary.js')
        ii = index_html_text.index('infobox.js')
        ai = index_html_text.index('app.js')
        assert gi < ai and ii < ai, "glossary.js and infobox.js must load before app.js"


class TestInfoboxAccessibility:

    def test_escape_key_closes_popover(self):
        text = (FRONTEND_DIR / "infobox.js").read_text(encoding="utf-8")
        assert "'Escape'" in text

    def test_click_outside_closes_popover(self):
        text = (FRONTEND_DIR / "infobox.js").read_text(encoding="utf-8")
        assert "_onDocClick" in text

    def test_aria_expanded_is_toggled(self):
        text = (FRONTEND_DIR / "infobox.js").read_text(encoding="utf-8")
        assert "aria-expanded" in text

    def test_popover_uses_semantic_role(self):
        text = (FRONTEND_DIR / "infobox.js").read_text(encoding="utf-8")
        assert "role', 'dialog'" in text


class TestFrontendCoreArchitecture:
    """Ensure essential helper functions and event handlers exist to avoid runtime ReferenceErrors."""

    def test_escape_html_helper_defined(self, app_js_text):
        assert "function escapeHtml" in app_js_text

    def test_platform_settings_defined(self, app_js_text):
        assert "function getPlatformSettings" in app_js_text
        assert "function savePlatformSettings" in app_js_text

    def test_canonical_navigation_defined(self, app_js_text):
        assert "window.navigateToAsset" in app_js_text

    def test_live_quote_service_script_loaded_before_app_js(self, index_html_text):
        lqi = index_html_text.index('services/liveQuoteService.js')
        ai = index_html_text.index('app.js')
        assert lqi < ai, "services/liveQuoteService.js must load before app.js"
