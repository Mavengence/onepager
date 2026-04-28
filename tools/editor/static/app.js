/* ============================================================================
   CV Editor — single-file YAML editor with paged.js preview.

   Adapted from the books editor. Key patterns kept verbatim because they
   silently break the editor if reimplemented:
     • setupResponsiveLayout — without this, CodeMirror's lower half goes
       blank when the window is resized or the sidebar toggles.
     • setupZoomControls / applyZoom / effectiveZoom — fit-to-width formula
       depends on A4_PX = 794 (210 mm at 96 dpi).
     • paged.js postMessage handler — listens for "paged-rendered" from the
       iframe and updates the page-count pill (red on overflow).
   ============================================================================ */
(function () {
  "use strict";

  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ──────────────────────────────────────────────────────────────────────
  //  CONSTANTS
  // ──────────────────────────────────────────────────────────────────────
  const A4_PX     = 794;     // 210 mm at 96 dpi
  const ZOOM_MIN  = 0.30;
  const ZOOM_MAX  = 3.00;
  const ZOOM_STEP = 0.10;

  const SPLIT_KEY    = "cv.editor.split";
  const THEME_KEY    = "cv.editor.theme";
  const ZOOM_KEY     = "cv.editor.previewZoom";
  const MODE_KEY     = "cv.editor.previewMode";
  const SIDEBAR_KEY  = "cv.editor.sidebar";
  const DENSITY_KEY  = "cv.editor.density";
  const FONT_KEY     = "cv.editor.font";
  const VIEW_KEY     = "cv.editor.view";
  const AUTO_KEY     = "cv.editor.autoRender";
  const LINT_KEY     = "cv.editor.lintOnSave";
  const CV_PATH_KEY  = "cv.editor.activePath";
  const HISTORY_KEY  = "cv.editor.history";   // namespaced per CV path
  const HISTORY_MAX  = 40;
  const COLLAPSED_KEY = "cv.editor.collapsed"; // namespaced per CV path

  // Typing → preview debounce. Long enough to feel calm, short enough to
  // feel alive when you stop typing. Only applies in Live mode.
  const CONTENT_DEBOUNCE_MS = 400;

  // ──────────────────────────────────────────────────────────────────────
  //  STATE
  // ──────────────────────────────────────────────────────────────────────
  let editor = null;
  let dirty = false;
  let lastSavedContent = "";
  let lastSavedAt = null;
  let previewMode = localStorage.getItem(MODE_KEY) || "paged";
  if (!["continuous", "paged"].includes(previewMode)) previewMode = "paged";
  let previewZoom = parseFloat(localStorage.getItem(ZOOM_KEY) || "0") || 0;
  // CV content dimensions (px) — reported by the iframe via postMessage.
  // applyZoom() uses these to size the stage tall and wide enough to fit
  // the entire CV without iframe-internal scrolling.
  let cvContentHeight = 0;
  let cvContentWidth = 794;  // 210mm at 96dpi — sane default for A4
  // ``density`` and ``font`` are now canonical YAML fields on cvModel.
  // These two getters fall back to defaults so the URL builders below
  // can read them safely even before the model loads.
  const getDensity = () => {
    const d = (cvModel && cvModel.density) || "normal";
    return ["tight", "normal", "airy"].includes(d) ? d : "normal";
  };
  const getFont = () => {
    const f = (cvModel && cvModel.font) || "serif";
    return ["serif", "sans", "mono"].includes(f) ? f : "serif";
  };

  let outlineItems = [];
  let pendingScrollTarget = null;
  let previewTimer = null;
  let autosaveTimer = null;
  let lastPagedCount = null;
  let viewMode = localStorage.getItem(VIEW_KEY) || "form";
  if (!["form", "yaml"].includes(viewMode)) viewMode = "form";

  // Auto-render toggle: Live (default) re-renders on debounced edits;
  // Manual waits for the user to click Refresh.
  const storedAuto = localStorage.getItem(AUTO_KEY);
  let autoRender = storedAuto == null ? true : storedAuto === "true";
  // pendingRefresh is set when content edits arrive in Manual mode.
  let pendingRefresh = false;

  // YAML auto-lint on save. ONLY runs on user-initiated saves (Cmd+S,
  // Save button), NEVER on the 1.5 s idle autosave — the cursor jump
  // mid-typing is unbearable. Toggle is visible only in YAML view.
  const storedLint = localStorage.getItem(LINT_KEY);
  let lintOnSave = storedLint == null ? true : storedLint === "true";

  // Active CV variant (filename within content/). The user can keep
  // multiple variants — cv.yaml, cv-research.yaml, cv-software.yaml —
  // and switch via the topbar dropdown.
  let activeCvPath = localStorage.getItem(CV_PATH_KEY) || "cv.yaml";

  // Canonical CV model. Form view mutates this directly; YAML view writes
  // its parsed value back here on every change. The form module holds a
  // reference to this *same object*, so we replace its CONTENTS rather than
  // reassigning the variable — otherwise the form keeps rendering against
  // the original empty version.
  const cvModel = {};
  let formApi = null;
  let suppressEditorOnEdit = false;

  function replaceModel(newModel) {
    for (const k of Object.keys(cvModel)) delete cvModel[k];
    Object.assign(cvModel, newModel || {});
  }

  // ──────────────────────────────────────────────────────────────────────
  //  HISTORY — undo/redo persisted in localStorage. Cmd+Z / Cmd+Shift+Z.
  //
  //  Pattern: ``presentSnapshot`` tracks the last "settled" state. On an
  //  edit, the debounced recordHistory pushes the OLD presentSnapshot
  //  to ``historyPast`` and updates presentSnapshot to the new state.
  //  Undo pops past → restores it; redo pops future. This avoids the
  //  "undo to current state" bug where the most recent record == now.
  // ──────────────────────────────────────────────────────────────────────
  let historyPast = [];   // older settled snapshots, newest at the end
  let historyFuture = []; // future for redo after an undo
  let presentSnapshot = ""; // last debounced canonical snapshot
  let historyTimer = null;

  function historyStorageKey() {
    return `${HISTORY_KEY}::${activeCvPath}`;
  }
  function historyLoad() {
    try {
      const raw = localStorage.getItem(historyStorageKey());
      if (!raw) {
        historyPast = []; historyFuture = [];
      } else {
        const data = JSON.parse(raw);
        historyPast = Array.isArray(data.past) ? data.past.slice(-HISTORY_MAX) : [];
        historyFuture = Array.isArray(data.future) ? data.future.slice(-HISTORY_MAX) : [];
      }
    } catch (_) {
      historyPast = []; historyFuture = [];
    }
    // Initial load = our first present snapshot. Reset the future since
    // a fresh load means the user hasn't undone anything yet.
    presentSnapshot = snapshot();
  }
  function historyPersist() {
    try {
      localStorage.setItem(historyStorageKey(), JSON.stringify({
        past: historyPast.slice(-HISTORY_MAX),
        future: historyFuture.slice(-HISTORY_MAX),
      }));
    } catch (_) { /* quota exceeded — drop silently */ }
  }
  function snapshot() {
    return JSON.stringify(cvModel);
  }
  function recordHistory() {
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      historyTimer = null;
      const snap = snapshot();
      if (snap === presentSnapshot) return;
      // Push the OLD present (the state we're moving away from).
      if (presentSnapshot) historyPast.push(presentSnapshot);
      if (historyPast.length > HISTORY_MAX) historyPast.shift();
      presentSnapshot = snap;
      historyFuture = [];
      historyPersist();
    }, 500);
  }
  function applySnapshot(snap) {
    let parsed;
    try { parsed = JSON.parse(snap); } catch (_) { return; }
    if (!parsed || typeof parsed !== "object") return;
    replaceModel(parsed);
    if (formApi) formApi.rebuild();
    refreshAppearanceUi();
    refreshYamlBufferFromModel();
    renderOutline();
    refreshIssuesPill();
    dirty = true;
    setStatus("modified", "Modified");
    schedulePreview(120);
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { autosaveTimer = null; save(); }, 800);
  }
  function undo() {
    // If there's a pending un-snapshotted edit, snapshot it first so
    // the very first Cmd+Z after typing reverts that edit.
    if (historyTimer) {
      clearTimeout(historyTimer);
      historyTimer = null;
      const snap = snapshot();
      if (snap !== presentSnapshot) {
        if (presentSnapshot) historyPast.push(presentSnapshot);
        presentSnapshot = snap;
        historyFuture = [];
      }
    }
    if (!historyPast.length) return;
    const prev = historyPast.pop();
    historyFuture.push(presentSnapshot);
    presentSnapshot = prev;
    historyPersist();
    applySnapshot(prev);
  }
  function redo() {
    if (!historyFuture.length) return;
    const next = historyFuture.pop();
    historyPast.push(presentSnapshot);
    presentSnapshot = next;
    historyPersist();
    applySnapshot(next);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  THEME
  // ──────────────────────────────────────────────────────────────────────
  function effectiveTheme() {
    const t = document.documentElement.dataset.theme || "auto";
    if (t === "auto") {
      return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return t;
  }

  function applyThemeClass(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = $("#theme-toggle");
    if (!btn) return;
    btn.classList.remove("is-light", "is-dark", "is-auto");
    btn.classList.add(`is-${theme}`);
    btn.dataset.tooltip =
      theme === "auto" ? "Theme · Auto" :
      theme === "dark" ? "Theme · Dark" : "Theme · Light";
  }

  function setupTheme() {
    const stored = localStorage.getItem(THEME_KEY) || "auto";
    applyThemeClass(stored);
    $("#theme-toggle").addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme || "auto";
      const next = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
      localStorage.setItem(THEME_KEY, next);
      applyThemeClass(next);
      schedulePreview(40);
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if ((document.documentElement.dataset.theme || "auto") === "auto") {
        schedulePreview(40);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  EDITOR
  // ──────────────────────────────────────────────────────────────────────
  function setupEditor() {
    editor = CodeMirror.fromTextArea($("#editor"), {
      mode: "yaml",
      lineNumbers: true,
      lineWrapping: true,
      autoCloseBrackets: true,
      styleActiveLine: { nonEmpty: false },
      indentUnit: 2,
      tabSize: 2,
      extraKeys: {
        "Cmd-S": userInitiatedSave,
        "Ctrl-S": userInitiatedSave,
        "Cmd-F": "findPersistent",
        "Ctrl-F": "findPersistent",
        "Cmd-=": (cm) => { bumpZoom(+ZOOM_STEP); return false; },
        "Cmd--": (cm) => { bumpZoom(-ZOOM_STEP); return false; },
        "Cmd-0": (cm) => { setZoom(0); return false; },
        "Ctrl-=": (cm) => { bumpZoom(+ZOOM_STEP); return false; },
        "Ctrl--": (cm) => { bumpZoom(-ZOOM_STEP); return false; },
        "Ctrl-0": (cm) => { setZoom(0); return false; },
      },
    });

    // CodeMirror's fromTextArea() captures the textarea's offsetHeight
    // (default 300 px) at construction time and uses that for its viewport,
    // even after the .CodeMirror element is sized to fill the host. Tell
    // it to fill the parent explicitly.
    editor.setSize("100%", "100%");

    editor.on("change", onEdit);
    editor.on("cursorActivity", () => {
      updatePosition();
      updateOutlineActive();
    });
  }

  function onEdit() {
    // Programmatic value changes (loadCv, switchView, importer) shouldn't
    // trigger the modified/auto-save loop.
    if (suppressEditorOnEdit) return;

    // Only the YAML view can mutate the buffer interactively. In form view
    // the buffer is just a synced mirror — ignore stray edits.
    if (viewMode !== "yaml") return;

    // Try to parse the buffer back into the model. If it fails, leave the
    // last-good model in place so the preview / save still work — the user
    // can fix the YAML in this view, and the form view stays valid.
    try {
      const parsed = window.CvForm.yamlToModel(editor.getValue());
      if (parsed && typeof parsed === "object") replaceModel(parsed);
    } catch (_) {
      /* keep last good model */
    }

    if (editor.getValue() === lastSavedContent) {
      dirty = false;
      setStatus("ready", "Ready");
    } else {
      dirty = true;
      setStatus("modified", "Modified");
    }
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { autosaveTimer = null; save(); }, 1500);
    scheduleContentRefresh();
    renderOutline();
    updateBytesInfo();
  }

  function onFormChange() {
    dirty = true;
    setStatus("modified", "Modified");
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { autosaveTimer = null; save(); }, 1500);
    scheduleContentRefresh();
    renderOutline();
    refreshIssuesPill();
    recordHistory();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  POLISH — listen for the form's polish-bullet event and call Claude.
  //  The form module is intentionally agnostic: it dispatches a custom
  //  event with { input, value, setValue } and we handle the API call
  //  here, where ANTHROPIC_API_KEY availability is also tracked.
  // ──────────────────────────────────────────────────────────────────────
  let polishAvailable = null;

  function setupPolish() {
    // Probe availability in the background — same endpoint the import
    // modal uses.
    fetch("/api/extract/status")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { polishAvailable = !!(data && data.ai_available); applyPolishVisibility(); })
      .catch(() => { polishAvailable = false; applyPolishVisibility(); });

    window.addEventListener("cv:polish-bullet", async (e) => {
      const { input, value, setValue } = e.detail || {};
      if (!input || typeof setValue !== "function") return;
      if (polishAvailable === false) {
        showBuildToast(
          "AI polish needs Claude",
          "Set ANTHROPIC_API_KEY then restart the editor.",
          "danger",
        );
        return;
      }
      const btn = input.parentElement && input.parentElement.querySelector(".bullet-polish");
      if (btn) btn.classList.add("is-busy");
      try {
        const res = await fetch("/api/polish/bullet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.rewritten && data.rewritten !== value) {
          setValue(data.rewritten);
          showBuildToast("Polished ✦", `"${shortText(data.rewritten, 80)}"`, "success");
        } else {
          showBuildToast("Already tight", "Claude judged this bullet was already fine.", "success");
        }
      } catch (err) {
        showBuildToast("Polish failed", String(err.message || err), "danger");
      } finally {
        if (btn) btn.classList.remove("is-busy");
      }
    });

    // Section-level tighten: a button on each experience card. Wired
    // here too because it shares the polish API.
    window.addEventListener("cv:polish-section", async (e) => {
      const { item, fire, button } = e.detail || {};
      if (!item || !Array.isArray(item.bullets) || !item.bullets.length) return;
      if (polishAvailable === false) {
        showBuildToast("AI polish needs Claude", "Set ANTHROPIC_API_KEY then restart.", "danger");
        return;
      }
      if (button) button.classList.add("is-busy");
      try {
        const context = `Role: ${item.role || ""}\nCompany: ${item.company || ""}\nStack: ${item.stack || ""}`;
        const res = await fetch("/api/polish/section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bullets: item.bullets, context }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (Array.isArray(data.rewritten) && data.rewritten.length) {
          item.bullets = data.rewritten;
          if (typeof fire === "function") fire();
          if (formApi) formApi.rebuild();
          showBuildToast("Section polished ✦", `${data.rewritten.length} bullets rewritten.`, "success");
        }
      } catch (err) {
        showBuildToast("Polish failed", String(err.message || err), "danger");
      } finally {
        if (button) button.classList.remove("is-busy");
      }
    });
  }

  function applyPolishVisibility() {
    // Hide the polish buttons entirely when Claude isn't available, to
    // avoid teasing users with non-functional UI.
    const hide = polishAvailable === false;
    $$(".bullet-polish").forEach((b) => b.toggleAttribute("hidden", hide));
    $$(".section-polish").forEach((b) => b.toggleAttribute("hidden", hide));
  }

  function shortText(s, n) {
    s = String(s || "");
    return s.length <= n ? s : s.slice(0, n - 1) + "…";
  }

  // ──────────────────────────────────────────────────────────────────────
  //  FIRST-RUN TOUR — shows once per browser, dismissable. Spotlight
  //  cuts out the target element so the user knows what each step is
  //  pointing at. Persisted via localStorage cv.editor.tourCompleted.
  // ──────────────────────────────────────────────────────────────────────
  const TOUR_KEY = "cv.editor.tourCompleted";
  const TOUR_STEPS = [
    {
      target: "#form-host",
      title: "Edit your CV in the form",
      body: "Every field has a labelled input. Add, remove, and reorder entries — your changes flow into <code>content/cv.yaml</code> on save.",
      placement: "right",
    },
    {
      target: "#import-btn",
      title: "Have an existing resume?",
      body: "Drop a PDF, DOCX, or paste text into <strong>Import</strong>. Claude maps it into the schema in about five seconds.",
      placement: "left",
    },
    {
      target: "#build-btn",
      title: "Build the actual PDF",
      body: "<strong>Build PDF</strong> renders a 1-page A4 via WeasyPrint and opens it. The build refuses to ship a 2-pager, so you always know it'll fit.",
      placement: "left",
    },
  ];

  // ──────────────────────────────────────────────────────────────────────
  //  COLLAPSED SECTIONS — each section can be folded; state persisted
  //  per CV variant in localStorage. The form module fires
  //  ``cv:section-collapsed`` whenever the user toggles; we listen and
  //  re-apply the saved state after every form rebuild.
  // ──────────────────────────────────────────────────────────────────────
  function collapsedKey() { return `${COLLAPSED_KEY}::${activeCvPath}`; }
  function loadCollapsed() {
    try {
      const raw = localStorage.getItem(collapsedKey());
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function saveCollapsed(state) {
    try { localStorage.setItem(collapsedKey(), JSON.stringify(state)); } catch (_) {}
  }
  function applyCollapsedState() {
    const state = loadCollapsed();
    $$(".form-section[data-section-key]").forEach((sec) => {
      const key = sec.dataset.sectionKey;
      const head = sec.querySelector(".form-section-head.is-collapsible");
      const body = sec.querySelector(".form-section-body");
      if (!head || !body) return;
      const collapsed = !!state[key];
      head.setAttribute("aria-expanded", collapsed ? "false" : "true");
      body.toggleAttribute("hidden", collapsed);
    });
  }
  function setupCollapsedSections() {
    window.addEventListener("cv:section-collapsed", (e) => {
      const { key, collapsed } = e.detail || {};
      if (!key) return;
      const state = loadCollapsed();
      if (collapsed) state[key] = true;
      else delete state[key];
      saveCollapsed(state);
    });

    // Re-apply state after every form rebuild. The form module itself
    // doesn't know which sections were collapsed, so we hook the
    // MutationObserver path: any change inside #form-host re-applies.
    const host = $("#form-host");
    if (host && typeof MutationObserver !== "undefined") {
      const obs = new MutationObserver(() => applyCollapsedState());
      obs.observe(host, { childList: true, subtree: false });
    }
    // Initial pass after the form has mounted.
    setTimeout(applyCollapsedState, 200);
  }

  function setupTour() {
    if (localStorage.getItem(TOUR_KEY) === "true") return;
    const overlay = $("#tour");
    if (!overlay) return;
    let step = 0;

    function show() {
      const def = TOUR_STEPS[step];
      const target = def && document.querySelector(def.target);
      if (!target) {
        // Target not yet in DOM (e.g. form-host hidden). Try the next one.
        step++;
        if (step >= TOUR_STEPS.length) return done();
        return show();
      }
      overlay.removeAttribute("hidden");
      $(".tour-step", overlay).textContent = `Step ${step + 1} of ${TOUR_STEPS.length}`;
      $(".tour-title", overlay).textContent = def.title;
      $(".tour-body", overlay).innerHTML = def.body;
      const prev = $("#tour-prev", overlay);
      const next = $("#tour-next", overlay);
      prev.disabled = step === 0;
      prev.style.opacity = step === 0 ? "0.4" : "1";
      next.textContent = step === TOUR_STEPS.length - 1 ? "Got it" : "Next";

      // Spotlight: clip-path with a hole over the target's rectangle.
      requestAnimationFrame(() => {
        const r = target.getBoundingClientRect();
        const pad = 6;
        const x1 = Math.max(0, Math.round(r.left - pad));
        const y1 = Math.max(0, Math.round(r.top - pad));
        const x2 = Math.min(window.innerWidth, Math.round(r.right + pad));
        const y2 = Math.min(window.innerHeight, Math.round(r.bottom + pad));
        const spot = $(".tour-spotlight", overlay);
        // Cut a hole using even-odd: outer rect minus inner rect.
        spot.style.clipPath = `polygon(
          0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
          ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px
        )`;

        // Position the card next to the target.
        const card = $(".tour-card", overlay);
        const margin = 14;
        let cx, cy;
        if (def.placement === "right") {
          cx = Math.min(window.innerWidth - card.offsetWidth - 16, x2 + margin);
          cy = Math.max(16, y1);
        } else if (def.placement === "left") {
          cx = Math.max(16, x1 - card.offsetWidth - margin);
          cy = Math.min(window.innerHeight - card.offsetHeight - 16, Math.max(16, y2 + margin));
        } else {
          cx = Math.max(16, (x1 + x2) / 2 - card.offsetWidth / 2);
          cy = Math.min(window.innerHeight - card.offsetHeight - 16, y2 + margin);
        }
        card.style.left = `${cx}px`;
        card.style.top = `${cy}px`;
      });
    }

    function done() {
      overlay.setAttribute("hidden", "");
      localStorage.setItem(TOUR_KEY, "true");
    }
    function next() {
      step++;
      if (step >= TOUR_STEPS.length) done();
      else show();
    }
    function prev() {
      step = Math.max(0, step - 1);
      show();
    }

    $("#tour-skip", overlay).addEventListener("click", done);
    $("#tour-next", overlay).addEventListener("click", next);
    $("#tour-prev", overlay).addEventListener("click", prev);
    document.addEventListener("keydown", (e) => {
      if (overlay.hasAttribute("hidden")) return;
      if (e.key === "Escape") done();
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    });

    // Wait for the form to be populated before showing — otherwise the
    // first step's target measurements are wrong.
    setTimeout(show, 1500);
  }

  function setupIssuesPill() {
    const pill = $("#issues-pill");
    if (!pill) return;
    pill.addEventListener("click", () => {
      // Switch to form view (issues only visible there) and scroll to
      // the first empty required input.
      if (viewMode !== "form") switchView("form");
      requestAnimationFrame(() => {
        const first = $('input[data-required="true"][data-empty="true"], textarea[data-required="true"][data-empty="true"]');
        if (first) {
          first.scrollIntoView({ behavior: "smooth", block: "center" });
          first.focus({ preventScroll: true });
        }
      });
    });
    refreshIssuesPill();
  }

  function refreshIssuesPill() {
    const pill = $("#issues-pill");
    if (!pill) return;
    const empties = $$('input[data-required="true"][data-empty="true"], textarea[data-required="true"][data-empty="true"]');
    const count = empties.length;
    if (count === 0) {
      pill.setAttribute("hidden", "");
      return;
    }
    pill.removeAttribute("hidden");
    const countEl = $(".issues-count", pill);
    const labelEl = $(".issues-label", pill);
    if (countEl) countEl.textContent = String(count);
    if (labelEl) labelEl.textContent = count === 1 ? "issue" : "issues";
    if (window.renderIcons) window.renderIcons(pill);
  }

  function setStatus(state, label) {
    const el = $("#status");
    const prev = el.dataset.state;
    el.dataset.state = state;
    $("#status-label").textContent = label;
    // Motion: a one-shot pulse when first transitioning to "modified",
    // and a slide-in for the saved bytes count.
    el.classList.remove("is-pulse", "is-saved");
    if (state === "modified" && prev !== "modified") {
      // Force reflow so the animation re-fires.
      void el.offsetWidth;
      el.classList.add("is-pulse");
      el.addEventListener(
        "animationend",
        () => el.classList.remove("is-pulse"),
        { once: true },
      );
    }
    if (state === "saved") {
      void el.offsetWidth;
      el.classList.add("is-saved");
    }
  }

  function updatePosition() {
    if (!editor) return;
    const c = editor.getCursor();
    $("#position").textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}`;
  }

  function updateBytesInfo() {
    if (!editor) return;
    const bytes = new Blob([editor.getValue()]).size;
    $("#bytes-info").textContent = formatBytes(bytes);
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function refreshLastSaved() {
    const el = $("#last-saved");
    if (!lastSavedAt) { el.setAttribute("hidden", ""); return; }
    el.removeAttribute("hidden");
    const sec = Math.round((Date.now() - lastSavedAt.getTime()) / 1000);
    if (sec < 5)        el.textContent = "saved · just now";
    else if (sec < 60)  el.textContent = `saved · ${sec}s ago`;
    else                el.textContent = `saved · ${Math.round(sec / 60)}m ago`;
  }
  setInterval(refreshLastSaved, 8000);

  // ──────────────────────────────────────────────────────────────────────
  //  LOAD / SAVE
  //
  //  Source-of-truth model:
  //    1. cv.yaml (on disk) — canonical persistence
  //    2. cvModel (in memory) — what the form & YAML view both edit
  //    3. CodeMirror buffer — only authoritative while in YAML view
  //
  //  Sync rules:
  //    • form change   → mutate cvModel → schedule save → save serialises
  //                       cvModel to YAML and writes it
  //    • YAML edit     → parse buffer → cvModel = parsed → schedule save
  //    • view switch   → form→yaml: serialise cvModel into the buffer
  //                      yaml→form: parse buffer into cvModel, rebuild form
  // ──────────────────────────────────────────────────────────────────────
  async function loadCv() {
    const res = await fetch(`/api/cv?path=${encodeURIComponent(activeCvPath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    suppressEditorOnEdit = true;
    editor.setValue(text);
    suppressEditorOnEdit = false;
    lastSavedContent = text;
    dirty = false;
    try {
      replaceModel(window.CvForm.yamlToModel(text) || {});
    } catch (err) {
      console.error("Initial YAML parse failed:", err);
      replaceModel({});
    }
    setStatus("ready", "Ready");
    if (formApi) formApi.rebuild();
    refreshAppearanceUi();
    renderOutline();
    updateBytesInfo();
    updatePosition();
    schedulePreview(60);
    refreshIssuesPill();
    historyLoad();
  }

  function modelToYamlString() {
    return window.CvForm.modelToYaml(cvModel);
  }

  function refreshYamlBufferFromModel() {
    const text = modelToYamlString();
    suppressEditorOnEdit = true;
    editor.setValue(text);
    suppressEditorOnEdit = false;
  }

  /**
   * Auto-lint a raw YAML buffer:
   *   1. Parse via js-yaml (the buffer becomes a JS object)
   *   2. Drop empty arrays / undefined values via the form module's pruner
   *   3. Re-emit through ``CvForm.modelToYaml`` so the result has the same
   *      shape we'd save from Form view — consistent indentation, no
   *      stray quotes, header comment preserved.
   *
   * If parsing fails, return the original buffer untouched (the user is
   * mid-edit and the YAML is invalid; we don't want to clobber their work).
   */
  function lintYamlBuffer(raw) {
    if (!raw || !raw.trim()) return raw;
    try {
      const parsed = window.CvForm.yamlToModel(raw);
      if (!parsed || typeof parsed !== "object") return raw;
      return window.CvForm.modelToYaml(parsed);
    } catch (_) {
      return raw;
    }
  }

  /**
   * Save the current cv.yaml.
   *
   * @param {{forceLint?: boolean}} opts - When ``forceLint`` is true and
   *   the user has linting enabled, the YAML buffer is normalised
   *   through ``CvForm.modelToYaml`` before being sent. Pass ``false``
   *   from the autosave timer so the cursor doesn't jump mid-typing.
   */
  async function save(opts = {}) {
    if (!editor) return;
    const forceLint = opts.forceLint === true;

    let content;
    if (viewMode === "form") {
      // Form view always emits a canonical YAML.
      content = modelToYamlString();
    } else if (forceLint && lintOnSave) {
      // User-initiated save in YAML view + lint enabled → normalise.
      content = lintYamlBuffer(editor.getValue());
    } else {
      // Autosave in YAML view, OR user-initiated with lint disabled.
      // Preserve the buffer exactly so the user can keep typing.
      content = editor.getValue();
    }

    // Reflect the lint back into the editor buffer ONLY when an explicit
    // user save reformatted things — never during typing.
    if (forceLint && lintOnSave && viewMode === "yaml" && content !== editor.getValue()) {
      suppressEditorOnEdit = true;
      const cursor = editor.getCursor();
      editor.setValue(content);
      try { editor.setCursor(cursor); } catch (_) {}
      suppressEditorOnEdit = false;
    }
    if (content === lastSavedContent) {
      setStatus("ready", "Ready");
      return;
    }
    setStatus("saving", "Saving");
    try {
      const res = await fetch("/api/cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, path: activeCvPath }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Keep the YAML buffer in sync so a YAML-tab visit shows the saved file.
      if (viewMode === "form") {
        suppressEditorOnEdit = true;
        editor.setValue(content);
        suppressEditorOnEdit = false;
      }
      lastSavedContent = content;
      lastSavedAt = new Date();
      dirty = false;
      setStatus("saved", `Saved · ${formatBytes(data.bytes)}`);
      refreshLastSaved();
      // NOTE: save() does not trigger a preview re-render. The Live-mode
      // refresh path (refreshPreview → save-if-dirty → render) handles
      // that. Cmd+S / save-button users get a render via the wrapper
      // ``userInitiatedSave()`` below.
      setTimeout(() => setStatus("ready", "Ready"), 2200);
    } catch (err) {
      setStatus("error", "Save failed");
      console.error(err);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PREVIEW
  // ──────────────────────────────────────────────────────────────────────
  function schedulePreview(delay) {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, delay || 60);
  }

  /**
   * Content-driven refresh — typing in the form or YAML, saving, etc.
   * Respects the autoRender toggle. In Manual mode, sets pendingRefresh
   * and updates the refresh button to show a pending dot.
   */
  function scheduleContentRefresh(delay = CONTENT_DEBOUNCE_MS) {
    if (autoRender) {
      schedulePreview(delay);
    } else {
      markPending();
    }
  }

  function markPending() {
    pendingRefresh = true;
    const btn = $("#refresh-btn");
    if (btn) btn.classList.add("has-pending");
  }

  function clearPending() {
    pendingRefresh = false;
    const btn = $("#refresh-btn");
    if (btn) btn.classList.remove("has-pending");
  }

  /**
   * User-initiated save (Cmd+S, save button click).
   *
   * In Live mode this triggers a refresh as well — the user expects the
   * preview to catch up with the saved file. In Manual mode it just
   * saves; the preview waits for an explicit Refresh click. EITHER way,
   * we pass ``forceLint`` so the YAML buffer can be reformatted.
   */
  function userInitiatedSave() {
    if (autoRender) {
      // schedulePreview → refreshPreview, which calls save({forceLint: true})
      // before rendering. Mark intent so refreshPreview lints.
      pendingForceLint = true;
      schedulePreview(0);
    } else if (dirty) {
      save({ forceLint: true });
    }
  }
  // Flag the next refreshPreview should pass forceLint to its inner save.
  // Set by userInitiatedSave; consumed (and cleared) inside refreshPreview.
  let pendingForceLint = false;

  function showPreviewLoading(show) {
    const el = $("#preview-loading");
    if (show) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  }

  let dimTimer = null;
  /**
   * Refresh the preview iframe.
   *
   * The preview endpoint reads ``content/cv.yaml`` from disk, so the file
   * MUST reflect the current form state before we render. If anything is
   * dirty, save synchronously (cancelling any pending autosave timer)
   * before kicking off the render. This closes the race that would
   * otherwise show stale content during the 400 ms / 1.5 s windows
   * between edit and autosave.
   */
  async function refreshPreview() {
    // We save first when the file is out of sync (dirty) OR the user
    // explicitly asked for a lint pass via Cmd+S — even if the buffer
    // hasn't been edited since the last save, they may want the
    // formatter to canonicalise it now.
    if (dirty || pendingForceLint) {
      if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
      const forceLint = pendingForceLint;
      pendingForceLint = false;
      try { await save({ forceLint }); } catch (_) { /* UI shows error */ }
    }
    clearPending();
    showPreviewLoading(true);
    const theme = effectiveTheme();
    const url = `/api/preview?theme=${theme}&mode=${previewMode}&density=${getDensity()}&font=${getFont()}&path=${encodeURIComponent(activeCvPath)}&t=${Date.now()}`;
    const iframe = $("#preview");
    const prevScrollY = iframe.contentWindow ? iframe.contentWindow.scrollY : 0;
    // Dim the iframe slightly while paged.js is recomputing — but only if
    // the request takes >80 ms so quick re-renders don't flash.
    if (dimTimer) clearTimeout(dimTimer);
    dimTimer = setTimeout(() => iframe.classList.add("is-recomputing"), 80);
    iframe.onload = () => {
      showPreviewLoading(false);
      // Restore scroll if we're not jumping to a specific section.
      if (pendingScrollTarget == null) {
        try { iframe.contentWindow.scrollTo(0, prevScrollY); } catch (_) {}
      } else {
        if (scrollPreviewToSection(pendingScrollTarget, "auto")) {
          pendingScrollTarget = null;
        }
      }
      applyZoom();
    };
    iframe.src = url;
  }

  function undimPreview() {
    const iframe = $("#preview");
    if (dimTimer) { clearTimeout(dimTimer); dimTimer = null; }
    iframe.classList.remove("is-recomputing");
  }

  function scrollPreviewToSection(slug, behavior = "smooth") {
    const iframe = $("#preview");
    const doc = iframe && iframe.contentDocument;
    if (!doc) return false;
    const target = doc.getElementById(`sec-${slug}`);
    if (!target) return false;
    target.scrollIntoView({ behavior, block: "start" });
    return true;
  }

  // Listen for paged.js render-complete posts from the iframe so we can
  // hide the spinner and update the page-count badge (red on overflow).
  // Also captures the iframe document height so applyZoom() can size the
  // preview stage to fit the entire content without internal scroll.
  function setupPagedListener() {
    window.addEventListener("message", (e) => {
      if (!e.data) return;
      if (e.data.type === "cv-content-rendered" || e.data.type === "paged-rendered") {
        let dirty = false;
        if (typeof e.data.contentHeight === "number" && e.data.contentHeight > 0) {
          cvContentHeight = e.data.contentHeight;
          dirty = true;
        }
        if (typeof e.data.contentWidth === "number" && e.data.contentWidth > 0) {
          cvContentWidth = e.data.contentWidth;
          dirty = true;
        }
        if (dirty) applyZoom();
      }
      if (e.data.type !== "paged-rendered") return;
      const pages = e.data.pages | 0;
      const wasOverflow = lastPagedCount != null && lastPagedCount > 1;
      lastPagedCount = pages;
      updatePageCountUi(pages, wasOverflow);
      showPreviewLoading(false);
      undimPreview();
      if (pendingScrollTarget != null) {
        if (scrollPreviewToSection(pendingScrollTarget, "auto")) {
          pendingScrollTarget = null;
        }
      }
    });
  }

  function updatePageCountUi(pages, wasOverflow = false) {
    const pc = $("#page-count");
    const label = $("#page-count-text");
    if (previewMode !== "paged") {
      pc.setAttribute("hidden", "");
      return;
    }
    pc.removeAttribute("hidden");
    pc.classList.remove("is-fit", "is-overflow", "is-alarm");
    if (pages <= 0) {
      label.textContent = "…";
      return;
    }
    if (pages === 1) {
      label.textContent = "1 page";
      pc.classList.add("is-fit");
    } else {
      label.textContent = `Overflow · ${pages} pages`;
      pc.classList.add("is-overflow");
      // One-shot shake-and-glow only when transitioning into overflow,
      // not on every re-render.
      if (!wasOverflow) {
        // Force reflow so the animation re-fires.
        void pc.offsetWidth;
        pc.classList.add("is-alarm");
        pc.addEventListener(
          "animationend",
          () => pc.classList.remove("is-alarm"),
          { once: true },
        );
      }
    }
  }

  function setupModeToggle() {
    $$(".seg-btn[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = btn.dataset.mode;
        if (m === previewMode) return;
        previewMode = m;
        localStorage.setItem(MODE_KEY, previewMode);
        applyModeUi();
        schedulePreview(20);
      });
    });
    applyModeUi();
  }

  function applyModeUi() {
    $$(".seg-btn[data-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === previewMode);
    });
    if (previewMode === "paged") {
      $("#page-count").removeAttribute("hidden");
      if (lastPagedCount != null) updatePageCountUi(lastPagedCount);
    } else {
      $("#page-count").setAttribute("hidden", "");
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  APPEARANCE — accent / font / density.
  //
  //  All three are canonical YAML fields living on cvModel. The topbar
  //  is the single editing surface — the form's Header section
  //  intentionally does NOT include them.
  //
  //  Each control has a tiny refreshFrom...() helper so external code
  //  (theme picker, model reload) can sync the inputs.
  // ──────────────────────────────────────────────────────────────────────
  function setupAppearance() {
    const fontSel = $("#font-select");
    const densitySel = $("#density-select");
    const accentInput = $("#accent-input");
    const swatch = $("#accent-swatch");

    function syncSwatchFrom(hex) {
      const safe = (hex || "#111111").trim();
      if (swatch) swatch.style.background = safe;
      if (accentInput && /^#[0-9a-f]{3,8}$/i.test(safe)) accentInput.value = safe;
    }

    if (fontSel) {
      fontSel.value = cvModel.font || "serif";
      fontSel.addEventListener("change", () => {
        cvModel.font = fontSel.value;
        onFormChange();
      });
    }
    if (densitySel) {
      densitySel.value = cvModel.density || "normal";
      densitySel.addEventListener("change", () => {
        cvModel.density = densitySel.value;
        onFormChange();
      });
    }
    if (accentInput) {
      syncSwatchFrom(cvModel.accent || "#111111");
      accentInput.addEventListener("input", () => {
        cvModel.accent = accentInput.value;
        syncSwatchFrom(accentInput.value);
        onFormChange();
      });
    }

    // Refresh helper — called after model load / theme apply / undo.
    refreshAppearanceUi = () => {
      if (fontSel) fontSel.value = cvModel.font || "serif";
      if (densitySel) densitySel.value = cvModel.density || "normal";
      syncSwatchFrom(cvModel.accent || "#111111");
    };
  }
  let refreshAppearanceUi = () => { /* set by setupAppearance() */ };

  function setupPreviewActions() {
    $("#preview-open-btn").addEventListener("click", () => {
      const theme = effectiveTheme();
      const url = `/api/preview?theme=${theme}&mode=${previewMode}&density=${getDensity()}&font=${getFont()}&path=${encodeURIComponent(activeCvPath)}`;
      window.open(url, "_blank", "noopener");
    });
    // Refresh button always forces an immediate render — bypasses the
    // autoRender toggle (that's the whole point of "Manual").
    $("#refresh-btn").addEventListener("click", () => schedulePreview(0));
    setupZoomControls();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  AUTO-RENDER TOGGLE (Live ↔ Manual)
  //
  //  Segmented control — both states visible at once so it reads as a
  //  switch, not a status pill. Click either side to set that mode.
  // ──────────────────────────────────────────────────────────────────────
  function setupAutoRenderToggle() {
    const buttons = $$("#auto-render .seg-btn[data-auto]");
    if (!buttons.length) return;
    applyAutoRenderUi();
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.auto === "live";
        if (next === autoRender) return;
        autoRender = next;
        localStorage.setItem(AUTO_KEY, String(autoRender));
        applyAutoRenderUi();
        // Flipping to Live with pending edits = "render now please".
        if (autoRender && pendingRefresh) {
          schedulePreview(0);
        }
      });
    });
  }

  function applyAutoRenderUi() {
    $$("#auto-render .seg-btn[data-auto]").forEach((b) => {
      const active = (b.dataset.auto === "live") === autoRender;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (autoRender) clearPending();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  LINT-ON-SAVE TOGGLE — visible only in YAML view. Default ON.
  //  Click flips. Lint runs only on Cmd+S / Save button — never on the
  //  1.5 s autosave that fires while you're typing.
  // ──────────────────────────────────────────────────────────────────────
  function setupLintToggle() {
    const btn = $("#lint-toggle");
    if (!btn) return;
    applyLintToggleUi();
    btn.addEventListener("click", () => {
      lintOnSave = !lintOnSave;
      localStorage.setItem(LINT_KEY, String(lintOnSave));
      applyLintToggleUi();
    });
  }

  function applyLintToggleUi() {
    const btn = $("#lint-toggle");
    if (!btn) return;
    btn.setAttribute("aria-pressed", lintOnSave ? "true" : "false");
    const state = $(".lint-toggle-state", btn);
    if (state) state.textContent = lintOnSave ? "on" : "off";
    btn.dataset.tooltip = lintOnSave
      ? "Format YAML on ⌘S. Click to disable — your formatting will be preserved."
      : "Save preserves your YAML exactly. Click to re-enable formatting on ⌘S.";
  }

  // ──────────────────────────────────────────────────────────────────────
  //  BUILD PDF — explicit "render the actual PDF and open it" button.
  //  Skips the live preview's paged.js path and goes through WeasyPrint
  //  via the same engine the CLI uses, so what you get is exactly the
  //  print artefact. Errors (overflow, validation) come back as a toast
  //  with the offending section name.
  // ──────────────────────────────────────────────────────────────────────
  function setupBuildButton() {
    const btn = $("#build-btn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      // Always save first so the file on disk reflects the form/buffer.
      if (dirty) {
        try { await save({ forceLint: lintOnSave && viewMode === "yaml" }); } catch (_) {}
      }
      btn.classList.add("is-busy");
      const originalHTML = btn.innerHTML;
      btn.innerHTML =
        '<span data-icon="loader" data-icon-size="13"></span><span>Building…</span>';
      if (window.renderIcons) window.renderIcons(btn);
      try {
        const res = await fetch("/api/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ density: getDensity(), path: activeCvPath }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.error === "overflow") {
            showBuildToast(
              "Overflow",
              `${data.pages} pages — first overflow: ${data.section}. Switch density to tight or trim a bullet.`,
              "danger",
            );
          } else {
            showBuildToast("Build failed", data.error || `HTTP ${res.status}`, "danger");
          }
          return;
        }
        // Success — open the PDF in a new tab. We add a cache-buster so
        // each build shows the latest file.
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener");
        // Free the blob URL after a beat (the new tab has already loaded).
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        showBuildToast("Built ✓", "1 page · opened in a new tab.", "success");
      } catch (err) {
        showBuildToast("Build failed", String(err.message || err), "danger");
      } finally {
        btn.classList.remove("is-busy");
        btn.innerHTML = originalHTML;
        if (window.renderIcons) window.renderIcons(btn);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  CV VARIANT SWITCHER — drop-down listing every yaml file under
  //  content/. Selecting one re-loads that CV into the form. "New
  //  variant" duplicates the current model into a fresh file.
  // ──────────────────────────────────────────────────────────────────────
  function setupCvSwitcher() {
    const btn = $("#cv-switcher");
    const pop = $("#cv-switcher-pop");
    const list = $("#cv-switcher-list");
    const newBtn = $("#cv-new-btn");
    const label = $("#cv-switcher-label");
    if (!btn || !pop) return;

    let isOpen = false;
    label.textContent = activeCvPath;

    function position() {
      const r = btn.getBoundingClientRect();
      pop.style.top = `${Math.round(r.bottom + 6)}px`;
      pop.style.left = `${Math.round(r.left)}px`;
      pop.style.right = "auto";
    }

    function renderList(cvs) {
      list.innerHTML = "";
      cvs.forEach((c) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "cv-row" + (c.path === activeCvPath ? " is-active" : "");
        const kb = c.bytes < 1024 ? `${c.bytes} B` : `${(c.bytes/1024).toFixed(1)} KB`;
        row.innerHTML =
          `<span class="cv-name">${escapeHtml(c.path)}</span>` +
          `<span class="cv-meta">${kb}</span>`;
        row.addEventListener("click", () => switchCv(c.path));
        list.appendChild(row);
      });
      if (!cvs.length) {
        list.innerHTML = '<div class="form-empty-sub" style="padding:14px">No CV files in content/.</div>';
      }
    }

    async function refreshList() {
      try {
        const res = await fetch("/api/cvs");
        const data = await res.json();
        renderList(data.cvs || []);
      } catch (_) {
        list.innerHTML = '<div class="form-empty-sub" style="padding:14px">Could not load CV variants.</div>';
      }
    }

    async function switchCv(path) {
      if (path === activeCvPath) { close(); return; }
      // Save current pending changes first so we don't lose them.
      if (dirty) {
        try { await save({ forceLint: false }); } catch (_) {}
      }
      activeCvPath = path;
      localStorage.setItem(CV_PATH_KEY, activeCvPath);
      label.textContent = activeCvPath;
      close();
      await loadCv();
    }

    async function newVariant() {
      const name = prompt("New CV variant filename (without extension):", "cv-research");
      if (!name) return;
      const cleanName = String(name).trim().replace(/\.ya?ml$/i, "").replace(/[^A-Za-z0-9_-]+/g, "-");
      if (!cleanName) return;
      const path = `${cleanName}.yaml`;
      // Save current model into the new path so the user starts from a
      // duplicate of what they were editing — that's almost always what
      // they want when "tailoring" a variant.
      const content = viewMode === "form"
        ? modelToYamlString()
        : editor.getValue();
      try {
        const res = await fetch("/api/cv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, path }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await switchCv(path);
        await refreshList();
      } catch (err) {
        showBuildToast("Couldn't create variant", String(err.message || err), "danger");
      }
    }

    function open() {
      pop.removeAttribute("hidden");
      position();
      isOpen = true;
      btn.classList.add("is-open");
      refreshList();
    }
    function close() {
      pop.setAttribute("hidden", "");
      isOpen = false;
      btn.classList.remove("is-open");
    }
    function toggle() { isOpen ? close() : open(); }

    btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    document.addEventListener("click", (e) => {
      if (!isOpen) return;
      if (e.target.closest("#cv-switcher-pop") || e.target.closest("#cv-switcher")) return;
      close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) close();
    });
    window.addEventListener("resize", () => { if (isOpen) position(); });
    if (newBtn) newBtn.addEventListener("click", newVariant);
  }

  // Lightweight toast (top-centre, auto-dismisses).
  function showBuildToast(title, body, tone = "neutral") {
    let host = document.getElementById("build-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "build-toast-host";
      document.body.appendChild(host);
    }
    const toast = document.createElement("div");
    toast.className = `build-toast tone-${tone}`;
    toast.innerHTML =
      `<span class="build-toast-title">${escapeHtml(title)}</span>` +
      `<span class="build-toast-body">${escapeHtml(body)}</span>`;
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 240);
    }, tone === "danger" ? 6000 : 3500);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  THEME PICKER — popover over the topbar palette button. Pulls themes
  //  from /api/themes (JSON files in themes/) and applies one with a
  //  click. The applied theme writes into cvModel.{accent,font} (+ density
  //  via the existing dropdown) and triggers a save + refresh.
  //
  //  # 🤖 ADD-A-THEME-HERE
  //  Drop a JSON into themes/ at the repo root: { name, accent, font, density }.
  // ──────────────────────────────────────────────────────────────────────
  function setupThemePicker() {
    const btn = $("#theme-btn");
    const pop = $("#theme-popover");
    const list = $("#theme-list");
    if (!btn || !pop || !list) return;

    let loaded = false;
    let isOpen = false;

    function position() {
      const r = btn.getBoundingClientRect();
      pop.style.top = `${Math.round(r.bottom + 6)}px`;
      pop.style.right = `${Math.max(8, window.innerWidth - r.right - 4)}px`;
      pop.style.left = "auto";
    }

    function renderList(themes) {
      list.innerHTML = "";
      themes.forEach((t) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "theme-row";
        const isActive = (cvModel.accent || "").toLowerCase() === (t.accent || "").toLowerCase()
          && (cvModel.font || "serif") === (t.font || "serif");
        if (isActive) row.classList.add("is-active");
        row.innerHTML =
          `<span class="theme-swatch" style="background:${escapeHtml(t.accent)}"></span>` +
          `<span class="theme-meta">` +
            `<span class="theme-name">${escapeHtml(t.name)}</span>` +
            `<span class="theme-sub">${escapeHtml(t.accent)} · ${escapeHtml(t.font)} · ${escapeHtml(t.density)}</span>` +
          `</span>`;
        row.addEventListener("click", () => applyTheme(t));
        list.appendChild(row);
      });
    }

    async function ensureLoaded() {
      if (loaded) return;
      try {
        const res = await fetch("/api/themes");
        const data = await res.json();
        renderList(data.themes || []);
        loaded = true;
      } catch (_) {
        list.innerHTML =
          '<div class="form-empty-sub" style="padding:14px">' +
          'Could not load themes/. Drop a JSON in themes/ to add one.' +
          '</div>';
        loaded = true;
      }
    }

    function applyTheme(theme) {
      // All three (accent / font / density) are now canonical YAML
      // fields on cvModel — patch them and the rest of the UI reads
      // back via refreshAppearanceUi() and the form rebuild.
      if (theme.accent)  cvModel.accent  = theme.accent;
      if (theme.font)    cvModel.font    = theme.font;
      if (theme.density && ["tight","normal","airy"].includes(theme.density)) {
        cvModel.density = theme.density;
      }
      refreshAppearanceUi();
      if (formApi) formApi.rebuild();
      onFormChange();
      close();
    }

    function open() {
      pop.removeAttribute("hidden");
      position();
      isOpen = true;
      btn.classList.add("is-active");
      ensureLoaded();
    }
    function close() {
      pop.setAttribute("hidden", "");
      isOpen = false;
      btn.classList.remove("is-active");
    }
    function toggle() { isOpen ? close() : open(); }

    btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    document.addEventListener("click", (e) => {
      if (!isOpen) return;
      if (e.target.closest("#theme-popover") || e.target.closest("#theme-btn")) return;
      close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) close();
    });
    window.addEventListener("resize", () => { if (isOpen) position(); });

    // Import-from-URL handler
    const importBtn = $("#theme-import-btn");
    const urlInput = $("#theme-url");
    if (importBtn && urlInput) {
      const doImport = async () => {
        const url = urlInput.value.trim();
        if (!url) return;
        importBtn.disabled = true;
        importBtn.textContent = "Fetching…";
        try {
          const res = await fetch("/api/themes/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          urlInput.value = "";
          // Reload list so the new theme appears
          loaded = false;
          await ensureLoaded();
          showBuildToast("Theme imported", `Saved as ${data.saved}`, "success");
        } catch (err) {
          showBuildToast("Theme import failed", String(err.message || err), "danger");
        } finally {
          importBtn.disabled = false;
          importBtn.innerHTML = '<span data-icon="upload" data-icon-size="11"></span><span>Import URL</span>';
          if (window.renderIcons) window.renderIcons(importBtn);
        }
      };
      importBtn.addEventListener("click", (e) => { e.stopPropagation(); doImport(); });
      urlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); doImport(); }
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  IMPORT MODAL — three paths:
  //   * AI extract  → POST /api/extract (Claude w/ prompt cache, w/ fallback)
  //   * rendercv    → POST /api/import   (deterministic conversion)
  //   * Plain text  → POST /api/import   (heuristic regex parse)
  // ──────────────────────────────────────────────────────────────────────
  let importTab = "ai";
  let importFile = null;
  let aiAvailable = null;  // null = unknown, true/false after status probe

  const HINTS = {
    ai:
      "Drop a <strong>PDF, DOCX, or text file</strong> below — or paste text directly. " +
      "Claude maps it into the right schema. " +
      "<span class='hint-linkedin'>From LinkedIn? Open your profile → " +
      "<strong>More → Save to PDF</strong>, then drop the file here.</span> " +
      "<span id='ai-availability-text'></span>",
    rendercv:
      'Paste a <code>rendercv</code> YAML file (the format from <a href="https://rendercv.com" target="_blank" rel="noopener">rendercv.com</a>). ' +
      "We'll convert it to this tool's <code>cv.yaml</code> shape — including brand-icon hints for known networks.",
    text:
      "Paste any plain-text resume. We'll do a best-effort regex parse (section headers like " +
      "<code>EXPERIENCE</code>, date ranges, job lines). Review carefully.",
  };

  async function probeAiStatus() {
    try {
      const res = await fetch("/api/extract/status");
      const data = await res.json();
      aiAvailable = !!data.ai_available;
    } catch (_) {
      aiAvailable = false;
    }
    updateAiBadge();
  }

  function updateAiBadge() {
    const badge = $("#ai-tab-badge");
    const txt = $("#ai-availability-text");
    if (!badge) return;
    if (aiAvailable) {
      badge.removeAttribute("hidden");
      badge.textContent = "Claude";
      badge.classList.remove("is-fallback");
      if (txt) txt.innerHTML = "<strong>Claude is connected.</strong>";
    } else {
      badge.removeAttribute("hidden");
      badge.textContent = "fallback";
      badge.classList.add("is-fallback");
      if (txt) {
        txt.innerHTML =
          'Claude API key not set — falling back to heuristic. ' +
          'Set <code>ANTHROPIC_API_KEY</code> and restart the server for AI extraction.';
      }
    }
  }

  function setupImport() {
    const btn = $("#import-btn");
    const modal = $("#import-modal");
    const close = $("#import-close");
    const cancel = $("#import-cancel");
    const apply = $("#import-apply");
    const input = $("#import-input");
    const error = $("#import-error");
    const status = $("#import-status");
    const hint = $("#import-hint");
    const dropzone = $("#import-dropzone");
    const fileInput = $("#import-file-input");
    const fileBtn = $("#import-file-btn");
    const fileName = $("#import-file-name");
    if (!btn) return;

    function open() {
      modal.classList.remove("closing");
      modal.removeAttribute("hidden");
      input.value = "";
      importFile = null;
      fileName.setAttribute("hidden", "");
      fileName.textContent = "";
      hideError();
      status.textContent = "";
      // Wait for the entrance animation to finish, then focus. This avoids
      // the focus ring jittering against a translating card.
      const card = modal.querySelector(".modal-card");
      if (card) {
        const onEnd = () => {
          card.removeEventListener("animationend", onEnd);
          input.focus();
        };
        card.addEventListener("animationend", onEnd, { once: true });
      } else {
        setTimeout(() => input.focus(), 220);
      }
    }
    function closeModal() {
      // If we're already closing or hidden, no-op.
      if (modal.hasAttribute("hidden") || modal.classList.contains("closing")) return;
      modal.classList.add("closing");
      const card = modal.querySelector(".modal-card");
      const finalize = () => {
        modal.setAttribute("hidden", "");
        modal.classList.remove("closing");
      };
      if (card) {
        card.addEventListener("animationend", finalize, { once: true });
        // Safety net — if animationend doesn't fire (reduced motion edge),
        // hide on next frame anyway.
        setTimeout(finalize, 220);
      } else {
        finalize();
      }
    }
    function hideError() {
      error.setAttribute("hidden", "");
      error.textContent = "";
    }
    function showError(msg) {
      error.removeAttribute("hidden");
      error.textContent = msg;
    }
    function setTab(tab) {
      importTab = tab;
      $$(".modal-tab").forEach((t) => {
        t.classList.toggle("is-active", t.dataset.tab === tab);
      });
      hint.innerHTML = HINTS[tab] || "";
      const showDrop = tab === "ai";
      dropzone[showDrop ? "removeAttribute" : "setAttribute"]("hidden", "");
      apply.textContent =
        tab === "ai" ? (importFile ? "Extract from file" : "Extract with Claude") : "Convert & replace";
      if (tab === "ai") updateAiBadge();
    }

    function setFile(file) {
      importFile = file;
      if (file) {
        fileName.removeAttribute("hidden");
        fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
        apply.textContent = "Extract from file";
      } else {
        fileName.setAttribute("hidden", "");
        fileName.textContent = "";
      }
    }

    btn.addEventListener("click", open);
    close.addEventListener("click", closeModal);
    cancel.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hasAttribute("hidden")) closeModal();
    });
    $$(".modal-tab").forEach((t) => {
      t.addEventListener("click", () => setTab(t.dataset.tab));
    });

    // File input + drag-drop
    fileBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) setFile(f);
    });
    ;["dragenter", "dragover"].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("is-dragging");
      }),
    );
    ;["dragleave", "drop"].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("is-dragging");
      }),
    );
    dropzone.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setFile(f);
    });

    apply.addEventListener("click", async () => {
      hideError();
      apply.disabled = true;
      try {
        let url, body, headers;
        if (importTab === "ai") {
          url = "/api/extract";
          if (importFile) {
            const fd = new FormData();
            fd.append("file", importFile);
            body = fd;
            headers = undefined;
            status.textContent = "Reading file & extracting…";
          } else {
            const text = input.value.trim();
            if (!text) {
              showError("Drop a file or paste text.");
              apply.disabled = false;
              return;
            }
            url = "/api/extract";
            body = JSON.stringify({ content: text });
            headers = { "Content-Type": "application/json" };
            status.textContent = "Asking Claude…";
          }
        } else {
          const text = input.value.trim();
          if (!text) {
            showError("Paste something first.");
            apply.disabled = false;
            return;
          }
          url = "/api/import";
          body = JSON.stringify({ format: importTab, content: text });
          headers = { "Content-Type": "application/json" };
          status.textContent = "Converting…";
        }

        const res = await fetch(url, { method: "POST", headers, body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (!data.yaml) throw new Error("Empty response from server");

        suppressEditorOnEdit = true;
        editor.setValue(data.yaml);
        editor.setCursor({ line: 0, ch: 0 });
        suppressEditorOnEdit = false;
        try {
          const parsed = window.CvForm.yamlToModel(data.yaml);
          if (parsed && typeof parsed === "object") replaceModel(parsed);
        } catch (_) { /* ignore */ }
        if (formApi) formApi.rebuild();
        renderOutline();

        const sourceLabel =
          data.source === "claude" ? "Claude" : data.source === "heuristic" ? "fallback" : "OK";
        status.textContent = `Imported · ${sourceLabel} · ${data.bytes || data.yaml.length} chars`;
        setTimeout(() => {
          closeModal();
          // Import is an explicit user action — always render the new
          // content, regardless of the auto-render toggle.
          schedulePreview(0);
        }, 600);
      } catch (err) {
        console.error(err);
        showError(`Import failed: ${err.message || err}`);
        status.textContent = "";
      } finally {
        apply.disabled = false;
      }
    });

    setTab("ai");
    probeAiStatus();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  ZOOM (verbatim port from books app.js)
  // ──────────────────────────────────────────────────────────────────────
  function setupZoomControls() {
    $("#zoom-in").addEventListener("click", () => bumpZoom(+ZOOM_STEP));
    $("#zoom-out").addEventListener("click", () => bumpZoom(-ZOOM_STEP));
    $("#zoom-fit").addEventListener("click", () => setZoom(0));
    applyZoom();
  }

  function clampZoom(z) {
    if (!isFinite(z) || z <= 0) return 1;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  }

  function effectiveZoom() {
    if (previewZoom > 0) return clampZoom(previewZoom);
    const wrap = $("#preview-wrap");
    if (!wrap) return 1;
    const w = wrap.clientWidth;
    if (!w) return 1;
    return clampZoom((w - 24) / A4_PX);
  }

  function applyZoom() {
    const iframe = $("#preview");
    const stage = $("#preview-stage");
    const wrap = $("#preview-wrap");
    const label = $("#zoom-text");
    const fitBtn = $("#zoom-fit");
    if (!iframe || !stage || !wrap) return;
    const z = effectiveZoom();
    const wrapW = wrap.clientWidth || 600;
    const wrapH = wrap.clientHeight || 800;
    // Iframe layout box is sized so:
    //   * iframeW ≥ contentW    → CV page fits horizontally inside iframe
    //                             (no internal horizontal scrollbar)
    //   * iframeW × z ≥ wrapW   → stage is at least wrap-wide so wrap
    //                             doesn't show empty space to the right
    //   * iframeH ≥ contentH    → iframe internal viewport fits CV without
    //                             its own vertical scrollbar
    //   * iframeH × z ≥ wrapH   → stage is at least wrap-tall so wrap
    //                             doesn't show empty space below the page
    const contentW = cvContentWidth || 794;
    const contentH = cvContentHeight || wrapH;
    const iframeW = Math.max(contentW, wrapW / z);
    const iframeH = Math.max(contentH, wrapH / z);
    iframe.style.width = `${iframeW}px`;
    iframe.style.height = `${iframeH}px`;
    iframe.style.transform = `scale(${z})`;
    // Stage holds the visual bounds — wrap scrolls if stage > wrap.
    stage.style.width = `${iframeW * z}px`;
    stage.style.height = `${iframeH * z}px`;
    wrap.classList.toggle("is-zoomed-in", z > 1);
    if (z <= 1) {
      // Fit/shrink: visual ≤ wrap, no overflow. Reset wrap scroll so a
      // later zoom-in starts at the top.
      wrap.scrollTop = 0;
      wrap.scrollLeft = 0;
    }
    if (label) {
      label.textContent = previewZoom === 0
        ? `Fit · ${Math.round(z * 100)}%`
        : `${Math.round(z * 100)}%`;
    }
    if (fitBtn) fitBtn.classList.toggle("is-fit", previewZoom === 0);
  }

  function bumpZoom(delta) {
    const base = previewZoom > 0 ? previewZoom : effectiveZoom();
    setZoom(clampZoom(base + delta));
  }

  function setZoom(z) {
    previewZoom = z > 0 ? clampZoom(z) : 0;
    if (previewZoom === 0) localStorage.removeItem(ZOOM_KEY);
    else localStorage.setItem(ZOOM_KEY, String(previewZoom));
    applyZoom();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  OUTLINE — built from YAML top-level keys
  // ──────────────────────────────────────────────────────────────────────
  // Slug → human label. Anything not in this map shows up as a generic key.
  const SECTION_LABELS = {
    name: "Name",
    contact: "Contact",
    accent: "Accent",
    photo: "Photo",
    skills: "Skills",
    experience: "Experience",
    education: "Education",
    projects: "Projects",
    leadership: "Leadership",
    others: "Other",
  };

  // Subset that maps to a section in the rendered HTML (id="sec-{slug}").
  const RENDER_SECTIONS = new Set([
    "header", "experience", "education", "skills",
    "projects", "leadership", "others",
  ]);

  function renderOutline() {
    if (!editor) return;
    const list = $("#outline-list");
    const text = editor.getValue();
    const lines = text.split("\n");
    const lineByKey = new Map();
    lines.forEach((line, idx) => {
      const m = /^([a-zA-Z_][a-zA-Z0-9_]*):/.exec(line);
      if (m && !lineByKey.has(m[1])) lineByKey.set(m[1], idx);
    });

    // Outline = Header + registered sections + any custom YAML keys the
    // user added directly (so a freshly typed ``awards:`` shows up in
    // the sidebar immediately on save).
    const FALLBACK_ORDER = [
      ["name", "header", "Header"],
      ["experience", "experience", "Experience"],
      ["education", "education", "Education"],
      ["skills", "skills", "Skills"],
      ["projects", "projects", "Projects"],
      ["leadership", "leadership", "Leadership"],
      ["others", "others", "Other"],
    ];
    let sectionOrder;
    if (serverSchema && Array.isArray(serverSchema.sections)) {
      sectionOrder = [["name", "header", "Header"]];
      serverSchema.sections.forEach((s) => {
        sectionOrder.push([s.key, s.key, s.label]);
      });
    } else {
      sectionOrder = FALLBACK_ORDER;
    }
    // Append custom sections (any list-typed top-level YAML key not in
    // the schema or reserved). Uses the form module's helper for label
    // humanisation so naming stays consistent.
    if (window.CvForm && typeof window.CvForm.detectCustomSections === "function") {
      const registeredKeys = new Set(sectionOrder.map((row) => row[0]));
      const custom = window.CvForm.detectCustomSections(cvModel, registeredKeys);
      custom.forEach((c) => sectionOrder.push([c.key, c.key, c.label]));
    }
    // Show all sections regardless of population — the progress dot
    // indicates which are filled. Outline becomes a fill-the-dots habit
    // signal rather than a contents listing.
    const items = [];
    for (const [yamlKey, renderSlug, schemaLabel] of sectionOrder) {
      const label = schemaLabel || SECTION_LABELS[yamlKey] ||
        yamlKey.charAt(0).toUpperCase() + yamlKey.slice(1);
      items.push({
        key: yamlKey,
        label,
        line: lineByKey.get(yamlKey) || 0,
        renderSlug,
      });
    }
    outlineItems = items;
    list.innerHTML = "";
    items.forEach((it, i) => {
      if (!it.renderSlug) return;
      const a = document.createElement("a");
      a.className = "outline-item";
      a.href = "#";
      a.dataset.idx = String(i);
      a.dataset.slug = it.renderSlug;
      // Progress dot — populated if the section has content, "empty" if
      // present but blank (only the header is always populated).
      const isHeader = it.renderSlug === "header";
      const sectionVal = cvModel[it.key];
      let populated;
      if (isHeader) {
        populated = "true";
      } else if (Array.isArray(sectionVal) && sectionVal.length) {
        populated = "true";
      } else if (sectionVal) {
        populated = "true";
      } else {
        populated = "empty";
      }
      a.dataset.populated = populated;
      a.innerHTML = `<span class="ol-num">${String(i + 1).padStart(2, "0")}</span><span class="ol-label">${escapeHtml(it.label)}</span>`;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (viewMode === "form" && formApi) {
          formApi.scrollTo(it.renderSlug);
        } else {
          editor.setCursor({ line: it.line, ch: 0 });
          editor.scrollIntoView({ line: it.line, ch: 0 }, 80);
          editor.focus();
        }
        pendingScrollTarget = it.renderSlug;
        if (scrollPreviewToSection(it.renderSlug)) pendingScrollTarget = null;
      });
      list.appendChild(a);
    });
    updateOutlineActive();
  }

  function updateOutlineActive() {
    if (!outlineItems.length || !editor) return;
    const cur = editor.getCursor().line;
    let activeIdx = -1;
    outlineItems.forEach((it, i) => {
      if (it.line <= cur) activeIdx = i;
    });
    $$(".outline-item").forEach((el) => {
      el.classList.toggle("active", parseInt(el.dataset.idx, 10) === activeIdx);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PANE RESIZER
  // ──────────────────────────────────────────────────────────────────────
  function setupResizer() {
    const sep = $("#resizer");
    const editorPane = $("#editor-pane");
    const stored = parseFloat(localStorage.getItem(SPLIT_KEY) || "");
    if (stored > 10 && stored < 90) editorPane.style.flexBasis = `${stored}%`;

    let dragging = false;
    sep.addEventListener("mousedown", (e) => {
      dragging = true;
      sep.classList.add("dragging");
      document.body.classList.add("dragging-resize");
      e.preventDefault();
    });
    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      sep.classList.remove("dragging");
      document.body.classList.remove("dragging-resize");
      const pct = (editorPane.getBoundingClientRect().width / $("#panes").getBoundingClientRect().width) * 100;
      localStorage.setItem(SPLIT_KEY, String(pct));
      editor && editor.refresh();
      applyZoom();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const panes = $("#panes").getBoundingClientRect();
      const pct = ((e.clientX - panes.left) / panes.width) * 100;
      const clamped = Math.max(20, Math.min(80, pct));
      editorPane.style.flexBasis = `${clamped}%`;
      editor && editor.refresh();
      applyZoom();
    });

    sep.addEventListener("dblclick", () => {
      editorPane.style.flexBasis = "50%";
      localStorage.setItem(SPLIT_KEY, "50");
      editor && editor.refresh();
      applyZoom();
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  SIDEBAR TOGGLE
  // ──────────────────────────────────────────────────────────────────────
  function setupSidebarToggle() {
    const sidebar = $("#sidebar");
    const btn = $("#sidebar-toggle");
    function apply(collapsed) {
      sidebar.classList.toggle("collapsed", collapsed);
      btn.classList.toggle("is-collapsed", collapsed);
      if (collapsed) localStorage.setItem(SIDEBAR_KEY, "collapsed");
      else localStorage.removeItem(SIDEBAR_KEY);
      requestAnimationFrame(() => {
        editor && editor.refresh();
        applyZoom();
      });
    }
    if (localStorage.getItem(SIDEBAR_KEY) === "collapsed") apply(true);
    btn.addEventListener("click", () => apply(!sidebar.classList.contains("collapsed")));
  }

  // ──────────────────────────────────────────────────────────────────────
  //  TOOLTIPS
  // ──────────────────────────────────────────────────────────────────────
  function setupTooltips() {
    const tip = $("#tooltip");
    let showTimer = null;
    let target = null;

    function showFor(el) {
      const txt = el.dataset.tooltip;
      const sc = el.dataset.shortcut;
      if (!txt) return;
      tip.innerHTML = `<span>${escapeHtml(txt)}</span>` +
        (sc ? `<span class="tip-shortcut">${escapeHtml(sc)}</span>` : "");
      const r = el.getBoundingClientRect();
      tip.style.left = `${Math.round(r.left + r.width / 2 - tip.offsetWidth / 2)}px`;
      tip.style.top = `${Math.round(r.bottom + 6)}px`;
      tip.classList.add("is-visible");
    }

    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest("[data-tooltip]");
      if (!el || el === target) return;
      target = el;
      if (showTimer) clearTimeout(showTimer);
      showTimer = setTimeout(() => { showFor(el); }, 600);
    });
    document.addEventListener("mouseout", (e) => {
      if (!target) return;
      if (e.relatedTarget && target.contains(e.relatedTarget)) return;
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      tip.classList.remove("is-visible");
      target = null;
    });
    document.addEventListener("scroll", () => tip.classList.remove("is-visible"), true);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  RESPONSIVE LAYOUT (verbatim port — critical for cold-load)
  // ──────────────────────────────────────────────────────────────────────
  let layoutResizeTimer = null;
  function setupResponsiveLayout() {
    const refresh = () => { try { editor && editor.refresh(); } catch (_) {} };
    const onResize = () => {
      if (layoutResizeTimer) clearTimeout(layoutResizeTimer);
      layoutResizeTimer = setTimeout(() => {
        layoutResizeTimer = null;
        refresh();
        applyZoom();
      }, 80);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("resize", () => requestAnimationFrame(refresh));

    const host = $("#editor-host");
    if (host && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => { refresh(); applyZoom(); });
      ro.observe(host);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(refresh).catch(() => {});
    }
    requestAnimationFrame(() => {
      refresh();
      requestAnimationFrame(refresh);
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  VIEW TOGGLE (Form ↔ YAML)
  // ──────────────────────────────────────────────────────────────────────
  let serverSchema = null;  // { sections: [...] } from /api/schema

  function setupViews() {
    formApi = window.CvForm.mount($("#form-host"), {
      model: cvModel,
      schema: serverSchema && serverSchema.sections,
      onChange: onFormChange,
    });
    applyView();
    $$(".view-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchView(tab.dataset.view));
    });
    // Fetch the schema in the background — once loaded, push it into the
    // form so the section list reflects the server registry. This lets
    // someone edit ``engine/render/sections.py`` and see the new section
    // appear after a browser refresh.
    fetch("/api/schema")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data || !Array.isArray(data.sections)) return;
        serverSchema = data;
        formApi && formApi.setSchema(data.sections);
        renderOutline();
      })
      .catch(() => { /* fall back to FALLBACK_SCHEMA in form.js */ });
  }

  function applyView() {
    const formHost = $("#form-host");
    const yamlHost = $("#yaml-host");
    // Both panes stay in the DOM. The .is-active class drives the
    // opacity crossfade (CSS transition var(--t-fast)). CodeMirror's
    // measure cache is bogus while opacity:0 isn't a problem; what
    // breaks it is the prior `hidden` attribute. Now that both are
    // mounted, just refresh on the next rAF.
    formHost.classList.toggle("is-active", viewMode === "form");
    yamlHost.classList.toggle("is-active", viewMode === "yaml");
    if (viewMode === "yaml") {
      requestAnimationFrame(() => editor && editor.refresh());
    }
    $$(".view-tab").forEach((t) => {
      const active = t.dataset.view === viewMode;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    const hint = $("#view-tabs-hint");
    if (hint) {
      hint.textContent =
        viewMode === "form"
          ? "Edits land in cv.yaml on save. Switch to YAML for raw access."
          : "Raw YAML — full power. Switch to Form for guided editing.";
    }
    // Lint toggle is only meaningful in YAML view.
    const lintBtn = $("#lint-toggle");
    if (lintBtn) {
      if (viewMode === "yaml") lintBtn.removeAttribute("hidden");
      else lintBtn.setAttribute("hidden", "");
    }
  }

  function switchView(target) {
    if (target === viewMode) return;
    if (target === "yaml") {
      // Form is canonical: serialise it into the buffer first.
      refreshYamlBufferFromModel();
      viewMode = "yaml";
    } else {
      // YAML is canonical: parse the buffer into the model. If invalid,
      // alert the user and stay on YAML view.
      try {
        const parsed = window.CvForm.yamlToModel(editor.getValue());
        if (parsed && typeof parsed === "object") replaceModel(parsed);
      } catch (err) {
        setStatus("error", "Fix YAML first");
        console.error(err);
        return;
      }
      viewMode = "form";
      if (formApi) formApi.rebuild();
    }
    localStorage.setItem(VIEW_KEY, viewMode);
    applyView();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  GLOBAL SHORTCUTS
  // ──────────────────────────────────────────────────────────────────────
  function setupShortcuts() {
    document.addEventListener("keydown", (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "s") {
        e.preventDefault();
        userInitiatedSave();
      } else if (meta && e.key === "\\") {
        e.preventDefault();
        $("#sidebar-toggle").click();
      } else if (meta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        bumpZoom(+ZOOM_STEP);
      } else if (meta && e.key === "-") {
        e.preventDefault();
        bumpZoom(-ZOOM_STEP);
      } else if (meta && e.key === "0") {
        e.preventDefault();
        setZoom(0);
      } else if (meta && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        // Don't intercept inside CodeMirror — it has its own undo/redo
        // for the YAML buffer.
        if (e.target.closest && e.target.closest(".CodeMirror")) return;
        e.preventDefault();
        redo();
      } else if (meta && (e.key === "z" || e.key === "Z")) {
        if (e.target.closest && e.target.closest(".CodeMirror")) return;
        e.preventDefault();
        undo();
      }
    });
    $("#save-btn").addEventListener("click", userInitiatedSave);
  }

  function setupBeforeUnload() {
    window.addEventListener("beforeunload", (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  BOOT
  // ──────────────────────────────────────────────────────────────────────
  function init() {
    if (window.renderIcons) window.renderIcons();
    setupTheme();
    setupEditor();
    setupViews();
    setupResizer();
    setupSidebarToggle();
    setupTooltips();
    setupModeToggle();
    setupAppearance();
    setupImport();
    setupPagedListener();
    setupPreviewActions();
    setupAutoRenderToggle();
    setupThemePicker();
    setupLintToggle();
    setupBuildButton();
    setupCvSwitcher();
    setupIssuesPill();
    setupPolish();
    setupCollapsedSections();
    setupTour();
    setupShortcuts();
    setupBeforeUnload();
    setupResponsiveLayout();
    loadCv().catch((err) => {
      setStatus("error", "Load failed");
      console.error(err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
