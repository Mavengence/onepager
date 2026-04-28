/* Inline Lucide-style icon registry for the CV editor.
   Each entry is the inner SVG markup (no <svg> wrapper); the wrapper is
   applied uniformly by `i()`. Pruned to the icons this editor uses. */
(function () {
  "use strict";

  const ICONS = {
    "panel-left-open":
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
    "panel-left-close":
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
    "list-tree":
      '<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>',
    "file-text":
      '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
    "save":
      '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    "refresh-cw":
      '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    "sun":
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    "moon":
      '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    "monitor":
      '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    "scroll-text":
      '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
    "book-open-text":
      '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/><path d="M6 8h2"/><path d="M6 12h2"/><path d="M16 8h2"/><path d="M16 12h2"/>',
    "files":
      '<path d="M15.5 2H8.6c-.4 0-.8.2-1.1.5-.3.3-.5.7-.5 1.1V14c0 .4.2.8.5 1.1.3.3.7.5 1.1.5h9.8c.4 0 .8-.2 1.1-.5.3-.3.5-.7.5-1.1V6.5L15.5 2z"/><path d="M3 7.6v12.8c0 .9.7 1.6 1.6 1.6h12.8"/><path d="M15 2v5h5"/>',
    "minus": '<path d="M5 12h14"/>',
    "plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
    "maximize-2":
      '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
    "loader":
      '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
    "check": '<polyline points="20 6 9 17 4 12"/>',
    "circle-filled":
      '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
    "triangle-alert":
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    "corner-down-left":
      '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
    "upload":
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    "x-close":
      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    "arrow-right":
      '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    "wand":
      '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>',
    "layout":
      '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
    "code":
      '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    "trash":
      '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    "chevron-up":
      '<polyline points="18 15 12 9 6 15"/>',
    "chevron-down":
      '<polyline points="6 9 12 15 18 9"/>',
    "plus-circle":
      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    "user":
      '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    "briefcase":
      '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    "graduation-cap":
      '<path d="M22 10v6"/><path d="M2 10l10-5 10 5-10 5-10-5z"/><path d="M6 12v5c0 2 3 3 6 3s6-1 6-3v-5"/>',
    "wrench":
      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    "lightbulb":
      '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M2 12c0-3.5 2.5-6 6-6 1 0 1.5.5 2 1 .5-.5 1-1 2-1 3.5 0 6 2.5 6 6 0 1.5-.5 3-1.5 4l-1 1c-.5.5-1 1.5-1 2H7c0-.5-.5-1.5-1-2l-1-1c-1-1-1.5-2.5-1.5-4z"/>',
    "trophy":
      '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    "more":
      '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    "sparkles":
      '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="M5.6 18.4 7.7 16.3"/><path d="m16.3 7.7 2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
    "zap":
      '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    "pause":
      '<rect x="6" y="4" width="4" height="16" rx="0.6"/><rect x="14" y="4" width="4" height="16" rx="0.6"/>',
    "palette":
      '<circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" stroke="none"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  };

  const SVG_NS = "http://www.w3.org/2000/svg";

  function i(name, opts) {
    const inner = ICONS[name];
    if (!inner) return "";
    const size = (opts && opts.size) || 16;
    const stroke = (opts && opts.stroke) || 1.6;
    return (
      `<svg xmlns="${SVG_NS}" class="lucide" width="${size}" height="${size}" ` +
      `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
    );
  }

  // Brand glyph — a tiny abstract CV: an accent-coloured page with a bold
  // header rule and four body lines. The shape echoes the rendered output
  // (one A4 page, dense top, looser tail) and the colour comes from the
  // ``--accent`` CSS variable (so it tracks whatever theme the user picks).
  const BRAND_GLYPH = (`
    <svg xmlns="${SVG_NS}" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.6" fill="currentColor"/>
      <rect x="7.2" y="6.4" width="9.6" height="1.9" rx="0.95" fill="#fff"/>
      <rect x="7.2" y="10.7" width="6.5" height="1.0" rx="0.5" fill="#fff" opacity="0.62"/>
      <rect x="7.2" y="13.1" width="9.0" height="1.0" rx="0.5" fill="#fff" opacity="0.62"/>
      <rect x="7.2" y="15.5" width="7.5" height="1.0" rx="0.5" fill="#fff" opacity="0.62"/>
      <rect x="7.2" y="17.9" width="5.0" height="1.0" rx="0.5" fill="#fff" opacity="0.62"/>
    </svg>`).trim();

  function renderIcons(root) {
    root = root || document;
    root.querySelectorAll("[data-icon]").forEach((el) => {
      const name = el.dataset.icon;
      if (name === "brand") {
        el.innerHTML = BRAND_GLYPH;
        return;
      }
      const size = el.dataset.iconSize ? parseFloat(el.dataset.iconSize) : 16;
      const stroke = el.dataset.iconStroke ? parseFloat(el.dataset.iconStroke) : 1.6;
      el.innerHTML = i(name, { size, stroke });
    });
  }

  window.renderIcons = renderIcons;
  window.ICONS = ICONS;
})();
