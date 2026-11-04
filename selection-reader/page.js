// Selection Reader — floating widget on the page.
// Select text and a "Read" button appears next to it; while reading, the same
// widget shows the player (progress, pause, speed, stop) and the word being read
// is highlighted. The background script does the speaking and sends this widget
// state updates and word positions.
(() => {
  // After an extension reload, an old copy can linger with a dead connection;
  // only reuse a copy that can still talk to the extension.
  let reusable = false;
  try {
    reusable = !!window.__readerBar?.alive();
  } catch {
    // A dead copy whose chrome.* accessors throw: replace it.
  }
  if (reusable) return;
  try {
    window.__readerBar?.remove();
  } catch {}

  const ICONS = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
    stop: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>',
  };

  const host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 16px; display: none;';
  // Shadow DOM keeps the page's CSS from restyling the widget.
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      [hidden] { display: none !important; }
      .bar { display: flex; align-items: center; gap: 4px; padding: 4px;
             background: #1d2230; color: #f3f5f9; border: 1px solid rgba(255,255,255,.08);
             border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,.28);
             font: 500 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
             transition: opacity .3s; }
      .bar.idle { opacity: .5; }
      .player { display: flex; align-items: center; gap: 2px; }
      .label { padding: 0 10px 0 10px; min-width: 92px; color: #c9cfdb;
               font-variant-numeric: tabular-nums; white-space: nowrap; }
      button { all: unset; box-sizing: border-box; cursor: pointer; height: 30px; min-width: 30px;
               display: inline-flex; align-items: center; justify-content: center; gap: 6px;
               padding: 0 10px; border-radius: 999px; color: inherit; font: inherit; white-space: nowrap; }
      button:hover { background: rgba(255,255,255,.1); }
      button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
      button svg { width: 14px; height: 14px; fill: currentColor; }
      .icon { padding: 0; }
      .read { background: #2f6fde; color: #fff; padding: 0 14px 0 12px; }
      .read:hover { background: #3b7cf0; }
      .speed { min-width: 64px; color: #c9cfdb; }
    </style>
    <div class="bar" role="toolbar" aria-label="Selection Reader">
      <button class="read" title="Read the selection aloud">${ICONS.play}Read</button>
      <span class="player">
        <span class="label" aria-live="polite"></span>
        <button class="toggle icon"></button>
        <button class="speed" title="Change speed"></button>
        <button class="stop icon" title="Stop" aria-label="Stop">${ICONS.stop}</button>
      </span>
    </div>`;
  const bar = root.querySelector('.bar');
  const readButton = root.querySelector('.read');
  const player = root.querySelector('.player');
  const label = root.querySelector('.label');
  const toggle = root.querySelector('.toggle');
  const speed = root.querySelector('.speed');

  // What the widget shows: a selection to read, and/or the reading in progress
  // ({ paused, index, total, rate, speed, status, highlight } from the background script).
  let hasSelection = false;
  let reading = null;
  let placed = false; // has the widget been given a position yet?
  let shown = false; // was the widget on screen at the last update?

  // After the extension is reloaded or removed, this copy's connection is gone and
  // sending throws "Extension context invalidated". Drop the widget instead of leaving
  // a button that only produces errors (the next action injects a fresh copy).
  let dead = false;
  function retire() {
    if (dead) return;
    dead = true;
    window.__readerBar = null;
    host.remove();
    clearHighlights();
  }

  const send = (action, extra) => {
    if (dead) return Promise.resolve();
    try {
      return chrome.runtime.sendMessage({ type: 'reader-control', action, ...extra }).catch((err) => {
        if (/Extension context invalidated/.test(err?.message ?? '')) retire();
      });
    } catch (err) {
      // sendMessage throws synchronously when the context is already invalid.
      if (/Extension context invalidated/.test(err?.message ?? '')) retire();
      return Promise.resolve();
    }
  };

  // Keep the page's selection when a widget button is pressed.
  root.addEventListener('mousedown', (e) => e.preventDefault());
  function readSelection() {
    send('read', { text: collect() });
    hasSelection = false; // the player takes over until something new is selected
    update();
  }
  readButton.addEventListener('click', readSelection);
  toggle.addEventListener('click', () => send('toggle'));
  speed.addEventListener('click', () => send('speed'));
  root.querySelector('.stop').addEventListener('click', () => send('stop'));

  const selectedText = () => window.getSelection().toString().trim();

  function update() {
    readButton.hidden = !hasSelection;
    player.hidden = !reading;
    if (reading) {
      label.textContent =
        reading.status || `${reading.paused ? 'Paused' : 'Reading'} ${reading.index} / ${reading.total}`;
      toggle.innerHTML = reading.paused ? ICONS.play : ICONS.pause;
      toggle.title = reading.paused ? 'Resume' : 'Pause';
      toggle.setAttribute('aria-label', toggle.title);
      speed.textContent = reading.speed;
    }
    const visible = hasSelection || !!reading;
    if (visible && !host.isConnected) document.documentElement.append(host);
    host.style.display = visible ? 'block' : 'none';
    if (visible && !shown) wake();
    shown = visible;
    // Started without a selection on screen (e.g. by shortcut): use the top centre.
    if (visible && !placed) {
      host.style.left = `${Math.max(8, (innerWidth - host.offsetWidth) / 2)}px`;
      placed = true;
    }
    if (visible) keepInView(); // the player is wider than the Read button
    if (!reading?.highlight) clearHighlights();
  }

  function keepInView() {
    const { left, width } = host.getBoundingClientRect();
    host.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
  }
  window.addEventListener('resize', keepInView);

  // Put the widget just below the selection (or above it near the bottom of the window).
  function placeAtSelection() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const { offsetWidth: w, offsetHeight: h } = host;
    let top = rect.bottom + 8;
    if (top + h > innerHeight - 8) top = rect.top - h - 8;
    top = Math.max(8, Math.min(top, innerHeight - h - 8));
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8));
    host.style.top = `${top}px`;
    host.style.left = `${left}px`;
    placed = true;
  }

  // ── Words and highlighting ──────────────────────────────
  // collect() turns the selection into the text to read and remembers where each
  // of its words is on the page: word i of the text is words[i]. Words are joined
  // by spaces, with a line break between blocks (paragraphs, headings, list items)
  // so a heading without a full stop still ends its own sentence.
  let words = null; // [{ startNode, startOffset, endNode, endOffset }]

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA']);
  const blockCache = new WeakMap();
  function blockOf(el) {
    if (!blockCache.has(el)) {
      const display = getComputedStyle(el).display;
      const inline = display.startsWith('inline') || display === 'contents';
      blockCache.set(el, inline && el.parentElement ? blockOf(el.parentElement) : el);
    }
    return blockCache.get(el);
  }

  function collect() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return '';
    const range = sel.getRangeAt(0);
    const top = range.commonAncestorContainer;
    const walker = document.createTreeWalker(top.nodeType === Node.TEXT_NODE ? top.parentNode : top, NodeFilter.SHOW_TEXT);
    const found = [];
    let text = '';
    let open = null; // the last word, if it ran to the end of its text node (may continue in the next)
    let lastBlock = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!range.intersectsNode(node) || !parent || SKIP.has(parent.tagName) || parent.checkVisibility?.() === false) {
        continue;
      }
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.data.length;
      const block = blockOf(parent);
      let last = null;
      for (const m of node.data.slice(from, to).matchAll(/\S+/g)) {
        const start = from + m.index;
        const end = start + m[0].length;
        if (open && start === from && block === lastBlock) {
          // No space between this text node and the last one: same word (e.g. "<b>Bo</b>ld").
          Object.assign(open, { endNode: node, endOffset: end });
          text += m[0];
        } else {
          if (found.length) text += block === lastBlock ? ' ' : '\n';
          found.push({ startNode: node, startOffset: start, endNode: node, endOffset: end });
          text += m[0];
        }
        open = null;
        last = { word: found.at(-1), end };
        lastBlock = block;
      }
      open = last && last.end === to ? last.word : null;
    }
    words = found.length ? found : null;
    return words ? text : sel.toString();
  }

  const toRange = (w) => {
    const r = document.createRange();
    r.setStart(w.startNode, w.startOffset);
    r.setEnd(w.endNode, w.endOffset);
    return r;
  };

  // CSS Custom Highlights colour text without changing the page's HTML.
  const canHighlight = 'highlights' in CSS;
  const highlightStyle = document.createElement('style');
  highlightStyle.textContent = `
    ::highlight(selection-reader-text) { background-color: rgba(255, 213, 74, 0.28); }
    ::highlight(selection-reader-word) { background-color: #ffd54a; color: #111; }`;

  function startHighlighting() {
    if (!canHighlight || !words) return;
    if (!highlightStyle.isConnected) (document.head ?? document.documentElement).append(highlightStyle);
    const passage = document.createRange();
    passage.setStart(words[0].startNode, words[0].startOffset);
    passage.setEnd(words.at(-1).endNode, words.at(-1).endOffset);
    CSS.highlights.set('selection-reader-text', new Highlight(passage));
    window.getSelection().removeAllRanges(); // the selection colour would hide the highlights
  }

  function highlightWord(i) {
    const w = words?.[i];
    if (!canHighlight || !w) return;
    const range = toRange(w);
    CSS.highlights.set('selection-reader-word', new Highlight(range));
    followWord(range);
  }

  function clearHighlights() {
    if (!canHighlight) return;
    CSS.highlights.delete('selection-reader-text');
    CSS.highlights.delete('selection-reader-word');
  }

  // Scroll so the word being read stays in view, unless the reader just scrolled.
  let userScrolledAt = 0;
  for (const type of ['wheel', 'touchmove', 'keydown']) {
    window.addEventListener(type, () => (userScrolledAt = Date.now()), { passive: true, capture: true });
  }
  function followWord(range) {
    if (Date.now() - userScrolledAt < 4000) return;
    const rect = range.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= innerHeight - 60) return;
    window.scrollBy({ top: rect.top - innerHeight * 0.35, behavior: 'smooth' });
  }

  // ── Fading when idle ────────────────────────────────────
  // After 5 s without being pointed at or used, the widget fades to half opacity so it
  // hides less of the page. Pointing at it (or tabbing into it) brings it back at once,
  // and so does a new selection or reading.
  const IDLE_MS = 5000;
  let idleTimer = null;
  let hovered = false;
  let focused = false;
  function wake() {
    bar.classList.remove('idle');
    clearTimeout(idleTimer);
    if (!hovered && !focused) idleTimer = setTimeout(() => bar.classList.add('idle'), IDLE_MS);
  }
  bar.addEventListener('pointerenter', () => { hovered = true; wake(); });
  bar.addEventListener('pointerleave', () => { hovered = false; wake(); });
  bar.addEventListener('focusin', () => { focused = true; wake(); });
  bar.addEventListener('focusout', () => { focused = false; wake(); });

  // ── Sites ───────────────────────────────────────────────
  // The Read button can be limited to sites the user picks in the popup (buttonSites:
  // 'all' or 'only', with buttonSiteList, e.g. ["skilljar.com"]). A site includes its
  // subdomains, and is the address in the tab's address bar, also for text in an iframe
  // (like an e-learning lesson). The shortcut and the context menu read on every site.
  let buttonHere = true;
  function siteOfTab() {
    const top = location.ancestorOrigins?.[location.ancestorOrigins.length - 1] ?? location.href;
    try {
      return new URL(top).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  }
  function applySites({ buttonSites = 'all', buttonSiteList = [] }) {
    const site = siteOfTab();
    buttonHere = buttonSites !== 'only' || buttonSiteList.some((d) => site === d || site.endsWith(`.${d}`));
    if (!buttonHere && hasSelection) {
      hasSelection = false;
      update();
    }
  }
  const loadSites = () => chrome.storage.sync.get(['buttonSites', 'buttonSiteList']).then(applySites);
  try {
    loadSites().catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes.buttonSites || changes.buttonSiteList)) loadSites().catch(() => {});
    });
  } catch {
    // This copy was left over from an extension instance that has since been reloaded.
  }

  // ── Events ──────────────────────────────────────────────

  // Show the Read button once a selection is finished (mouse released or keys let go).
  function onSelectEnd(e) {
    if (e.target === host) return; // clicks inside the widget
    setTimeout(() => {
      hasSelection = buttonHere && !!selectedText();
      update();
      if (hasSelection) {
        placeAtSelection();
        wake(); // a new selection: show the Read button in full
        send('prepare').catch(() => {}); // lets a local voice model start loading
      }
    });
  }
  // Capture phase on the window, so pages that stop these events reaching the
  // document (common in e-learning players) don't hide the selection from us.
  window.addEventListener('mouseup', onSelectEnd, true);
  window.addEventListener('keyup', onSelectEnd, true);
  document.addEventListener('selectionchange', () => {
    if (hasSelection && !selectedText()) {
      hasSelection = false;
      update();
    }
  });
  // Follow the selection when the page (or a scrolling panel in it) scrolls.
  window.addEventListener('scroll', () => hasSelection && placeAtSelection(), {
    capture: true,
    passive: true,
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // The shortcut and the context menu: the frame (page or iframe) holding the
    // selection reads it, as if its Read button was pressed; the others stay quiet.
    if (msg.type === 'reader-read-selection') {
      if (!selectedText()) return;
      readSelection();
      sendResponse(true);
      return;
    }
    if (msg.type === 'reader-word') return highlightWord(msg.index);
    if (msg.type !== 'reader-state') return;
    // A new reading always arrives as null (the old one stopping) and then its first
    // state, after collect() has stored its words.
    const starting = !reading && msg.state;
    reading = msg.state;
    if (starting && reading.highlight) startHighlighting();
    if (starting) wake();
    update();
  });

  // If this tab is already being read (e.g. the page was reloaded), show the player.
  try {
    chrome.runtime
      .sendMessage({ type: 'reader-get-state' })
      .then((state) => {
        reading = state;
        update();
      })
      .catch(() => {});
  } catch {
    // This copy was left over from an extension instance that has since been reloaded.
  }

  window.__readerBar = {
    alive: () => !dead && !!chrome.runtime?.id,
    remove: () => {
      host.remove();
      clearHighlights();
    },
  };
})();
