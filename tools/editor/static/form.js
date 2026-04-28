/* ============================================================================
   form.js — structured form editor for cv.yaml.

   Exposes a single global ``window.CvForm`` with ``mount(container, opts)``.
   The form mutates ``opts.model`` directly; on every change ``opts.onChange``
   fires (so the host can debounce a save + preview refresh).

   Schema mirrors ``engine/render/content.py``:

     name, accent, font, photo, contact[], experience[], education[],
     skills[], projects[], leadership[], others[]

   The form does NOT validate — that's the engine's job at build time. We
   keep the UI permissive so users can save half-finished entries.
   ============================================================================ */
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const NETWORK_OPTIONS = [
    "mail", "phone", "web",
    "linkedin", "github", "gitlab", "x", "mastodon", "bluesky",
    "instagram", "youtube", "telegram", "whatsapp", "reddit",
    "stackoverflow", "leetcode", "orcid", "googlescholar",
    "researchgate", "imdb",
  ];

  const NETWORK_LABEL = {
    mail: "Email", phone: "Phone", web: "Website",
    linkedin: "LinkedIn", github: "GitHub", gitlab: "GitLab", x: "X / Twitter",
    mastodon: "Mastodon", bluesky: "Bluesky", instagram: "Instagram",
    youtube: "YouTube", telegram: "Telegram", whatsapp: "WhatsApp",
    reddit: "Reddit", stackoverflow: "Stack Overflow", leetcode: "LeetCode",
    orcid: "ORCID", googlescholar: "Google Scholar",
    researchgate: "ResearchGate", imdb: "IMDb",
  };

  // Sections in render order (matches engine/render/templates.py).
  const SECTIONS = [
    { key: "header",     label: "Header",     icon: "user" },
    { key: "experience", label: "Experience", icon: "briefcase" },
    { key: "education",  label: "Education",  icon: "graduation-cap" },
    { key: "skills",     label: "Skills",     icon: "wrench" },
    { key: "projects",   label: "Projects",   icon: "lightbulb" },
    { key: "leadership", label: "Leadership", icon: "trophy" },
    { key: "others",     label: "Other",      icon: "more" },
  ];

  // ──────────────────────────────────────────────────────────────────────
  //  MOTION HELPERS — Web Animations API, respect prefers-reduced-motion.
  // ──────────────────────────────────────────────────────────────────────
  const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)");

  const ENTER_TIMING = { duration: 200, easing: "cubic-bezier(0.16, 1, 0.30, 1)", fill: "both" };
  const EXIT_TIMING  = { duration: 160, easing: "cubic-bezier(0.7, 0, 0.84, 0)",  fill: "both" };
  const STAGGER_MS = 22;
  const STAGGER_CAP = 6;

  function animateCardIn(card, delay = 0) {
    if (REDUCED_MOTION.matches) return Promise.resolve();
    card.style.overflow = "hidden";
    const h = card.getBoundingClientRect().height;
    const a = card.animate(
      [
        { height: "0px",      opacity: 0, transform: "translateY(-3px)" },
        { height: `${h}px`,   opacity: 1, transform: "translateY(0)" },
      ],
      { ...ENTER_TIMING, delay },
    );
    return a.finished
      .catch(() => {})
      .then(() => { card.style.overflow = ""; card.style.height = ""; });
  }

  function animateCardOut(card) {
    if (REDUCED_MOTION.matches) return Promise.resolve();
    const h = card.getBoundingClientRect().height;
    card.style.overflow = "hidden";
    const a = card.animate(
      [
        { height: `${h}px`, opacity: 1, transform: "translateY(0)" },
        { height: "0px",    opacity: 0, transform: "translateY(-2px)" },
      ],
      EXIT_TIMING,
    );
    return a.finished.catch(() => {});
  }

  // ──────────────────────────────────────────────────────────────────────
  //  DOM HELPERS
  // ──────────────────────────────────────────────────────────────────────
  function el(tag, props, ...children) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "class") n.className = v;
        else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
        else if (k.startsWith("on") && typeof v === "function") {
          n.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "html") n.innerHTML = v;
        else if (v === false || v == null) continue;
        else if (v === true) n.setAttribute(k, "");
        else n.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }

  function iconBtn(name, label, onClick, opts = {}) {
    const b = el("button", {
      type: "button",
      class: `form-icon-btn ${opts.tone || ""}`,
      "aria-label": label,
      title: label,
      onClick,
    });
    b.innerHTML = `<span data-icon="${name}" data-icon-size="14"></span>`;
    if (window.renderIcons) window.renderIcons(b);
    return b;
  }

  function field(label, type, value, onChange, opts = {}) {
    const id = `f-${Math.random().toString(36).slice(2, 8)}`;
    const startEmpty = value == null || value === "";
    const required = !!opts.required;
    const inputAttrs = {
      id,
      type,
      value: value == null ? "" : String(value),
      placeholder: opts.placeholder || "",
      spellcheck: opts.spellcheck === false ? "false" : "true",
      list: opts.list || null,
      oninput: (e) => {
        onChange(e.target.value);
        if (required) {
          const empty = !e.target.value.trim();
          e.target.toggleAttribute("aria-invalid", empty);
          e.target.toggleAttribute("data-empty", empty);
        }
      },
    };
    if (required) {
      inputAttrs["data-required"] = "true";
      if (startEmpty) {
        inputAttrs["aria-invalid"] = "true";
        inputAttrs["data-empty"] = "true";
      }
    }
    const input =
      type === "textarea"
        ? el("textarea", {
            ...inputAttrs,
            rows: opts.rows || 3,
          })
        : el("input", inputAttrs);
    if (type === "textarea") input.value = value == null ? "" : String(value);
    return el(
      "label",
      { class: `form-field ${opts.compact ? "form-field-compact" : ""}` },
      el("span", { class: "form-field-label" }, label, opts.required ? el("span", { class: "form-field-required" }, " *") : null),
      input,
      opts.hint ? el("span", { class: "form-field-hint" }, opts.hint) : null,
    );
  }

  function selectField(label, value, options, onChange, opts = {}) {
    const sel = el(
      "select",
      { onchange: (e) => onChange(e.target.value) },
      ...options.map((o) => {
        const [val, lbl] = Array.isArray(o) ? o : [o, o];
        const node = el("option", { value: val }, lbl);
        if (val === value) node.selected = true;
        return node;
      }),
    );
    return el(
      "label",
      { class: `form-field ${opts.compact ? "form-field-compact" : ""}` },
      el("span", { class: "form-field-label" }, label),
      sel,
    );
  }

  function listSection(opts) {
    // opts: { key, label, icon, items, blank, render, model, onChange,
    //         eyebrow, singular }
    const { key, label, items, blank, render, onChange, eyebrow } = opts;
    const singular = opts.singular || label.toLowerCase().replace(/s$/, "");
    const list = el("div", { class: "form-list", id: `form-list-${key}` });
    const countEl = el("span", { class: "form-section-count" }, `${items.length}`);

    function emptyState() {
      const empty = el(
        "div",
        { class: "form-empty" },
        el("span", { class: "form-empty-glyph", "data-icon": "plus-circle", "data-icon-size": "16" }),
        el("p", { class: "form-empty-title" }, `No ${label.toLowerCase()} yet`),
        el(
          "p",
          { class: "form-empty-sub", html:
            `Click <em>Add ${escapeHtml(singular)}</em> below — every entry becomes one block on your CV.`
          },
        ),
      );
      if (window.renderIcons) window.renderIcons(empty);
      return empty;
    }

    function makeCard(item, idx) {
      const card = el(
        "div",
        { class: "form-card", "data-idx": String(idx) },
        el(
          "div",
          { class: "form-card-actions" },
          iconBtn("chevron-up", "Move up", () => {
            const i = parseInt(card.dataset.idx, 10);
            if (i === 0) return;
            [items[i - 1], items[i]] = [items[i], items[i - 1]];
            // Swap DOM nodes without animating to keep ordering snappy.
            const prev = list.querySelector(`[data-idx="${i - 1}"]`);
            if (prev) list.insertBefore(card, prev);
            reindex();
            onChange();
          }),
          iconBtn("chevron-down", "Move down", () => {
            const i = parseInt(card.dataset.idx, 10);
            if (i === items.length - 1) return;
            [items[i + 1], items[i]] = [items[i], items[i + 1]];
            const next = list.querySelector(`[data-idx="${i + 1}"]`);
            if (next && next.nextSibling) list.insertBefore(card, next.nextSibling);
            else if (next) list.appendChild(card);
            reindex();
            onChange();
          }),
          iconBtn(
            "trash",
            "Remove",
            async () => {
              const i = parseInt(card.dataset.idx, 10);
              items.splice(i, 1);
              await animateCardOut(card);
              card.remove();
              reindex();
              countEl.textContent = `${items.length}`;
              if (!items.length) {
                const empty = emptyState();
                list.appendChild(empty);
                animateCardIn(empty);
              }
              onChange();
            },
            { tone: "danger" },
          ),
        ),
        render(item, () => onChange()),
      );
      if (window.renderIcons) window.renderIcons(card);
      return card;
    }

    function reindex() {
      $$(".form-card", list).forEach((c, i) => { c.dataset.idx = String(i); });
    }

    function rebuild() {
      list.innerHTML = "";
      if (!items.length) {
        list.appendChild(emptyState());
        countEl.textContent = "0";
        return;
      }
      items.forEach((item, idx) => list.appendChild(makeCard(item, idx)));
      countEl.textContent = `${items.length}`;
    }

    rebuild();

    const addBtn = el(
      "button",
      {
        type: "button",
        class: "form-add-btn",
        onClick: () => {
          // Drop the empty-state DOM if it's there.
          const empty = list.querySelector(".form-empty");
          if (empty) empty.remove();
          const newItem = structuredClone(blank);
          items.push(newItem);
          const card = makeCard(newItem, items.length - 1);
          list.appendChild(card);
          countEl.textContent = `${items.length}`;
          animateCardIn(card).then(() => {
            const firstInput = card.querySelector("input, textarea, select");
            if (firstInput) firstInput.focus();
          });
          onChange();
        },
      },
      el("span", { "data-icon": "plus-circle", "data-icon-size": "13" }),
      el("span", null, `Add ${singular}`),
    );
    if (window.renderIcons) window.renderIcons(addBtn);

    const eyebrowText = eyebrow || `Section · ${label}`;
    const head = el(
      "header",
      {
        class: "form-section-head is-collapsible",
        "data-eyebrow": eyebrowText,
        role: "button",
        tabindex: "0",
        "aria-expanded": "true",
      },
      el(
        "h3",
        null,
        el("span", null, label),
        countEl,
        el("span", { class: "form-section-chevron", "data-icon": "chevron-down", "data-icon-size": "14" }),
      ),
    );
    const body = el("div", { class: "form-section-body" }, list, addBtn);

    function toggle() {
      // aria-expanded="true" → currently expanded, so flip to collapsed.
      const isExpanded = head.getAttribute("aria-expanded") !== "false";
      const next = isExpanded; // we're collapsing if it WAS expanded
      head.setAttribute("aria-expanded", next ? "false" : "true");
      body.toggleAttribute("hidden", next);
      window.dispatchEvent(new CustomEvent("cv:section-collapsed", {
        detail: { key, collapsed: next },
      }));
    }
    head.addEventListener("click", (e) => {
      // Don't toggle when clicking on inputs inside the head (none today,
      // but defensive against future changes).
      if (e.target.closest("input, textarea, select, button")) return;
      toggle();
    });
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });

    return el(
      "section",
      {
        class: "form-section",
        id: `form-section-${key}`,
        "data-section-key": key,
      },
      head,
      body,
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ──────────────────────────────────────────────────────────────────────
  //  SECTION RENDERERS
  // ──────────────────────────────────────────────────────────────────────
  function renderHeaderSection(model, onChange) {
    // Appearance (accent / font / density) lives in the topbar — keep
    // the form section minimal. Just name + photo here.
    const grid = el(
      "div",
      { class: "form-grid form-grid-2" },
      field(
        "Full name",
        "text",
        model.name,
        (v) => { model.name = v; onChange(); },
        { required: true, placeholder: "Alex Hartman" },
      ),
      photoDropZone(model, onChange),
    );

    const head = el(
      "header",
      {
        class: "form-section-head is-collapsible",
        "data-eyebrow": "Section 01 · Identity",
        role: "button",
        tabindex: "0",
        "aria-expanded": "true",
      },
      el(
        "h3",
        null,
        el("span", null, "Header"),
        el("span", { class: "form-section-chevron", "data-icon": "chevron-down", "data-icon-size": "14" }),
      ),
    );
    const body = el("div", { class: "form-section-body" }, grid, contactSection(model, onChange));
    function toggle() {
      const collapsed = head.getAttribute("aria-expanded") === "false";
      const next = !collapsed;
      head.setAttribute("aria-expanded", next ? "false" : "true");
      body.toggleAttribute("hidden", next);
      window.dispatchEvent(new CustomEvent("cv:section-collapsed", {
        detail: { key: "header", collapsed: next },
      }));
    }
    head.addEventListener("click", (e) => {
      if (e.target.closest("input, textarea, select, button")) return;
      toggle();
    });
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    return el(
      "section",
      {
        class: "form-section",
        id: "form-section-header",
        "data-section-key": "header",
      },
      head,
      body,
    );
  }

  function contactSection(model, onChange) {
    if (!Array.isArray(model.contact)) model.contact = [];
    const items = model.contact;

    return listSection({
      key: "contact",
      label: "Contact",
      eyebrow: "Section 01b · Reach me",
      singular: "contact",
      items,
      blank: { network: "linkedin", username: "" },
      model,
      onChange,
      render: (item, fire) =>
        el(
          "div",
          { class: "form-grid form-grid-3" },
          selectField(
            "Network",
            item.network || "",
            [["", "— plain (no icon)"]].concat(NETWORK_OPTIONS.map((n) => [n, NETWORK_LABEL[n] || n])),
            (v) => { item.network = v; fire(); },
            { compact: true },
          ),
          field(
            "Username / value",
            "text",
            item.username || "",
            (v) => { item.username = v; fire(); },
            { compact: true, placeholder: "you@example.com or your-handle", spellcheck: false },
          ),
          field(
            "Display label (optional)",
            "text",
            item.label || "",
            (v) => { item.label = v; fire(); },
            { compact: true, placeholder: "GitHub" },
          ),
          field(
            "Custom href (optional)",
            "text",
            item.href || "",
            (v) => { item.href = v; fire(); },
            { compact: true, placeholder: "auto-resolved from username", spellcheck: false },
          ),
        ),
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PHOTO DROP-ZONE — drag a JPG/PNG anywhere on this label, or click
  //  "Choose file…" to open a picker. The chosen file is uploaded to
  //  /api/asset/photo, which saves it as design/photo.<ext> and returns
  //  the relative path. We then patch model.photo + fire onChange so
  //  the YAML picks it up.
  // ──────────────────────────────────────────────────────────────────────
  function photoDropZone(model, onChange) {
    const wrap = el("label", { class: "form-field photo-drop" });
    wrap.appendChild(el("span", { class: "form-field-label" }, "Photo (optional)"));

    const zone = el("div", {
      class: "photo-drop-zone" + (model.photo ? " has-photo" : ""),
      tabindex: "0",
    });
    const fileInput = el("input", {
      type: "file",
      accept: "image/jpeg,image/png,image/webp,image/gif",
      hidden: true,
    });
    const status = el("div", { class: "photo-drop-status" });

    function refreshUi() {
      zone.innerHTML = "";
      zone.appendChild(fileInput);
      if (model.photo) {
        zone.classList.add("has-photo");
        const img = el("img", {
          class: "photo-thumb",
          src: `/repo/${encodeAssetPath(model.photo)}?t=${Date.now()}`,
          alt: "",
        });
        const meta = el("div", { class: "photo-meta" },
          el("span", { class: "photo-path" }, model.photo),
          el("button", {
            type: "button",
            class: "photo-remove",
            onClick: async (e) => {
              e.preventDefault();
              try { await fetch("/api/asset/photo", { method: "DELETE" }); } catch (_) {}
              model.photo = "";
              onChange();
              refreshUi();
            },
          }, "Remove"),
        );
        zone.appendChild(img);
        zone.appendChild(meta);
      } else {
        zone.classList.remove("has-photo");
        const inner = el("div", { class: "photo-drop-empty" },
          el("span", { class: "photo-drop-icon", "data-icon": "user", "data-icon-size": "20" }),
          el("span", { class: "photo-drop-title" }, "Drop a JPG, PNG, or WebP here"),
          el("span", { class: "photo-drop-sub" },
            "or ",
            el("button", {
              type: "button",
              class: "photo-drop-pick",
              onClick: (e) => { e.preventDefault(); fileInput.click(); },
            }, "choose a file"),
          ),
        );
        zone.appendChild(inner);
        if (window.renderIcons) window.renderIcons(inner);
      }
      zone.appendChild(status);
    }

    async function handleFile(file) {
      if (!file) return;
      status.textContent = "Uploading…";
      status.classList.remove("is-error");
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/asset/photo", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        model.photo = data.path;
        status.textContent = "";
        onChange();
        refreshUi();
      } catch (err) {
        status.textContent = `Upload failed: ${err.message}`;
        status.classList.add("is-error");
      }
    }

    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFile(file);
    });
    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add("is-dragging");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove("is-dragging");
      }),
    );
    zone.addEventListener("drop", (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });

    refreshUi();
    wrap.appendChild(zone);
    return wrap;
  }

  function encodeAssetPath(rel) {
    // The asset route serves anything under the repo, with the absolute
    // path included after /asset/. Leave the slashes intact.
    return rel.split("/").map(encodeURIComponent).join("/");
  }

  // ──────────────────────────────────────────────────────────────────────
  //  SHAPE_RENDERERS — shape → DOM builder.
  //
  //  Each renderer takes a SectionDef (from /api/schema) plus the model
  //  and onChange callback, and returns a complete <section> DOM tree.
  //  Internally they delegate to listSection() with a per-item render
  //  function.
  //
  //  # 🤖 ADD-A-SHAPE-HERE
  //  To add a new visual shape: add a function below, register it in
  //  SHAPE_RENDERERS at the bottom of this block, and add the matching
  //  Python renderer in engine/render/templates.py:_PER_ITEM_RENDERERS.
  // ──────────────────────────────────────────────────────────────────────

  function experienceShape(section, model, onChange) {
    const key = section.key;
    if (!Array.isArray(model[key])) model[key] = [];
    return listSection({
      key,
      label: section.label,
      eyebrow: section.eyebrow,
      singular: section.singular,
      items: model[key],
      blank: { role: "", company: "", location: "", start: "", end: "Present", bullets: [], stack: "" },
      model,
      onChange,
      render: (item, fire) => {
        return el(
          "div",
          { class: "form-card-grid" },
          el(
            "div",
            { class: "form-grid form-grid-2" },
            field("Role", "text", item.role, (v) => { item.role = v; fire(); }, {
              compact: true, placeholder: "Senior Software Engineer", required: true,
            }),
            field("Company", "text", item.company, (v) => { item.company = v; fire(); }, {
              compact: true, placeholder: "Acme Corp", required: true,
            }),
            field("Location", "text", item.location, (v) => { item.location = v; fire(); }, {
              compact: true, placeholder: "Berlin, Germany",
            }),
            field("Start", "text", item.start, (v) => { item.start = v; fire(); }, {
              compact: true, placeholder: "02/2024", required: true,
            }),
            field("End", "text", item.end, (v) => { item.end = v; fire(); }, {
              compact: true, placeholder: "Present", required: true,
            }),
            field("Stack (optional)", "text", item.stack, (v) => { item.stack = v; fire(); }, {
              compact: true, placeholder: "Python, SQL, AWS",
            }),
          ),
          bulletEditor(item, fire),
        );
      },
    });
  }

  /**
   * Per-bullet editor: each bullet gets its own input with reorder
   * arrows, char counter, and (when AI extract is available) a small
   * polish button. Replaces the multi-line textarea.
   */
  function bulletEditor(item, fire) {
    if (!Array.isArray(item.bullets)) item.bullets = [];
    const wrap = el("div", { class: "bullets-editor" });
    const polishBtn = el(
      "button",
      {
        type: "button",
        class: "section-polish",
        "data-tooltip": "Tighten all bullets in this role with Claude",
        onClick: (e) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("cv:polish-section", {
            detail: { item, fire, button: polishBtn },
          }));
        },
      },
      el("span", { "data-icon": "sparkles", "data-icon-size": "11" }),
      el("span", null, "Polish all"),
    );
    wrap.appendChild(el(
      "div",
      { class: "bullets-editor-head" },
      el("span", { class: "form-field-label" }, "Bullets"),
      el("span", { class: "form-field-hint" }, "**bold** · *italic* · `code` are supported"),
      polishBtn,
    ));
    const list = el("div", { class: "bullets-list" });
    wrap.appendChild(list);

    function rebuild() {
      list.innerHTML = "";
      item.bullets.forEach((text, idx) => list.appendChild(makeRow(text, idx)));
      list.appendChild(addRow());
      if (window.renderIcons) window.renderIcons(list);
    }

    function makeRow(text, idx) {
      const input = el("input", {
        type: "text",
        class: "bullet-input",
        value: text,
        placeholder: "Verb + what + impact (numbers > adjectives)",
        spellcheck: "true",
      });
      input.addEventListener("input", () => {
        item.bullets[idx] = input.value;
        counter.textContent = `${input.value.length}`;
        counter.classList.toggle("is-warn", input.value.length > 180);
        fire();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          item.bullets.splice(idx + 1, 0, "");
          rebuild();
          fire();
          // Focus the new row's input.
          const rows = list.querySelectorAll(".bullet-row .bullet-input");
          if (rows[idx + 1]) rows[idx + 1].focus();
        } else if (e.key === "Backspace" && input.value === "" && item.bullets.length > 1) {
          e.preventDefault();
          item.bullets.splice(idx, 1);
          rebuild();
          fire();
          const rows = list.querySelectorAll(".bullet-row .bullet-input");
          (rows[idx - 1] || rows[0])?.focus();
        }
      });
      const counter = el("span", { class: "bullet-count" }, String(text.length));
      if (text.length > 180) counter.classList.add("is-warn");

      const actions = el(
        "div",
        { class: "bullet-actions" },
        iconBtn("chevron-up", "Move up", () => {
          if (idx === 0) return;
          [item.bullets[idx - 1], item.bullets[idx]] = [item.bullets[idx], item.bullets[idx - 1]];
          rebuild();
          fire();
        }),
        iconBtn("chevron-down", "Move down", () => {
          if (idx === item.bullets.length - 1) return;
          [item.bullets[idx + 1], item.bullets[idx]] = [item.bullets[idx], item.bullets[idx + 1]];
          rebuild();
          fire();
        }),
        // AI polish (★) button — handler is attached lazily by app.js
        // when /api/extract/status reports Claude available. The button
        // is always rendered; it's a no-op until wired.
        el("button", {
          type: "button",
          class: "bullet-polish",
          "aria-label": "Tighten with Claude",
          "data-tooltip": "Tighten this bullet with Claude (✨)",
          "data-bullet-action": "polish",
          onClick: (e) => {
            e.preventDefault();
            const detail = { input, value: input.value, setValue: (v) => {
              input.value = v;
              item.bullets[idx] = v;
              counter.textContent = `${v.length}`;
              counter.classList.toggle("is-warn", v.length > 180);
              fire();
            }};
            window.dispatchEvent(new CustomEvent("cv:polish-bullet", { detail }));
          },
        },
          el("span", { "data-icon": "sparkles", "data-icon-size": "12" }),
        ),
        iconBtn(
          "trash",
          "Remove bullet",
          () => {
            item.bullets.splice(idx, 1);
            if (!item.bullets.length) item.bullets.push("");
            rebuild();
            fire();
          },
          { tone: "danger" },
        ),
      );

      return el(
        "div",
        { class: "bullet-row" },
        input,
        counter,
        actions,
      );
    }

    function addRow() {
      const btn = el("button", {
        type: "button",
        class: "bullet-add-btn",
        onClick: () => {
          item.bullets.push("");
          rebuild();
          fire();
          const rows = list.querySelectorAll(".bullet-row .bullet-input");
          rows[rows.length - 1]?.focus();
        },
      },
        el("span", { "data-icon": "plus-circle", "data-icon-size": "12" }),
        el("span", null, "Add bullet"),
      );
      return btn;
    }

    if (item.bullets.length === 0) item.bullets.push("");
    rebuild();
    return wrap;
  }

  function educationShape(section, model, onChange) {
    const key = section.key;
    if (!Array.isArray(model[key])) model[key] = [];
    return listSection({
      key,
      label: section.label,
      eyebrow: section.eyebrow,
      singular: section.singular,
      items: model[key],
      blank: { degree: "", school: "", location: "", start: "", end: "", note: "" },
      model,
      onChange,
      render: (item, fire) =>
        el(
          "div",
          { class: "form-grid form-grid-2" },
          field("Degree", "text", item.degree, (v) => { item.degree = v; fire(); }, {
            compact: true, placeholder: "M.Sc. Computer Science", required: true,
          }),
          field("School", "text", item.school, (v) => { item.school = v; fire(); }, {
            compact: true, placeholder: "FAU Erlangen-Nuremberg", required: true,
          }),
          field("Location", "text", item.location, (v) => { item.location = v; fire(); }, {
            compact: true, placeholder: "Erlangen, Germany",
          }),
          field("Start", "text", item.start, (v) => { item.start = v; fire(); }, {
            compact: true, placeholder: "10/2018", required: true,
          }),
          field("End", "text", item.end, (v) => { item.end = v; fire(); }, {
            compact: true, placeholder: "07/2022", required: true,
          }),
          field("Note (optional)", "text", item.note, (v) => { item.note = v; fire(); }, {
            compact: true, placeholder: "Graduated with distinction.",
          }),
        ),
    });
  }

  function skillsShape(section, model, onChange) {
    const key = section.key;
    if (!Array.isArray(model[key])) model[key] = [];
    return listSection({
      key,
      label: section.label,
      eyebrow: section.eyebrow,
      singular: section.singular,
      items: model[key],
      blank: { label: "", items: "" },
      model,
      onChange,
      render: (item, fire) =>
        el(
          "div",
          { class: "form-card-grid" },
          field("Category", "text", item.label, (v) => { item.label = v; fire(); }, {
            compact: true, placeholder: "Languages", required: true,
          }),
          chipsField("Items", item.items, (v) => { item.items = v; fire(); }, {
            placeholder: "Type a skill, press Enter…",
          }),
        ),
    });
  }

  /**
   * Chip-list editor for a comma-separated string field.
   *
   * Stores the value as the same comma-separated string the rest of the
   * pipeline expects (so the YAML on disk doesn't change). Renders each
   * comma-split token as a removable pill, plus a "Type and press Enter"
   * input at the end.
   */
  function chipsField(labelText, value, onChange, opts = {}) {
    function parse(s) {
      return String(s || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
    function serialise(arr) {
      return arr.join(", ");
    }

    let items = parse(value);
    const wrap = el("label", { class: "form-field" });
    wrap.appendChild(el("span", { class: "form-field-label" }, labelText));
    const box = el("div", { class: "chips-box" });
    const input = el("input", {
      type: "text",
      class: "chips-input",
      placeholder: opts.placeholder || "",
      spellcheck: "true",
    });

    function rebuild() {
      box.innerHTML = "";
      items.forEach((it, idx) => {
        const chip = el(
          "span",
          { class: "chip" },
          el("span", { class: "chip-text" }, it),
          el("button", {
            type: "button",
            class: "chip-x",
            "aria-label": `Remove ${it}`,
            onClick: () => {
              items.splice(idx, 1);
              rebuild();
              onChange(serialise(items));
            },
          }, "×"),
        );
        box.appendChild(chip);
      });
      box.appendChild(input);
    }

    function commit() {
      const v = input.value.trim().replace(/,+$/, "").trim();
      if (!v) return;
      // Split on commas in case the user pasted a list.
      v.split(",").map((s) => s.trim()).filter(Boolean).forEach((t) => items.push(t));
      input.value = "";
      rebuild();
      onChange(serialise(items));
      input.focus();
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit();
      } else if (e.key === "Backspace" && input.value === "" && items.length) {
        e.preventDefault();
        items.pop();
        rebuild();
        onChange(serialise(items));
      }
    });
    input.addEventListener("blur", () => {
      if (input.value.trim()) commit();
    });

    rebuild();
    wrap.appendChild(box);
    return wrap;
  }

  function publicationShape(section, model, onChange) {
    const key = section.key;
    if (!Array.isArray(model[key])) model[key] = [];
    return listSection({
      key,
      label: section.label,
      eyebrow: section.eyebrow,
      singular: section.singular,
      items: model[key],
      blank: { title: "", authors: "", venue: "", date: "", doi: "", url: "" },
      model,
      onChange,
      render: (item, fire) =>
        el(
          "div",
          { class: "form-card-grid" },
          field("Title", "text", item.title, (v) => { item.title = v; fire(); }, {
            compact: true, placeholder: "Paper / talk title",
          }),
          field("Authors (you first if applicable)", "text", item.authors, (v) => { item.authors = v; fire(); }, {
            compact: true, placeholder: "A. Author, B. Author, C. Hartman",
          }),
          el(
            "div",
            { class: "form-grid form-grid-2" },
            field("Venue", "text", item.venue, (v) => { item.venue = v; fire(); }, {
              compact: true, placeholder: "ICLR · Nature · Preprint",
            }),
            field("Date", "text", item.date, (v) => { item.date = v; fire(); }, {
              compact: true, placeholder: "04/2024",
            }),
            field("DOI (optional)", "text", item.doi, (v) => { item.doi = v; fire(); }, {
              compact: true, placeholder: "10.5555/abc",
            }),
            field("URL (optional)", "text", item.url, (v) => { item.url = v; fire(); }, {
              compact: true, placeholder: "https://…",
            }),
          ),
        ),
    });
  }

  function compactShape(section, model, onChange) {
    return _compactSectionImpl(section.key, section.label, model, onChange, section.eyebrow, section.singular);
  }

  // The compact-row renderer used by projects/leadership/others/etc.
  function _compactSectionImpl(key, label, model, onChange, eyebrow, singular) {
    if (!Array.isArray(model[key])) model[key] = [];
    return listSection({
      key,
      label,
      eyebrow,
      singular: singular || label.toLowerCase().replace(/s$/, ""),
      items: model[key],
      blank: { title: "", date: "", desc: "" },
      model,
      onChange,
      render: (item, fire) =>
        el(
          "div",
          { class: "form-card-grid" },
          el(
            "div",
            { class: "form-grid form-grid-21" },
            field("Title", "text", item.title, (v) => { item.title = v; fire(); }, {
              compact: true, placeholder: "OSS contribution", required: true,
            }),
            field("Date", "text", item.date, (v) => { item.date = v; fire(); }, {
              compact: true, placeholder: "08/2023",
            }),
          ),
          field("Description", "text", item.desc, (v) => { item.desc = v; fire(); }, {
            compact: true, placeholder: "Short one-line description.",
          }),
        ),
    });
  }

  // The shape registry — keys must match engine/render/sections.py shapes.
  const SHAPE_RENDERERS = {
    experience:  experienceShape,
    education:   educationShape,
    skills:      skillsShape,
    compact:     compactShape,
    publication: publicationShape,
  };

  // Fallback schema used only if /api/schema is unreachable. Mirrors the
  // Python registry's default for offline robustness.
  const FALLBACK_SCHEMA = [
    { key: "experience", label: "Experience", eyebrow: "Section 02 · Where you've worked", singular: "role",     shape: "experience" },
    { key: "education",  label: "Education",  eyebrow: "Section 03 · Where you studied",   singular: "degree",   shape: "education" },
    { key: "skills",     label: "Skills",     eyebrow: "Section 04 · The toolkit",         singular: "category", shape: "skills" },
    { key: "projects",   label: "Projects",   eyebrow: "Section 05 · Things you built",    singular: "project",  shape: "compact" },
    { key: "leadership", label: "Leadership", eyebrow: "Section 06 · How you led",         singular: "entry",    shape: "compact" },
    { key: "others",     label: "Other",      eyebrow: "Section 07 · Awards & extras",     singular: "entry",    shape: "compact" },
  ];

  // Top-level YAML keys that are NOT sections. Anything else with a list
  // value gets exposed as a custom section in the form + outline.
  const RESERVED_TOP_LEVEL = new Set(["name", "contact", "accent", "font", "photo"]);

  /** Heuristic: pick the closest shape from the first item's keys. */
  function detectShape(items) {
    if (!Array.isArray(items) || !items.length) return "compact";
    const sample = items[0];
    if (!sample || typeof sample !== "object") return "compact";
    const keys = new Set(Object.keys(sample));
    if (keys.has("role") && keys.has("company")) return "experience";
    if (keys.has("degree") && keys.has("school")) return "education";
    if (keys.has("label") && keys.has("items") && keys.size <= 3) return "skills";
    if (keys.has("authors") || (keys.has("venue") && keys.has("title"))) return "publication";
    return "compact";
  }

  /** Turn ``speaking_engagements`` → ``Speaking Engagements`` (with English small-words rule). */
  function humanizeKey(key) {
    const SMALL = new Set(["and", "of", "the", "to", "in", "on", "at", "for"]);
    const cleaned = String(key).replace(/[_-]+/g, " ").trim();
    if (!cleaned) return key;
    return cleaned.split(/\s+/).map((w, i) => {
      if (i === 0) return w[0].toUpperCase() + w.slice(1).toLowerCase();
      return SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase();
    }).join(" ");
  }

  /** Detect custom sections in the model that aren't in the registered schema. */
  function detectCustomSections(model, registeredKeys) {
    const out = [];
    let counter = 100;
    for (const [key, value] of Object.entries(model || {})) {
      if (RESERVED_TOP_LEVEL.has(key)) continue;
      if (registeredKeys.has(key)) continue;
      if (!Array.isArray(value)) continue;
      out.push({
        key,
        label: humanizeKey(key),
        eyebrow: `Custom · ${humanizeKey(key)}`,
        singular: humanizeKey(key).replace(/s$/, "").toLowerCase() || "entry",
        shape: detectShape(value),
        custom: true,
        // Sentinel "high index" so they appear after registered sections
        // but maintain insertion order among themselves.
        _order: counter++,
      });
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PUBLIC API
  // ──────────────────────────────────────────────────────────────────────
  function mount(container, opts) {
    const { model, onChange } = opts;
    let schema = Array.isArray(opts.schema) && opts.schema.length ? opts.schema : FALLBACK_SCHEMA;
    if (!model.contact) model.contact = [];

    function rebuild() {
      container.innerHTML = "";
      const registeredKeys = new Set(schema.map((s) => s.key));
      const customDefs = detectCustomSections(model, registeredKeys);
      const allDefs = schema.concat(customDefs);

      const sectionEls = [];
      for (const def of allDefs) {
        const renderer = SHAPE_RENDERERS[def.shape] || compactShape;
        sectionEls.push(renderer(def, model, onChange));
      }
      const root = el(
        "div",
        { class: "form-root" },
        renderHeaderSection(model, onChange),
        ...sectionEls,
      );
      container.appendChild(root);
      // Stagger entrance: each .form-section gets a --i index used by the
      // CSS animation-delay calculator. Cap so the cascade never exceeds
      // ~200 ms of perceived latency.
      $$(".form-section", container).forEach((s, i) => {
        s.style.setProperty("--i", String(Math.min(i, 5)));
      });
      if (window.renderIcons) window.renderIcons(container);
    }

    rebuild();

    return {
      rebuild,
      setSchema(next) {
        if (Array.isArray(next) && next.length) {
          schema = next;
          rebuild();
        }
      },
      scrollTo(slug) {
        const target = $(`#form-section-${slug}`, container);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  YAML SERIALISATION
  // ──────────────────────────────────────────────────────────────────────
  // Strip undefined / empty arrays / empty strings before YAML.dump so the
  // serialised file stays clean.
  function pruneEmpty(value) {
    if (Array.isArray(value)) {
      const out = value.map(pruneEmpty).filter((v) => v !== undefined);
      return out;
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const cleaned = pruneEmpty(v);
        if (cleaned === undefined) continue;
        if (cleaned === "" && k !== "label" && k !== "username") continue;
        if (Array.isArray(cleaned) && cleaned.length === 0) continue;
        out[k] = cleaned;
      }
      return out;
    }
    return value;
  }

  const HEADER_COMMENT = `# CV source — single source of truth for the renderer.
# Edit any field, save, and the editor preview re-renders within ~200ms.
# A4 hard-constrained to one page; the build fails if it overflows.
`;

  function modelToYaml(model) {
    const cleaned = pruneEmpty(model);
    // Use flow-style for the contact list entries (reads as one-liners) but
    // block-style for the section arrays. js-yaml's `flowLevel` is the
    // simplest way to control that.
    const body = jsyaml.dump(cleaned, {
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });
    return HEADER_COMMENT + "\n" + body;
  }

  function yamlToModel(text) {
    const parsed = jsyaml.load(text);
    if (parsed == null) return {};
    if (typeof parsed !== "object") {
      throw new Error("YAML root must be a mapping.");
    }
    return parsed;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  EXPORT
  // ──────────────────────────────────────────────────────────────────────
  window.CvForm = {
    mount,
    modelToYaml,
    yamlToModel,
    detectCustomSections,
    detectShape,
    humanizeKey,
    SECTIONS,
    NETWORK_OPTIONS,
    NETWORK_LABEL,
  };
})();
