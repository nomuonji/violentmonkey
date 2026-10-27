// ==UserScript==
// @name         Language Reactor Don't Learn Translations
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      2.0.0
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
  const LAYER_CLASS = 'lr-dl-layer';
  const LABEL_CLASS = 'lr-dl-label';
  const STYLE_ID = 'lr-dl-style';

  const RETRY_MS = 30000;
  const cache = new Map(); // "sl|form" -> Promise<string[]>
  const failedAt = new Map(); // "sl|form" -> timestamp of last failure
  let scanScheduled = false;
  let rafId = 0;

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
      .${LAYER_CLASS} {
        position: absolute; left: 0; top: 0; width: 0; height: 0;
        overflow: visible; pointer-events: none; z-index: 2147483000;
      }
      .${LABEL_CLASS} {
        position: absolute; transform: translateX(-50%);
        max-width: 22em; padding: 2px 7px; border-radius: 4px;
        background: rgba(20, 20, 24, 0.92); color: #fff;
        border-bottom: 2px solid rgb(184, 148, 197);
        font: 600 clamp(11px, 0.45em, 18px)/1.35 system-ui, sans-serif;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        text-shadow: none; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getLayer(subs) {
    const host = subs.parentElement;
    if (!host) return null;
    let layer = host.querySelector(':scope > .' + LAYER_CLASS);
    if (!layer) {
      layer = document.createElement('div');
      layer.className = LAYER_CLASS;
      host.appendChild(layer);
    }
    return layer;
  }

  // Each label is bound to one word element; LR replaces word nodes when the
  // subtitle line changes, which drops their labels automatically.
  const labels = new Map(); // word element -> { label, text }

  function setLabel(word, layer, text) {
    let entry = labels.get(word);
    if (!entry || entry.label.parentElement !== layer) {
      entry?.label.remove();
      const label = document.createElement('div');
      label.className = LABEL_CLASS;
      layer.appendChild(label);
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

  function positionLabels() {
    rafId = 0;
    const placed = [];
    const entries = [...labels.entries()]
      .filter(([word, { label }]) => {
        if (word.isConnected && label.isConnected) return true;
        label.remove();
        labels.delete(word);
        return false;
      })
      .map(([word, { label }]) => ({ word, label, rect: word.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    for (const { label, rect } of entries) {
      const layerRect = label.parentElement.getBoundingClientRect();
      if (!rect.width) {
        label.style.display = 'none';
        continue;
      }
      label.style.display = '';
      const width = label.offsetWidth;
      const height = label.offsetHeight;
      const centerX = rect.left + rect.width / 2;
      let top = rect.top - height - 2;
      // Lift labels that would overlap a label already placed on this line.
      for (let moved = true; moved;) {
        moved = false;
        for (const other of placed) {
          const overlapX = Math.abs(other.centerX - centerX) < (other.width + width) / 2 + 4;
          const overlapY = top < other.top + other.height && top + height > other.top;
          if (overlapX && overlapY) {
            top = other.top - height - 2;
            moved = true;
          }
        }
      }
      placed.push({ centerX, top, width, height });
      label.style.left = (centerX - layerRect.left) + 'px';
      label.style.top = (top - layerRect.top) + 'px';
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
      const layer = getLayer(subs);
      if (!layer) continue;
      for (const word of subs.querySelectorAll(WORD_SELECTOR)) {
        if (!isPurple(word)) continue;
        const info = wordInfo(word);
        if (!info) continue;
        seen.add(word);
        if (!labels.has(word)) setLabel(word, layer, '…');
        lookup(info.form, info.sourceLang).then(
          meanings => {
            if (!word.isConnected || !labels.has(word)) return;
            if (meanings.length) setLabel(word, layer, meanings.slice(0, MAX_MEANINGS).join('・'));
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
    // Ignore our own label updates.
    for (const m of mutations) {
      const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!target?.closest?.('.' + LAYER_CLASS)) {
        scheduleScan();
        return;
      }
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
