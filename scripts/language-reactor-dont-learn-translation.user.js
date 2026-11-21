// ==UserScript==
// @name         Language Reactor Don't Learn Translations
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      2.2.0
// @description  Always show dictionary meanings above purple (Don't Learn) words in Language Reactor subtitles.
// @author       nomuonji
// @match        https://www.youtube.com/*
// @match        https://www.netflix.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      api-cdn-plus.dioco.io
// @noframes
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/language-reactor-dont-learn-translation.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/language-reactor-dont-learn-translation.user.js
// ==/UserScript==

/*
 * How it works
 * Language Reactor only opens its hover dictionary for real (isTrusted) mouse
 * events, so simulated hovers never fill the tooltip. Instead, this script calls
 * the same dictionary endpoint Language Reactor uses for its hover popup and
 * draws its own always-visible labels above each Don't Learn word.
 */
(() => {
  'use strict';

  // ---- Settings ----------------------------------------------------------
  const TARGET_LANG = 'ja';                 // Language of the meanings.
  const TARGET_COLOR = [184, 148, 197];     // Don't Learn purple.
  const COLOR_TOLERANCE = 40;
  const MAX_MEANINGS = 3;
  const DICT_URL = 'https://api-cdn-plus.dioco.io/base_dict_getHoverDict_8';

  // ---- Constants ---------------------------------------------------------
  const SUBS_SELECTOR = '#lln-subs';
  const WORD_SELECTOR = '.lln-word';
  const LABEL_CLASS = 'lr-dl-label';
  const STYLE_ID = 'lr-dl-style';

  const RETRY_MS = 30000;
  const cache = new Map(); // "sl|form" -> Promise<string[]>
  const failedAt = new Map(); // "sl|form" -> timestamp of last failure
  let scanScheduled = false;
  let rafId = 0;
  let lastLayoutAt = 0;

  // ---- Dictionary --------------------------------------------------------
  function request(url) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'json',
          timeout: 10000,
          onload: res => {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error('HTTP ' + res.status));
              return;
            }
            try {
              resolve(typeof res.response === 'object' && res.response
                ? res.response
                : JSON.parse(res.responseText));
            } catch (error) { reject(error); }
          },
          onerror: () => reject(new Error('network error')),
          ontimeout: () => reject(new Error('timeout'))
        });
      });
    }
    return fetch(url).then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function lookup(form, sourceLang) {
    const key = sourceLang + '|' + form;
    if (cache.has(key)) return cache.get(key);
    if (Date.now() - (failedAt.get(key) || 0) < RETRY_MS) {
      return Promise.reject(new Error('cooling down'));
    }
    const params = new URLSearchParams({
      form, lemma: '', sl: sourceLang, tl: TARGET_LANG, pos: '', pow: 'n'
    });
    const promise = request(DICT_URL + '?' + params)
      .then(json => {
        const entries = json?.data?.hoverDictEntries;
        if (!Array.isArray(entries)) return [];
        // Drop romanization like "得る (eru)" and duplicates it leaves behind.
        const cleaned = entries
          .map(entry => String(entry).replace(/\s*\([\x20-\x7E]*\)\s*$/, '').trim())
          .filter(Boolean);
        return [...new Set(cleaned)];
      })
      .catch(error => {
        cache.delete(key); // Allow a retry after the cooldown.
        failedAt.set(key, Date.now());
        console.warn('[LR Don\'t Learn] lookup failed:', form, error);
        throw error;
      });
    cache.set(key, promise);
    return promise;
  }

  // ---- Word helpers ------------------------------------------------------
  function isPurple(word) {
    const values = getComputedStyle(word).color.match(/[\d.]+/g);
    if (!values || values.length < 3) return false;
    const distance = Math.hypot(...values.slice(0, 3).map((v, i) => Number(v) - TARGET_COLOR[i]));
    return distance <= COLOR_TOLERANCE;
  }

  function wordText(word) {
    return [...word.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('')
      .trim();
  }

  // data-word-key looks like "WORD|heavier|en".
  function wordInfo(word) {
    const parts = (word.getAttribute('data-word-key') || '').split('|');
    const form = (parts.length >= 3 ? parts[1] : wordText(word)).trim().toLowerCase();
    const sourceLang = parts.length >= 3 && parts[parts.length - 1] ? parts[parts.length - 1] : 'en';
    return form ? { form, sourceLang } : null;
  }

  // ---- Rendering ---------------------------------------------------------
  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${LABEL_CLASS} {
        position: absolute; left: 50%; bottom: calc(100% + 4px);
        transform: translateX(-50%); z-index: 2147483000;
        box-sizing: border-box; pointer-events: none;
        max-width: min(22em, 70vw); padding: 2px 7px; border-radius: 4px;
        background: rgba(20, 20, 24, 0.92); color: #fff;
        border-bottom: 2px solid rgb(184, 148, 197);
        font: 600 clamp(11px, 0.45em, 18px)/1.35 system-ui, sans-serif;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        text-shadow: none; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }


  // Bind annotations to their word spans so CSS transforms apply equally.
  const labels = new Map(); // word -> { label, text }
  function setLabel(word, text) {
    let entry = labels.get(word);
    if (!entry || entry.label.parentElement !== word) {
      entry?.label.remove();
      if (getComputedStyle(word).position === 'static') word.style.position = 'relative';
      const label = document.createElement('span');
      label.className = LABEL_CLASS;
      label.setAttribute('aria-hidden', 'true');
      label.style.visibility = 'hidden';
      word.appendChild(label);
      entry = { label, text: '' };
      labels.set(word, entry);
    }
    if (entry.text !== text) {
      entry.text = text;
      entry.label.textContent = text;
    }
  }

  function removeLabel(word) {
    labels.get(word)?.label.remove();
    labels.delete(word);
  }

  // Read actual glyph bounds, not the subtitle container's bounding box:
  // the container includes empty areas where labels can safely be placed.
  function subtitleTextRects() {
    const rects = [];
    const roots = document.querySelectorAll(
      SUBS_SELECTOR + ', .ytp-caption-window-container, .player-timedtext, .vjs-text-track-display'
    );
    const range = document.createRange();
    for (const root of roots) {
      const style = getComputedStyle(root);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim() || node.parentElement?.closest('.' + LABEL_CLASS)) continue;
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) {
            rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
          }
        }
      }
    }
    range.detach?.();
    return rects;
  }

  function labelBounds(word) {
    const player = word.closest(
      '#movie_player, .html5-video-player, .watch-video--player-view, .nf-player-container'
    );
    const video = player?.querySelector('video') || document.querySelector('video');
    const videoRect = video?.getBoundingClientRect();
    const viewport = {
      left: 0, top: 0, right: document.documentElement.clientWidth,
      bottom: document.documentElement.clientHeight
    };
    if (!videoRect || videoRect.width < 200 || videoRect.height < 100) return viewport;
    const bounds = {
      left: Math.max(viewport.left, videoRect.left),
      top: Math.max(viewport.top, videoRect.top),
      right: Math.min(viewport.right, videoRect.right),
      bottom: Math.min(viewport.bottom, videoRect.bottom)
    };
    return bounds.right > bounds.left && bounds.bottom > bounds.top ? bounds : viewport;
  }

  function intersects(a, b, padding = 0) {
    return a.left < b.right + padding && a.right > b.left - padding &&
      a.top < b.bottom + padding && a.bottom > b.top - padding;
  }


  // Read actual browser geometry; no viewport-to-overlay coordinate conversion.
  function positionLabels(now) {
    rafId = 0;
    if (now - lastLayoutAt < 90) {
      if (labels.size) rafId = requestAnimationFrame(positionLabels);
      return;
    }
    lastLayoutAt = now;
    const protectedRects = subtitleTextRects();
    const placed = [];
    const entries = [...labels.entries()]
      .filter(([word, { label }]) => {
        if (word.isConnected && label.parentElement === word) return true;
        label.remove();
        labels.delete(word);
        return false;
      })
      .sort(([a], [b]) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

    for (const [word, { label }] of entries) {
      label.style.visibility = 'hidden';
      const wordRect = word.getBoundingClientRect();
      if (!wordRect.width || !wordRect.height) continue;
      const bounds = labelBounds(word);
      // Keep the annotation directly above the word. Small horizontal
      // offsets can avoid neighbors, but never send it to another line.
      for (const shift of [0, -12, 12, -24, 24]) {
        label.style.marginLeft = shift + 'px';
        const rect = label.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const gap = wordRect.top - rect.bottom;
        const drift = Math.abs((rect.left + rect.right - wordRect.left - wordRect.right) / 2);
        if (gap < -2 || gap > 16 || drift > 32) continue;
        if (rect.left < bounds.left + 2 || rect.right > bounds.right - 2 ||
            rect.top < bounds.top + 2 || rect.bottom > bounds.bottom - 2) continue;
        if (protectedRects.some(other => intersects(rect, other, 2))) continue;
        if (placed.some(other => intersects(rect, other, 4))) continue;
        placed.push(rect);
        label.style.visibility = 'visible';
        break;
      }
    }
    if (labels.size) rafId = requestAnimationFrame(positionLabels);
  }

  function ensurePositioning() {
    if (!rafId && labels.size) rafId = requestAnimationFrame(positionLabels);
  }

  // ---- Scan --------------------------------------------------------------
  function scan() {
    addStyles();
    const seen = new Set();
    for (const subs of document.querySelectorAll(SUBS_SELECTOR)) {
      for (const word of subs.querySelectorAll(WORD_SELECTOR)) {
        if (!isPurple(word)) continue;
        const info = wordInfo(word);
        if (!info) continue;
        seen.add(word);
        if (!labels.has(word)) setLabel(word, '…');
        lookup(info.form, info.sourceLang).then(
          meanings => {
            if (!word.isConnected || !labels.has(word)) return;
            if (meanings.length) setLabel(word, meanings.slice(0, MAX_MEANINGS).join('・'));
            else removeLabel(word);
          },
          () => { if (labels.has(word)) removeLabel(word); }
        );
      }
    }
    for (const word of [...labels.keys()]) {
      if (!seen.has(word)) removeLabel(word);
    }
    ensurePositioning();
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scan();
    }, 50);
  }


  new MutationObserver(mutations => {
    for (const m of mutations) {
      const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (target?.closest?.('.' + LABEL_CLASS)) continue;
      if (m.type === 'childList') {
        const children = [...m.addedNodes, ...m.removedNodes];
        if (children.length && children.every(node =>
          node.nodeType === Node.ELEMENT_NODE && node.classList.contains(LABEL_CLASS)
        )) continue;
      }
      scheduleScan();
      return;
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'data-word-key']
  });
  scan();
})();
