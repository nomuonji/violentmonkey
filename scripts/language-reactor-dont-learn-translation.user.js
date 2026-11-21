// ==UserScript==
// @name         Language Reactor Don't Learn Translations
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      2.3.1
// @description  Always show dictionary meanings above purple (Don't Learn) words in Language Reactor subtitles.
// @author       nomuonji
// @match        https://www.youtube.com/*
// @match        https://www.netflix.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
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
  const EMPTY_RETRY_MS = 15000;
  const cache = new Map(); // "sl|form" -> Promise<string[]>
  const failedAt = new Map(); // "sl|form" -> timestamp of last failure
  const emptyRetryAt = new Map(); // Empty dictionary responses are not permanent.
  let scanScheduled = false;
  let rafId = 0;
  let lastLayoutAt = 0;
  const inspectedWords = new WeakMap();
  const diagnostics = {
    version: '2.3.1', scannedPurple: 0, labels: 0, visible: 0,
    collisionHidden: 0, offscreenHidden: 0, emptyDictionary: 0, lookupErrors: 0,
    lastLayout: '', hiddenExamples: [], wordStatuses: []
  };
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('LR 注釈: 表示診断', () => {
      const report = JSON.stringify(diagnostics, null, 2);
      console.info('[LR Dont Learn] diagnostics', report);
      alert('Language Reactor 注釈診断\n' + report);
    });
  }

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
    // A temporary empty response is not a permanent no-translation verdict.
    if (Date.now() < (emptyRetryAt.get(key) || 0)) return Promise.resolve([]);
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
        const unique = [...new Set(cleaned)];
        if (!unique.length) {
          cache.delete(key);
          emptyRetryAt.set(key, Date.now() + EMPTY_RETRY_MS);
        } else {
          emptyRetryAt.delete(key);
        }
        return unique;
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
        position: fixed; left: 0; top: 0; width: 0; height: 0;
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

  // Screen-space coordinates and CSS placement must share one coordinate system.
  // The old layer lived inside a transformed subtitle container, so positions
  // computed in viewport pixels were scaled/translated a second time.
  function getLayer() {
    // Fullscreen hides elements outside its root. Reparent the overlay as needed.
    const host = document.fullscreenElement || document.documentElement;
    let layer = document.querySelector('.' + LAYER_CLASS);
    if (!layer) {
      layer = document.createElement('div');
      layer.className = LAYER_CLASS;
    }
    if (layer.parentElement !== host) host.appendChild(layer);
    return layer;
  }

  // Each label is bound to one word element; LR replaces word nodes when the
  // subtitle line changes, which drops their labels automatically.
  const labels = new Map(); // word element -> { label, text }

  function setLabel(word, layer, meanings) {
    let entry = labels.get(word);
    if (!entry || entry.label.parentElement !== layer) {
      entry?.label.remove();
      const label = document.createElement('div');
      label.className = LABEL_CLASS;
      layer.appendChild(label);
      entry = { label, meanings: [], text: '' };
      labels.set(word, entry);
    }
    const values = meanings.slice(0, MAX_MEANINGS);
    const text = values.join('・');
    entry.meanings = values;
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
        if (!node.textContent.trim() || node.parentElement?.closest('.' + LAYER_CLASS)) continue;
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

  // Annotations must never obscure either LR subtitle line (including the
  // Japanese translation) or native video captions. Hide only the annotation
  // if there is no room, leaving the subtitle fully readable.
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
        if (word.isConnected && label.isConnected) return true;
        label.remove();
        labels.delete(word);
        return false;
      })
      .map(([word, entry]) => ({
        word, entry, rect: word.getBoundingClientRect()
      }))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    diagnostics.labels = entries.length;
    diagnostics.visible = 0;
    diagnostics.collisionHidden = 0;
    diagnostics.offscreenHidden = 0;
    diagnostics.hiddenExamples = [];
    diagnostics.lastLayout = new Date().toISOString();

    for (const { word, entry, rect } of entries) {
      const { label, meanings } = entry;
      label.style.display = '';
      if (!rect.width || !rect.height) {
        label.style.display = 'none';
        diagnostics.offscreenHidden++;
        continue;
      }
      const bounds = labelBounds(word);
      const margin = 4;
      const centerOfWord = rect.left + rect.width / 2;
      let position = null;
      let collision = false;
      // First try directly above/below this exact word. Prefer a shorter
      // definition to moving the label multiple rows away from its source.
      for (const lane of [0, 1]) {
        if (position) break;
        for (let count = meanings.length; count >= 1 && !position; count--) {
          label.textContent = meanings.slice(0, count).join('・');
          const width = label.offsetWidth;
          const height = label.offsetHeight;
          if (!width || !height || width + 2 * margin > bounds.right - bounds.left) continue;
          const gap = margin + lane * (height + margin);
          if (gap > 32) continue;
          for (const above of [true, false]) {
            if (position) break;
            const top = above ? rect.top - height - gap : rect.bottom + gap;
            if (top < bounds.top + margin || top + height > bounds.bottom - margin) continue;
            for (const offset of [0, -10, 10, -20, 20, -30, 30]) {
              const centerX = Math.max(bounds.left + width / 2 + margin,
                Math.min(bounds.right - width / 2 - margin, centerOfWord + offset));
              if (Math.abs(centerX - centerOfWord) > 32) continue;
              const box = {
                left: centerX - width / 2, right: centerX + width / 2,
                top, bottom: top + height
              };
              if (protectedRects.some(other => intersects(box, other, 2)) ||
                  placed.some(other => intersects(box, other, 3))) {
                collision = true;
                continue;
              }
              position = box;
              break;
            }
          }
        }
      }
      if (!position) {
        label.style.display = 'none';
        if (collision) diagnostics.collisionHidden++;
        else diagnostics.offscreenHidden++;
        if (diagnostics.hiddenExamples.length < 8) {
          diagnostics.hiddenExamples.push({
            word: wordText(word).slice(0, 36),
            reason: collision ? 'collision' : 'no-nearby-space'
          });
        }
        continue;
      }
      placed.push(position);
      label.style.left = ((position.left + position.right) / 2) + 'px';
      label.style.top = position.top + 'px';
      diagnostics.visible++;
    }
    if (labels.size) rafId = requestAnimationFrame(positionLabels);
  }

  function ensurePositioning() {
    if (!rafId && labels.size) rafId = requestAnimationFrame(positionLabels);
  }

  // ---- Scan --------------------------------------------------------------

  // Prefer LR's keyed form, but try the displayed form when they differ:
  // data-word-key may refer to a normalized form with no dictionary entry.
  async function lookupWord(info, visibleForm) {
    const meanings = await lookup(info.form, info.sourceLang);
    if (meanings.length) return meanings;
    const alternate = visibleForm.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
    if (alternate && alternate !== info.form) {
      return lookup(alternate, info.sourceLang);
    }
    return [];
  }

  function scan() {
    addStyles();
    const seen = new Set();
    const statuses = [];
    for (const subs of document.querySelectorAll(SUBS_SELECTOR)) {
      const layer = getLayer();
      for (const word of subs.querySelectorAll(WORD_SELECTOR)) {
        if (!isPurple(word)) continue;
        const info = wordInfo(word);
        if (!info) continue;
        seen.add(word);
        const key = info.sourceLang + '|' + info.form;
        let state = inspectedWords.get(word);
        if (!state || state.key !== key) {
          state = {
            key, meanings: null, pending: false, retryAt: 0,
            lastError: '', lastEmptyAt: 0
          };
          inspectedWords.set(word, state);
        }
        state.lastSeenAt = Date.now();
        const displayedWord = wordText(word);
        if (state.meanings?.length) {
          if (!labels.has(word)) setLabel(word, layer, state.meanings);
        } else if (!state.pending && state.meanings === null && Date.now() >= state.retryAt) {
          state.pending = true;
          const activeState = state;
          lookupWord(info, displayedWord).then(meanings => {
            activeState.pending = false;
            if (inspectedWords.get(word) !== activeState) return;
            if (!meanings.length) {
              activeState.meanings = null;
              activeState.retryAt = Date.now() + EMPTY_RETRY_MS;
              activeState.lastEmptyAt = Date.now();
              diagnostics.emptyDictionary++;
              scheduleScan();
              return;
            }
            activeState.meanings = meanings;
            activeState.lastEmptyAt = 0;
            activeState.lastError = '';
            if (word.isConnected && word.closest(SUBS_SELECTOR) && isPurple(word)) {
              setLabel(word, getLayer(), meanings);
              ensurePositioning();
            } else {
              // The word may have been recolored while the request was pending.
              // A later scan can reattach this already-retrieved meaning.
              scheduleScan();
            }
          }, error => {
            activeState.pending = false;
            if (inspectedWords.get(word) !== activeState) return;
            activeState.retryAt = Date.now() + RETRY_MS;
            activeState.lastError = String(error?.message || error);
            diagnostics.lookupErrors++;
            scheduleScan();
          });
        }
        const entry = labels.get(word);
        const status = state.pending ? 'loading'
          : state.meanings?.length
            ? (entry ? (entry.label.style.display === 'none' ? 'hidden-by-layout' : 'visible') : 'ready-to-display')
            : state.lastError ? 'lookup-error'
            : state.lastEmptyAt ? 'empty-dictionary-retrying' : 'waiting';
        if (statuses.length < 40) {
          statuses.push({
            word: displayedWord.slice(0, 32),
            status,
            retrySeconds: state.retryAt > Date.now()
              ? Math.ceil((state.retryAt - Date.now()) / 1000) : 0
          });
        }
      }
    }
    diagnostics.scannedPurple = seen.size;
    diagnostics.wordStatuses = statuses;
    for (const word of [...labels.keys()]) {
      if (seen.has(word)) continue;
      const state = inspectedWords.get(word);
      if (word.isConnected && word.closest(SUBS_SELECTOR) &&
          Date.now() - (state?.lastSeenAt || 0) < 350) {
        scheduleScan();
        continue;
      }
      removeLabel(word);
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
  // LR sometimes replaces the subtitle DOM without a relevant mutation,
  // and empty dictionary results must eventually be retried.
  setInterval(scheduleScan, 2000);
  scan();
})();
