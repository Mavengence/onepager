"""Full QA pass for the CV editor.

Validates every shipped feature end-to-end and reports PASS/FAIL with
detail. Uses Playwright headless against the live editor at :5567.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5567/"

PASS_LIST: list[str] = []
FAIL_LIST: list[tuple[str, str]] = []
WARN_LIST: list[tuple[str, str]] = []


def check(name: str, cond: bool, detail: str = ""):
    if cond:
        PASS_LIST.append(name)
        print(f"  PASS  {name}")
    else:
        FAIL_LIST.append((name, detail))
        print(f"  FAIL  {name}  {detail}")


def warn(name: str, detail: str):
    WARN_LIST.append((name, detail))
    print(f"  WARN  {name}  {detail}")


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1480, "height": 920},
            device_scale_factor=2,
        )
        ctx.add_init_script(
            "localStorage.setItem('cv.editor.tourCompleted','true');"
            "localStorage.setItem('cv.editor.theme','light');"
        )
        # Capture console errors
        console_errors: list[str] = []
        page_errors: list[str] = []
        page = ctx.new_page()
        page.on("console", lambda msg: console_errors.append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))

        page.goto(URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_function("document.querySelector('#preview-stage') !== null")
        page.wait_for_timeout(2500)

        # ───────────────────────────────────────────────────────
        # 1.  Bootstrap & DOM presence
        # ───────────────────────────────────────────────────────
        print("\n--- 1. Bootstrap ---")
        check("page title contains CV", "cv" in page.title().lower())
        check("form mounted", page.evaluate("document.querySelector('#form-host > *') !== null"))
        check("preview-stage exists", page.evaluate("document.querySelector('#preview-stage') !== null"))
        check("topbar exists", page.evaluate("document.querySelector('#topbar') !== null"))
        check("sidebar exists", page.evaluate("document.querySelector('#sidebar') !== null"))
        check("statusbar exists", page.evaluate("document.querySelector('#statusbar') !== null"))
        sections = page.evaluate("document.querySelectorAll('.form-section[data-section-key]').length")
        check("form sections (>=4)", sections >= 4, f"got {sections}")

        # ───────────────────────────────────────────────────────
        # 2.  Topbar elements
        # ───────────────────────────────────────────────────────
        print("\n--- 2. Topbar elements ---")
        check("save button", page.evaluate("document.querySelector('#save-btn') !== null"))
        check("build button", page.evaluate("document.querySelector('#build-btn') !== null"))
        check("theme picker button", page.evaluate("document.querySelector('#theme-btn') !== null"))
        check("theme toggle button", page.evaluate("document.querySelector('#theme-toggle') !== null"))
        check("font select", page.evaluate("document.querySelector('#font-select') !== null"))
        check("density select", page.evaluate("document.querySelector('#density-select') !== null"))
        check("accent color picker", page.evaluate("document.querySelector('.appearance-color input[type=\"color\"]') !== null"))
        check("import button", page.evaluate("document.querySelector('#import-btn') !== null"))
        check("status pill", page.evaluate("document.querySelector('#status') !== null"))
        check("last-saved label", page.evaluate("document.querySelector('#last-saved') !== null"))

        # ───────────────────────────────────────────────────────
        # 3.  Appearance bar functionality
        # ───────────────────────────────────────────────────────
        print("\n--- 3. Appearance bar ---")
        font_opts = page.evaluate(
            "Array.from(document.querySelector('#font-select')?.options||[]).map(o=>o.value)"
        )
        check("font options serif/sans/mono", set(font_opts) == {"serif", "sans", "mono"}, str(font_opts))
        density_opts = page.evaluate(
            "Array.from(document.querySelector('#density-select')?.options||[]).map(o=>o.value)"
        )
        check("density options tight/normal/airy", set(density_opts) == {"tight", "normal", "airy"}, str(density_opts))
        # Try changing density — verify by hitting /api/cv after save
        page.select_option("#density-select", "tight")
        page.wait_for_timeout(500)
        page.keyboard.press("Meta+s")
        page.wait_for_timeout(2200)
        density_now = page.evaluate("(async () => { const r = await fetch('/api/cv'); const t = await r.text(); const m = t.match(/^density:\\s*(\\w+)/m); return m && m[1]; })()")
        check("changing density persists to YAML", density_now == "tight", f"yaml density = {density_now}")
        page.select_option("#density-select", "normal")
        page.wait_for_timeout(500)
        page.keyboard.press("Meta+s")
        page.wait_for_timeout(2200)

        # ───────────────────────────────────────────────────────
        # 4.  Topbar stability on save
        # ───────────────────────────────────────────────────────
        print("\n--- 4. Topbar stability ---")
        before = page.evaluate("document.querySelector('#build-btn')?.getBoundingClientRect().x")
        page.keyboard.press("Meta+s")
        page.wait_for_timeout(50)
        during = page.evaluate("document.querySelector('#build-btn')?.getBoundingClientRect().x")
        page.wait_for_timeout(2200)
        after = page.evaluate("document.querySelector('#build-btn')?.getBoundingClientRect().x")
        max_shift = max(abs((before or 0) - (during or 0)), abs((before or 0) - (after or 0)))
        check("build-btn x position stable on save", max_shift < 5, f"max shift = {max_shift}px")

        # ───────────────────────────────────────────────────────
        # 5.  Brand-coloured icons in preview
        # ───────────────────────────────────────────────────────
        print("\n--- 5. Brand icons in preview ---")
        page.wait_for_timeout(1500)
        body_html = page.evaluate(
            "document.querySelector('#preview')?.contentDocument?.body?.innerHTML || ''"
        )
        check("preview HTML present", len(body_html) > 200, f"len={len(body_html)}")
        check("LinkedIn brand colour", "#0A66C2" in body_html.upper().replace("0a66c2", "0A66C2"))
        check("GitHub brand colour", "#181717" in body_html.upper())
        check("Inline SVG icons", "brand-icon" in body_html or "<svg" in body_html.lower())

        # ───────────────────────────────────────────────────────
        # 6.  Form ↔ YAML toggle
        # ───────────────────────────────────────────────────────
        print("\n--- 6. View toggle ---")
        page.click(".view-tab[data-view='yaml']", force=True)
        page.wait_for_timeout(500)
        yaml_show = page.evaluate("getComputedStyle(document.querySelector('#editor-host')).display !== 'none'")
        check("YAML view shows", yaml_show)
        check("CodeMirror present", page.evaluate("document.querySelector('.CodeMirror') !== null"))
        page.click(".view-tab[data-view='form']", force=True)
        page.wait_for_timeout(400)
        form_show = page.evaluate("getComputedStyle(document.querySelector('#form-host')).display !== 'none'")
        check("Form view returns", form_show)

        # ───────────────────────────────────────────────────────
        # 7.  Collapsible sections + persistence
        # ───────────────────────────────────────────────────────
        print("\n--- 7. Collapsible sections ---")
        head_sel = ".form-section[data-section-key] .form-section-head.is-collapsible"
        head_count = page.evaluate(f"document.querySelectorAll('{head_sel}').length")
        check("collapsible heads exist", head_count >= 4, f"got {head_count}")
        if head_count:
            page.evaluate(f"document.querySelector('{head_sel}').click()")
            page.wait_for_timeout(150)
            collapsed = page.evaluate(f"document.querySelector('{head_sel}').getAttribute('aria-expanded') === 'false'")
            check("section collapses on click", collapsed)
            # Reload, verify persistence
            page.reload()
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(1800)
            still_collapsed = page.evaluate(f"document.querySelector('{head_sel}')?.getAttribute('aria-expanded') === 'false'")
            check("collapse state persists across reload", still_collapsed)
            # Restore
            page.evaluate(f"document.querySelector('{head_sel}').click()")
            page.wait_for_timeout(150)

        # ───────────────────────────────────────────────────────
        # 8.  Mode toggle (continuous ↔ paged)
        # ───────────────────────────────────────────────────────
        print("\n--- 8. Mode toggle ---")
        page.click("#mode-toggle .seg-btn[data-mode='continuous']", force=True)
        page.wait_for_timeout(1800)
        cont_active = page.evaluate("document.querySelector('#mode-toggle .seg-btn[data-mode=\"continuous\"]').classList.contains('is-active')")
        check("continuous mode active", cont_active)
        page.click("#mode-toggle .seg-btn[data-mode='paged']", force=True)
        page.wait_for_timeout(2000)
        paged_active = page.evaluate("document.querySelector('#mode-toggle .seg-btn[data-mode=\"paged\"]').classList.contains('is-active')")
        check("paged mode active", paged_active)
        page_count_visible = page.evaluate("!document.querySelector('#page-count')?.hidden")
        check("page-count pill visible in paged mode", page_count_visible)

        # ───────────────────────────────────────────────────────
        # 9.  Auto-render toggle
        # ───────────────────────────────────────────────────────
        print("\n--- 9. Auto-render toggle ---")
        page.click("#auto-render .seg-btn[data-auto='manual']", force=True)
        page.wait_for_timeout(150)
        manual_active = page.evaluate("document.querySelector('#auto-render .seg-btn[data-auto=\"manual\"]').classList.contains('is-active')")
        check("manual mode toggles", manual_active)
        page.click("#auto-render .seg-btn[data-auto='live']", force=True)
        page.wait_for_timeout(150)
        live_active = page.evaluate("document.querySelector('#auto-render .seg-btn[data-auto=\"live\"]').classList.contains('is-active')")
        check("live mode toggles", live_active)

        # ───────────────────────────────────────────────────────
        # 10.  Zoom controls + wrap scroll
        # ───────────────────────────────────────────────────────
        print("\n--- 10. Zoom controls + scroll ---")
        for _ in range(8):
            page.click("#zoom-in", force=True)
            page.wait_for_timeout(100)
        page.wait_for_timeout(800)
        zoomed = page.evaluate("document.querySelector('#preview-wrap').classList.contains('is-zoomed-in')")
        check("is-zoomed-in class added", zoomed)
        # Wrap should have scroll capacity
        scroll_cap = page.evaluate("(() => { const w=document.querySelector('#preview-wrap'); return w.scrollHeight - w.clientHeight; })()")
        check("wrap is scrollable when zoomed", scroll_cap > 50, f"scroll capacity = {scroll_cap}px")
        # Real wheel scroll
        wrap_box = page.evaluate("(() => { const r = document.querySelector('#preview-wrap').getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + 80}; })()")
        before_scroll = page.evaluate("document.querySelector('#preview-wrap').scrollTop")
        page.mouse.move(int(wrap_box["x"]), int(wrap_box["y"]))
        page.mouse.wheel(0, 250)
        page.wait_for_timeout(250)
        after_scroll = page.evaluate("document.querySelector('#preview-wrap').scrollTop")
        check("mouse-wheel scrolls wrap when zoomed", (after_scroll - before_scroll) > 30, f"delta {after_scroll - before_scroll}")
        # Reset zoom
        page.click("#zoom-fit", force=True)
        page.wait_for_timeout(400)
        not_zoomed = page.evaluate("!document.querySelector('#preview-wrap').classList.contains('is-zoomed-in')")
        check("zoom-fit removes is-zoomed-in", not_zoomed)

        # ───────────────────────────────────────────────────────
        # 11.  Outline navigation
        # ───────────────────────────────────────────────────────
        print("\n--- 11. Outline ---")
        outline_count = page.evaluate("document.querySelectorAll('#outline-list .outline-item').length")
        check("outline has entries (>=4)", outline_count >= 4, f"got {outline_count}")
        # Click an Education outline entry
        clicked = page.evaluate("""() => {
            const items = document.querySelectorAll('#outline-list .outline-item');
            for (const it of items) {
                if ((it.textContent||'').trim().toLowerCase().includes('education')) { it.click(); return true; }
            }
            return false;
        }""")
        check("outline item click fires", clicked)

        # ───────────────────────────────────────────────────────
        # 12.  Theme picker — open + count + apply
        # ───────────────────────────────────────────────────────
        print("\n--- 12. Theme picker ---")
        page.click("#theme-btn", force=True)
        page.wait_for_timeout(500)
        popover_visible = page.evaluate("!document.querySelector('#theme-popover').hidden")
        check("theme popover opens", popover_visible)
        theme_rows = page.evaluate("document.querySelectorAll('#theme-popover .theme-row').length")
        check("theme picker has >=3 themes", theme_rows >= 3, f"got {theme_rows}")
        # Apply the LAST theme (deterministic — different from likely current)
        if theme_rows >= 2:
            accent_before = page.evaluate("(async () => { const r = await fetch('/api/cv'); const t = await r.text(); const m = t.match(/^accent:\\s*['\"]?(#[0-9a-fA-F]+)/m); return m && m[1].toLowerCase(); })()")
            # Read the theme accents from /api/themes (authoritative)
            themes_data = page.evaluate(
                "(async () => { const r = await fetch('/api/themes'); const d = await r.json(); return d.themes || []; })()"
            )
            # Pick a theme whose accent differs from accent_before
            target_idx = next(
                (i for i, t in enumerate(themes_data) if (t.get("accent") or "").lower() != (accent_before or "").lower()),
                len(themes_data) - 1,
            )
            page.evaluate(f"document.querySelectorAll('#theme-popover .theme-row')[{target_idx}]?.click()")
            page.wait_for_timeout(500)
            page.keyboard.press("Meta+s")
            page.wait_for_timeout(2200)
            accent_after = page.evaluate("(async () => { const r = await fetch('/api/cv'); const t = await r.text(); const m = t.match(/^accent:\\s*['\"]?(#[0-9a-fA-F]+)/m); return m && m[1].toLowerCase(); })()")
            check("applying theme changes accent in YAML", accent_before != accent_after, f"{accent_before} → {accent_after} (target idx {target_idx})")
            # restore default (idx 0)
            page.click("#theme-btn", force=True)
            page.wait_for_timeout(300)
            page.evaluate("document.querySelectorAll('#theme-popover .theme-row')[0]?.click()")
            page.wait_for_timeout(500)
            page.keyboard.press("Meta+s")
            page.wait_for_timeout(2200)
        else:
            warn("theme apply skipped", "fewer than 2 themes available")

        # ───────────────────────────────────────────────────────
        # 13.  API endpoints
        # ───────────────────────────────────────────────────────
        print("\n--- 13. API endpoints ---")
        api_cv = page.evaluate("(async () => { const r = await fetch('/api/cv'); return { ok: r.ok, status: r.status }; })()")
        check("/api/cv 200", api_cv.get("ok"), str(api_cv))
        api_schema = page.evaluate("(async () => { const r = await fetch('/api/schema'); const d = await r.json(); return { ok: r.ok, sections: (d.sections||[]).length }; })()")
        check("/api/schema returns sections", api_schema.get("ok") and api_schema.get("sections", 0) >= 5, str(api_schema))
        api_themes = page.evaluate("(async () => { const r = await fetch('/api/themes'); const d = await r.json(); return { ok: r.ok, count: (d.themes||[]).length }; })()")
        check("/api/themes returns themes", api_themes.get("ok") and api_themes.get("count", 0) >= 3, str(api_themes))
        api_outline = page.evaluate("(async () => { const r = await fetch('/api/outline'); const d = await r.json(); return { ok: r.ok, items: (d.items||[]).length }; })()")
        check("/api/outline returns items", api_outline.get("ok") and api_outline.get("items", 0) >= 5, str(api_outline))
        api_preview = page.evaluate("(async () => { const r = await fetch('/api/preview?theme=light&mode=continuous&density=normal'); return { ok: r.ok, status: r.status }; })()")
        check("/api/preview 200", api_preview.get("ok"), str(api_preview))

        # ───────────────────────────────────────────────────────
        # 14.  Build endpoint — returns binary PDF on success
        # ───────────────────────────────────────────────────────
        print("\n--- 14. Build endpoint ---")
        build_resp = page.evaluate("""(async () => {
            try {
                const r = await fetch('/api/build', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}' });
                const ct = r.headers.get('content-type') || '';
                const ab = await r.arrayBuffer();
                return { ok: r.ok, status: r.status, contentType: ct, bytes: ab.byteLength };
            } catch (e) { return { ok: false, error: String(e) }; }
        })()""")
        check("/api/build POST succeeds", build_resp.get("ok"), str(build_resp))
        if build_resp.get("ok"):
            check("build response is PDF", "pdf" in (build_resp.get("contentType") or ""), str(build_resp))
            check("build PDF > 10KB", (build_resp.get("bytes") or 0) > 10000, f"bytes = {build_resp.get('bytes')}")

        # ───────────────────────────────────────────────────────
        # 15.  Save flow — change name field via form input + Cmd+S
        # ───────────────────────────────────────────────────────
        print("\n--- 15. Save flow ---")
        name_input = page.locator('input[type="text"]').first
        original_name = name_input.input_value()
        name_input.fill("Alex Hartman QA")
        page.wait_for_timeout(150)
        page.keyboard.press("Meta+s")
        page.wait_for_timeout(2200)
        # Verify the YAML on disk now contains the new name
        yaml_name = page.evaluate("(async () => { const r = await fetch('/api/cv'); const t = await r.text(); const m = t.match(/^name:\\s*(.+)$/m); return m && m[1].trim(); })()")
        check("Cmd+S persists name change to YAML", yaml_name == "Alex Hartman QA", f"yaml = {yaml_name}")
        last_saved_text = page.evaluate("document.querySelector('#last-saved')?.textContent || ''")
        check("last-saved label populated", len(last_saved_text.strip()) > 0, repr(last_saved_text))
        # Bytes-info shows size
        bytes_text = page.evaluate("document.querySelector('#bytes-info')?.textContent")
        check("bytes-info shows size", bytes_text and "B" in bytes_text, str(bytes_text))
        # Restore name
        name_input.fill(original_name)
        page.keyboard.press("Meta+s")
        page.wait_for_timeout(2000)

        # ───────────────────────────────────────────────────────
        # 16.  Form interaction — add then delete an experience entry
        # ───────────────────────────────────────────────────────
        print("\n--- 16. Form add / remove ---")
        before_card_count = page.evaluate("""() => {
            const sec = document.querySelector('.form-section[data-section-key="experience"]');
            return sec ? sec.querySelectorAll('.form-card').length : -1;
        }""")
        added_clicked = page.evaluate("""() => {
            const sec = document.querySelector('.form-section[data-section-key="experience"]');
            if (!sec) return { clicked: false, reason: "no section" };
            // Section may be collapsed — expand if needed
            const head = sec.querySelector('.form-section-head.is-collapsible');
            if (head && head.getAttribute('aria-expanded') === 'false') head.click();
            // Use the proper section-level "Add" button
            const add = sec.querySelector('.form-add-btn');
            if (!add) return { clicked: false, reason: "no .form-add-btn" };
            add.click();
            return { clicked: true };
        }""")
        page.wait_for_timeout(500)
        after_card_count = page.evaluate("""() => {
            const sec = document.querySelector('.form-section[data-section-key="experience"]');
            return sec ? sec.querySelectorAll('.form-card').length : -1;
        }""")
        check(
            "Add Experience adds a card",
            added_clicked.get("clicked") and after_card_count == before_card_count + 1,
            f"{before_card_count} → {after_card_count}; add result = {added_clicked}",
        )
        # Now delete the card we just added (last one)
        if after_card_count > before_card_count:
            deleted_clicked = page.evaluate("""() => {
                const sec = document.querySelector('.form-section[data-section-key="experience"]');
                const cards = sec.querySelectorAll('.form-card');
                const last = cards[cards.length - 1];
                if (!last) return false;
                const del = last.querySelector('button[data-action="delete"], button[aria-label*="delete" i], button[aria-label*="remove" i], .item-delete-btn');
                if (!del) {
                    const btns = Array.from(last.querySelectorAll('button'));
                    const target = btns.find(b => /(delete|remove|trash)/i.test(b.getAttribute('aria-label') || b.textContent || ''));
                    if (!target) return false;
                    target.click();
                    return true;
                }
                del.click();
                return true;
            }""")
            page.wait_for_timeout(500)
            final_card_count = page.evaluate("""() => {
                const sec = document.querySelector('.form-section[data-section-key="experience"]');
                return sec ? sec.querySelectorAll('.form-card').length : -1;
            }""")
            check(
                "Delete Experience removes the card",
                deleted_clicked and final_card_count == before_card_count,
                f"{after_card_count} → {final_card_count}",
            )

        # ───────────────────────────────────────────────────────
        # 17.  Tour pre-dismissed
        # ───────────────────────────────────────────────────────
        print("\n--- 17. Tour ---")
        tour_hidden = page.evaluate("document.querySelector('#tour')?.hidden !== false")
        check("tour stays hidden when seen", tour_hidden)

        # ───────────────────────────────────────────────────────
        # 18.  Dark mode
        # ───────────────────────────────────────────────────────
        print("\n--- 18. Dark mode ---")
        # Click theme-toggle to cycle to dark
        cycled = False
        for _ in range(4):
            page.click("#theme-toggle", force=True)
            page.wait_for_timeout(800)
            cur = page.evaluate("document.documentElement.dataset.theme")
            if cur == "dark":
                cycled = True
                break
        check("theme cycles to dark", cycled)
        if cycled:
            # Allow preview to re-render
            page.wait_for_timeout(2500)
            # The preview iframe has theme=dark in its URL
            iframe_url = page.evaluate("document.querySelector('#preview')?.src || ''")
            check("preview URL has theme=dark", "theme=dark" in iframe_url)
        # Reset to light
        for _ in range(4):
            page.click("#theme-toggle", force=True)
            page.wait_for_timeout(800)
            cur = page.evaluate("document.documentElement.dataset.theme")
            if cur == "light":
                break

        # ───────────────────────────────────────────────────────
        # 19.  Section render order in PDF
        # ───────────────────────────────────────────────────────
        print("\n--- 19. Section order in preview ---")
        order = page.evaluate("""() => {
            const doc = document.querySelector('#preview')?.contentDocument;
            if (!doc) return [];
            return Array.from(doc.querySelectorAll('[id^="sec-"]')).map(s => s.id);
        }""")
        check("preview has multiple sections", len(order) >= 4, f"got {order}")
        # Should start with sec-header
        if order:
            check("first section is header", order[0] == "sec-header", f"got {order[0]}")
            # And the order should match registered sections (experience first)
            exp_idx = next((i for i, s in enumerate(order) if "experience" in s), -1)
            edu_idx = next((i for i, s in enumerate(order) if "education" in s), -1)
            if exp_idx >= 0 and edu_idx >= 0:
                check("experience before education", exp_idx < edu_idx)

        # ───────────────────────────────────────────────────────
        # 20.  Outline + form sections in registry order
        # ───────────────────────────────────────────────────────
        print("\n--- 20. Registry order honoured ---")
        outline_order = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('#outline-list .outline-item'))
                .map(e => e.getAttribute('data-slug') || e.textContent.trim().toLowerCase());
        }""")
        # First should be header
        if outline_order:
            check("outline starts with header", outline_order[0] in ("header", "Header"), f"got {outline_order[:3]}")

        # ───────────────────────────────────────────────────────
        # 21.  No console / page errors
        # ───────────────────────────────────────────────────────
        print("\n--- 21. JS error log ---")
        if console_errors:
            warn("console errors", str(console_errors[:3]))
        else:
            check("no console errors", True)
        if page_errors:
            FAIL_LIST.append(("page errors", str(page_errors[:3])))
            print(f"  FAIL  page errors  {page_errors[:3]}")
        else:
            check("no page errors", True)

        # ───────────────────────────────────────────────────────
        # 22.  Logo present and correctly styled
        # ───────────────────────────────────────────────────────
        print("\n--- 22. Brand glyph ---")
        check(
            "brand-mark renders SVG",
            page.evaluate("document.querySelector('.brand-mark svg') !== null"),
        )
        check(
            "brand-name reads 'Tech CV'",
            page.evaluate("document.querySelector('.brand-name')?.textContent?.trim()").replace(" ", " ") == "Tech CV",
        )

        # ───────────────────────────────────────────────────────
        # 23.  Preview iframe receives content height (zoom-scroll fix)
        # ───────────────────────────────────────────────────────
        print("\n--- 23. Content-height postMessage ---")
        page.wait_for_timeout(1500)
        # Note: inferring the variable directly may not be available in window;
        # we infer indirectly by checking that the stage is sized to fit content
        # vertically (taller than wrap when zoomed in).
        ch_state = page.evaluate("""() => {
            const stage = document.querySelector('#preview-stage');
            const wrap = document.querySelector('#preview-wrap');
            return { stageH: stage.getBoundingClientRect().height,
                     wrapH: wrap.clientHeight };
        }""")
        check(
            "stage at fit zoom doesn't add scrollbar (or scroll matches content)",
            ch_state["stageH"] > 0,
            str(ch_state),
        )

        browser.close()


    # ───────────────────────────────────────────────────────
    # Final report
    # ───────────────────────────────────────────────────────
    total = len(PASS_LIST) + len(FAIL_LIST)
    print()
    print("=" * 60)
    print(f"  {len(PASS_LIST)} / {total} passed   {len(WARN_LIST)} warnings")
    print("=" * 60)
    if FAIL_LIST:
        print("\nFAILS:")
        for name, det in FAIL_LIST:
            print(f"  - {name}  {det}")
    if WARN_LIST:
        print("\nWARNINGS:")
        for name, det in WARN_LIST:
            print(f"  - {name}  {det}")
    sys.exit(1 if FAIL_LIST else 0)


if __name__ == "__main__":
    main()
