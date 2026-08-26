/**
 * BinaryArts — Linux ASCII Art Database Engine
 * Fast, lightweight, pure Vanilla JS markdown parser & collection browser.
 */

(function () {
  'use strict';

  // ── BinaryFetch Color Mappings ($1–$15) ──────────────────────────────────
  const BINARYFETCH_COLORS = {
    1:  'bf-color-1',   // Red
    2:  'bf-color-2',   // Green
    3:  'bf-color-3',   // Yellow
    4:  'bf-color-4',   // Blue
    5:  'bf-color-5',   // Magenta
    6:  'bf-color-6',   // Cyan
    7:  'bf-color-7',   // White
    8:  'bf-color-8',   // Bright Red
    9:  'bf-color-9',   // Bright Green
    10: 'bf-color-10',  // Bright Yellow
    11: 'bf-color-11',  // Bright Blue
    12: 'bf-color-12',  // Bright Magenta
    13: 'bf-color-13',  // Bright Cyan
    14: 'bf-color-14',  // Bright White
    15: 'bf-color-15'   // Reset
  };

  // Regex correctly matches $1–$15 (no $10 mistaken as $1 + '0')
  const CP_TAG_REGEX = /\$(15|1[0-4]|[1-9])/g;

  // ── Global State ─────────────────────────────────────────────────────────
  let asciiDatabase   = [];
  let activeGlobalMode = 'normal';   // 'normal' | 'cp' | 'raw'
  let currentSearchQuery = '';
  let cardModeMap     = new Map();   // id -> mode
  let cardIndexMap    = new Map();   // id -> 1-based display index
  let searchDebounce;
  let flashTimeout;

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const elStatCount     = document.getElementById('stat-count');
  const elSearchInput   = document.getElementById('search-input');
  const elSearchClear   = document.getElementById('search-clear');
  const elKbdHint       = document.getElementById('kbd-hint');
  const elAsciiList     = document.getElementById('ascii-list');
  const elLoadingState  = document.getElementById('loading-state');
  const elErrorState    = document.getElementById('error-state');
  const elEmptyState    = document.getElementById('empty-state');
  const elEmptyQuery    = document.getElementById('empty-query');
  const elBtnReset      = document.getElementById('btn-reset-search');
  const elSearchFlash   = document.getElementById('search-flash');
  const elLogoCursor    = document.getElementById('logo-cursor');
  const elLogoTypewriter = document.getElementById('logo-typewriter');
  const btnGlobalNormal = document.getElementById('btn-global-normal');
  const btnGlobalCp     = document.getElementById('btn-global-cp');
  const btnGlobalRaw    = document.getElementById('btn-global-raw');

  // ── Bootstrap ────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    runTypewriter('BinaryArts', elLogoTypewriter, elLogoCursor, 55, () => {
      loadDatabases();
    });
  });

  // ── Typewriter Animation ─────────────────────────────────────────────────
  function runTypewriter(text, targetEl, cursorEl, speed, onDone) {
    // Respect reduced motion: skip animation
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targetEl.textContent = text;
      if (cursorEl) cursorEl.classList.add('hidden');
      if (onDone) onDone();
      return;
    }

    let i = 0;
    targetEl.textContent = '';

    const tick = () => {
      if (i < text.length) {
        targetEl.textContent += text[i++];
        setTimeout(tick, speed);
      } else {
        // Blink cursor briefly then hide it
        setTimeout(() => {
          if (cursorEl) cursorEl.classList.add('hidden');
          if (onDone) onDone();
        }, 600);
      }
    };

    tick();
  }

  // ── Data Loading ─────────────────────────────────────────────────────────
  async function loadDatabases() {
    showState('loading');

    let normalRes, cpRes;
    try {
      [normalRes, cpRes] = await Promise.all([
        fetch('data/AsciiArts.md'),
        fetch('data/AsciiArts_CP.md')
      ]);
    } catch (err) {
      console.error('BinaryArts: Network fetch failed.', err);
      showState('error');
      return;
    }

    if (!normalRes.ok || !cpRes.ok) {
      console.error('BinaryArts: Bad HTTP response — are you running a local server?');
      showState('error');
      return;
    }

    const [normalText, cpText] = await Promise.all([
      normalRes.text(),
      cpRes.text()
    ]);

    const normalEntries = parseMarkdown(normalText);
    const cpEntries     = parseMarkdown(cpText);

    validateSync(normalEntries, cpEntries);

    // Build unified database
    asciiDatabase = [];
    cardModeMap.clear();
    cardIndexMap.clear();
    let idx = 0;

    normalEntries.forEach((entry, id) => {
      const cpEntry = cpEntries.get(id);
      idx++;
      const item = {
        id,
        index: idx,
        name: formatName(entry.rawTitle),
        rawTitle: entry.rawTitle,
        normalArt: entry.art,
        colorArt: cpEntry ? cpEntry.art : entry.art
      };
      asciiDatabase.push(item);
      cardModeMap.set(id, activeGlobalMode);
      cardIndexMap.set(id, idx);
    });

    elStatCount.textContent = `${asciiDatabase.length} logos`;
    elStatCount.hidden = false;

    // Check URL hash deep-link
    const hash = window.location.hash.slice(1).trim().toLowerCase();
    if (hash) {
      const match = asciiDatabase.find(a => a.id === hash || a.name.toLowerCase() === hash);
      if (match) {
        elSearchInput.value = match.name;
        currentSearchQuery = match.name.toLowerCase();
        updateClearButton();
      }
    }

    showState('content');
    renderCollection();
  }

  // ── Markdown Parser ───────────────────────────────────────────────────────
  function parseMarkdown(text) {
    const map = new Map();
    const regex = /^##\s+(?:(?:\d+\.\s*)?([^\n\r]+))[\s\S]*?```(?:text)?\r?\n([\s\S]*?)```/gm;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const rawTitle = m[1].trim();
      const art = m[2];
      const id = rawTitle.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      map.set(id, { id, rawTitle, art });
    }
    return map;
  }

  function formatName(rawTitle) {
    let clean = rawTitle.replace(/^\d+\.\s*/, '').trim();
    return clean.split(/[-_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // ── Database Validation ───────────────────────────────────────────────────
  function validateSync(normalMap, cpMap) {
    let missingCp = 0, missingNormal = 0, orderMismatch = 0;
    normalMap.forEach((_, id) => { if (!cpMap.has(id)) missingCp++; });
    cpMap.forEach((_, id)     => { if (!normalMap.has(id)) missingNormal++; });

    const nk = Array.from(normalMap.keys());
    const ck = Array.from(cpMap.keys());
    for (let i = 0; i < Math.min(nk.length, ck.length); i++) {
      if (nk[i] !== ck[i]) orderMismatch++;
    }

    const ok = missingCp === 0 && missingNormal === 0 && orderMismatch === 0;
    console.log(
      '%cBinaryArts DB Validation\n%c' +
      `Normal: ${normalMap.size}  CP: ${cpMap.size}\n` +
      `Missing normal: ${missingNormal}  Missing CP: ${missingCp}\n` +
      `Order mismatch: ${orderMismatch}\n` +
      `%c${ok ? '✓ Synchronized' : '⚠ Issues found'}`,
      'font-weight:700;font-size:13px;color:#ff6b35;',
      'font-size:11px;color:#7a8299;',
      ok ? 'font-weight:700;color:#4caf50;' : 'font-weight:700;color:#ff3d5a;'
    );
  }

  // ── HTML Escaper ──────────────────────────────────────────────────────────
  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── CP Color Renderer ─────────────────────────────────────────────────────
  function renderCPArt(cpString) {
    CP_TAG_REGEX.lastIndex = 0;
    let html = '', lastIndex = 0, activeClass = null, m;

    while ((m = CP_TAG_REGEX.exec(cpString)) !== null) {
      const seg = cpString.substring(lastIndex, m.index);
      if (seg.length > 0) {
        const esc = escapeHTML(seg);
        html += activeClass ? `<span class="${activeClass}">${esc}</span>` : esc;
      }
      const num = parseInt(m[1], 10);
      activeClass = num === 15 ? null : (BINARYFETCH_COLORS[num] || null);
      lastIndex = CP_TAG_REGEX.lastIndex;
    }

    if (lastIndex < cpString.length) {
      const esc = escapeHTML(cpString.substring(lastIndex));
      html += activeClass ? `<span class="${activeClass}">${esc}</span>` : esc;
    }

    return html;
  }

  // ── Render Collection ─────────────────────────────────────────────────────
  function renderCollection() {
    const query = currentSearchQuery.trim().toLowerCase();

    const filtered = asciiDatabase.filter(item =>
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.id.toLowerCase().includes(query) ||
      item.rawTitle.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      elEmptyQuery.textContent = currentSearchQuery;
      showState('empty');
      elAsciiList.innerHTML = '';
      return;
    }

    showState('content');

    const frag = document.createDocumentFragment();
    filtered.forEach(item => {
      const mode = cardModeMap.get(item.id) || activeGlobalMode;
      frag.appendChild(buildCard(item, mode));
    });

    elAsciiList.innerHTML = '';
    elAsciiList.appendChild(frag);
  }

  // ── Art Char Count Helper ─────────────────────────────────────────────────
  function getArtCharCount(art) {
    // Strip color tags, count all remaining characters (including spaces/newlines)
    const plain = art.replace(/\$(15|1[0-4]|[1-9])/g, '');
    // Count non-newline characters only (visible + spaces)
    return plain.replace(/\n/g, '').length;
  }

  // ── Build Card DOM ────────────────────────────────────────────────────────
  function buildCard(item, mode) {
    const card = document.createElement('article');
    card.className = 'art-card';
    card.id = `art-${item.id}`;
    card.setAttribute('role', 'listitem');

    // ─ Terminal Titlebar ─
    const titlebar = document.createElement('div');
    titlebar.className = 'terminal-titlebar';

    // LEFT: index + name + id badge
    const leftDiv = document.createElement('div');
    leftDiv.className = 'titlebar-left';

    const indexSpan = document.createElement('span');
    indexSpan.className = 'titlebar-index';
    indexSpan.textContent = item.index + '.';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'titlebar-name';
    nameSpan.textContent = item.name;

    const idBadge = document.createElement('span');
    idBadge.className = 'titlebar-id-badge';
    idBadge.textContent = item.id;

    leftDiv.appendChild(indexSpan);
    leftDiv.appendChild(nameSpan);
    leftDiv.appendChild(idBadge);

    // RIGHT: controls (Copy + mode seg)
    const controls = document.createElement('div');
    controls.className = 'titlebar-controls';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-tb-copy';
    copyBtn.setAttribute('aria-label', `Copy ${item.name} ASCII art`);
    copyBtn.innerHTML = `&#128203; Copy`;
    copyBtn.addEventListener('click', () => handleCopy(item, cardModeMap.get(item.id) || mode, copyBtn));

    // Mode button seg group
    const modeGroup = document.createElement('div');
    modeGroup.className = 'card-mode-group';
    modeGroup.setAttribute('role', 'group');
    modeGroup.setAttribute('aria-label', 'Display mode');

    const modeOptions = [
      { key: 'normal', label: 'Normal' },
      { key: 'cp',     label: 'Color Profile' },
      { key: 'raw',    label: 'RAW' }
    ];

    modeOptions.forEach(({ key, label }) => {
      const btn = document.createElement('button');
      btn.className = `card-mode-btn mode-${key}${key === mode ? ' active' : ''}`;
      btn.textContent = label;
      btn.setAttribute('aria-pressed', key === mode ? 'true' : 'false');
      btn.addEventListener('click', () => {
        cardModeMap.set(item.id, key);
        updateCardDisplay(card, item, key);
      });
      modeGroup.appendChild(btn);
    });

    controls.appendChild(copyBtn);
    controls.appendChild(modeGroup);

    titlebar.appendChild(leftDiv);
    titlebar.appendChild(controls);

    // ─ ASCII Body ─
    const body = document.createElement('div');
    body.className = 'ascii-body';

    const pre = document.createElement('pre');
    pre.className = 'ascii-art' + (mode === 'raw' ? ' raw-mode' : '');
    setPreContent(pre, item, mode);

    body.appendChild(pre);

    // ─ Card Footer — total char count ─
    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const totalChars = getArtCharCount(item.normalArt);
    const formatted = totalChars.toLocaleString();

    footer.innerHTML = `
      <div class="footer-status">
        <span class="footer-status-dot" aria-hidden="true"></span>
        <span>rendering complete</span>
      </div>
      <span class="footer-char-count">${formatted} chars</span>
    `;

    card.appendChild(titlebar);
    card.appendChild(body);
    card.appendChild(footer);

    return card;
  }


  // ── Set pre content safely ────────────────────────────────────────────────
  function setPreContent(pre, item, mode) {
    if (mode === 'cp') {
      pre.innerHTML = renderCPArt(item.colorArt);
    } else {
      pre.textContent = mode === 'raw' ? item.colorArt : item.normalArt;
    }
  }

  // ── Update card on mode change (with fade animation) ──────────────────────
  function updateCardDisplay(cardEl, item, newMode) {
    const pre = cardEl.querySelector('.ascii-art');
    const body = cardEl.querySelector('.ascii-body');
    const modeBtns = cardEl.querySelectorAll('.card-mode-btn');

    // Update active state on mode buttons
    modeBtns.forEach(btn => {
      const isActive = btn.classList.contains(`mode-${newMode}`);
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    // Fade out → swap content → fade in
    body.classList.add('mode-switching');
    setTimeout(() => {
      pre.className = 'ascii-art' + (newMode === 'raw' ? ' raw-mode' : '');
      setPreContent(pre, item, newMode);
      body.classList.remove('mode-switching');
    }, 130);
  }

  // ── Copy Handler ──────────────────────────────────────────────────────────
  async function handleCopy(item, currentMode, copyBtn) {
    const text = (currentMode === 'cp' || currentMode === 'raw')
      ? item.colorArt
      : item.normalArt;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }

      // Visual feedback on Copy button
      const origHTML = copyBtn.innerHTML;
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Copied ✓
      `;
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = origHTML;
      }, 1500);
    } catch (err) {
      console.error('BinaryArts: Copy failed', err);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-99999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }

  // ── Search Flash ──────────────────────────────────────────────────────────
  function triggerSearchFlash() {
    if (!elSearchFlash) return;
    elSearchFlash.classList.remove('flash');
    // Force reflow to restart animation
    void elSearchFlash.offsetWidth;
    elSearchFlash.classList.add('flash');
    clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => elSearchFlash.classList.remove('flash'), 500);
  }

  // ── Event Listeners ───────────────────────────────────────────────────────
  function setupEventListeners() {
    // Search typing
    elSearchInput.addEventListener('input', e => {
      currentSearchQuery = e.target.value;
      updateClearButton();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        triggerSearchFlash();
        renderCollection();
      }, 90);
    });

    // Clear button
    elSearchClear.addEventListener('click', () => {
      elSearchInput.value = '';
      currentSearchQuery = '';
      updateClearButton();
      renderCollection();
      elSearchInput.focus();
    });

    // Empty-state reset
    elBtnReset.addEventListener('click', () => {
      elSearchInput.value = '';
      currentSearchQuery = '';
      updateClearButton();
      renderCollection();
    });

    // Keyboard shortcuts: / or Ctrl+K → focus search, Esc → clear
    window.addEventListener('keydown', e => {
      const inSearch = document.activeElement === elSearchInput;
      if ((e.key === '/' && !inSearch) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        elSearchInput.focus();
        elSearchInput.select();
      } else if (e.key === 'Escape' && inSearch) {
        elSearchInput.value = '';
        currentSearchQuery = '';
        updateClearButton();
        renderCollection();
        elSearchInput.blur();
      }
    });

    // Global mode buttons
    btnGlobalNormal.addEventListener('click', () => setGlobalMode('normal'));
    btnGlobalCp.addEventListener('click',     () => setGlobalMode('cp'));
    btnGlobalRaw.addEventListener('click',    () => setGlobalMode('raw'));
  }

  function updateClearButton() {
    const hasValue = elSearchInput.value.length > 0;
    elSearchClear.hidden = !hasValue;
    elKbdHint.hidden = hasValue;
  }

  function setGlobalMode(newMode) {
    activeGlobalMode = newMode;

    // Update global toggle button active state
    [btnGlobalNormal, btnGlobalCp, btnGlobalRaw].forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === newMode);
    });

    // Update every visible card IN-PLACE — no DOM rebuild, instant response
    const visibleCards = elAsciiList.querySelectorAll('.art-card');
    visibleCards.forEach(cardEl => {
      const id = cardEl.id.replace('art-', '');
      const item = asciiDatabase.find(a => a.id === id);
      if (!item) return;
      cardModeMap.set(id, newMode);
      updateCardDisplay(cardEl, item, newMode);
    });

    // Also sync items that aren't currently rendered (hidden by search)
    asciiDatabase.forEach(item => {
      if (!document.getElementById('art-' + item.id)) {
        cardModeMap.set(item.id, newMode);
      }
    });
  }

  // ── State Manager ─────────────────────────────────────────────────────────
  function showState(state) {
    elLoadingState.hidden = state !== 'loading';
    elErrorState.hidden   = state !== 'error';
    elEmptyState.hidden   = state !== 'empty';
    elAsciiList.hidden    = state !== 'content';
  }

})();
