// ==UserScript==
// @name         Language Reactor Don't Learn Translations
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.1.0
// @description  Keep dictionary meanings visible for purple (Don't Learn) Language Reactor subtitle words.
// @author       nomuonji
// @match        https://www.youtube.com/*
// @match        https://www.netflix.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/language-reactor-dont-learn-translation.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/language-reactor-dont-learn-translation.user.js
// ==/UserScript==

(() => {
  'use strict';

  const STYLE_ID = 'lr-dont-learn-translation-style';
  const MARKER = 'data-lr-dont-learn-always';
  const READY_MARKER = 'data-lr-dont-learn-dict-ready';
  const WORD_SELECTOR = '#lln-subs .lln-word, .lln-subs-text .lln-word';
  const TARGET_PURPLE = [184, 148, 197];
  const COLOR_TOLERANCE = 40;

  // State is keyed by a stable token description, not a DOM node.
  // Language Reactor can replace the subtitle subtree after a hover.
  const processed = new Map();
  const dictionaryCache = new Map();
  const queue = [];
  const queued = new Set();
  let processing = false;
  let scanScheduled = false;

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.lln-word[' + MARKER + '="true"] > .tt[' + READY_MARKER + '="true"],' +
      '.lln-word[' + MARKER + '="true"] > .tt[' + READY_MARKER + '="true"].lln-tt-hidden {' +
      'opacity:1!important;visibility:visible!important;display:block!important;' +
      'pointer-events:none!important;z-index:2147483647!important;}';
    (document.head || document.documentElement).appendChild(style);
  }

  function isPurple(word) {
    const values = getComputedStyle(word).color.match(/[\d.]+/g);
    if (!values || values.length < 3) return false;
    const rgb = values.slice(0, 3).map(Number);
    const distance = Math.sqrt(rgb.reduce(
      (sum, value, i) => sum + (value - TARGET_PURPLE[i]) ** 2, 0
    ));
    return distance <= COLOR_TOLERANCE;
  }

  function readWordText(word) {
    return [...word.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('')
      .trim();
  }

  function getTooltip(word) {
    return word.querySelector(':scope > .tt') || word.querySelector('.tt');
  }

  function meaningKey(item) {
    const wordKey = typeof item.wordKey === 'string'
      ? item.wordKey
      : (item.getAttribute('data-word-key') || '');
    const label = typeof item.label === 'string'
      ? item.label
      : readWordText(item);
    return wordKey + '|' + label;
  }

  function hasDictionary(word) {
    return Boolean(getTooltip(word)?.querySelector('.lln-hover-dict-entries'));
  }

  function applyDictionaryMarkup(word, markup) {
    let tooltip = getTooltip(word);
    if (!tooltip) {
      tooltip = document.createElement('span');
      tooltip.className = 'tt lln-tt-hidden';
      word.prepend(tooltip);
    }
    if (markup && !tooltip.querySelector('.lln-hover-dict-entries')) {
      tooltip.innerHTML = markup;
    }
    if (!tooltip.querySelector('.lln-hover-dict-entries')) return false;
    word.setAttribute(MARKER, 'true');
    tooltip.setAttribute(READY_MARKER, 'true');
    return true;
  }

  function cacheVisibleDictionary(word) {
    const tooltip = getTooltip(word);
    if (!tooltip?.querySelector('.lln-hover-dict-entries')) return false;
    dictionaryCache.set(meaningKey(word), tooltip.innerHTML);
    return applyDictionaryMarkup(word, tooltip.innerHTML);
  }

  function sentenceSignature(container) {
    if (!container) return '';
    return [...container.querySelectorAll('.lln-word')]
      .filter(word => !word.classList.contains('lln-group-part'))
      .map(word => [
        word.getAttribute('data-token-index') || '',
        word.getAttribute('data-word-key') || '',
        readWordText(word)
      ].join('~'))
      .join('|');
  }

  function describe(word) {
    const container = word.closest('.lln-subs-text') || word.closest('#lln-subs');
    const descriptor = {
      tokenIndex: word.getAttribute('data-token-index') || '',
      wordKey: word.getAttribute('data-word-key') || '',
      label: readWordText(word),
      sentence: sentenceSignature(container)
    };
    descriptor.id = [
      descriptor.sentence, descriptor.tokenIndex, descriptor.wordKey, descriptor.label
    ].join('§');
    descriptor.meaning = meaningKey(descriptor);
    return descriptor;
  }

  function findCurrentWord(descriptor) {
    for (const word of document.querySelectorAll(WORD_SELECTOR)) {
      if (!word.isConnected || word.classList.contains('lln-group-part')) continue;
      if ((word.getAttribute('data-token-index') || '') !== descriptor.tokenIndex) continue;
      if ((word.getAttribute('data-word-key') || '') !== descriptor.wordKey) continue;
      if (readWordText(word) !== descriptor.label || !isPurple(word)) continue;
      const container = word.closest('.lln-subs-text') || word.closest('#lln-subs');
      if (sentenceSignature(container) !== descriptor.sentence) continue;
      return word;
    }
    return null;
  }

  function visibleOnScreen(word) {
    const rect = word.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function dispatchHover(word) {
    const rect = word.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      relatedTarget: document.body
    };
    try {
      word.dispatchEvent(new PointerEvent('pointerover', {
        ...options, pointerType: 'mouse', isPrimary: true
      }));
      word.dispatchEvent(new PointerEvent('pointerenter', {
        ...options, bubbles: false, pointerType: 'mouse', isPrimary: true
      }));
      word.dispatchEvent(new PointerEvent('pointermove', {
        ...options, pointerType: 'mouse', isPrimary: true
      }));
    } catch { /* Older browser fallback below. */ }
    word.dispatchEvent(new MouseEvent('mouseover', options));
    word.dispatchEvent(new MouseEvent('mouseenter', { ...options, bubbles: false }));
    word.dispatchEvent(new MouseEvent('mousemove', options));
  }

  function dispatchLeave(word) {
    if (!word) return;
    const options = {
      bubbles: true,
      cancelable: true,
      view: window,
      relatedTarget: document.body
    };
    try {
      word.dispatchEvent(new PointerEvent('pointerout', {
        ...options, pointerType: 'mouse', isPrimary: true
      }));
      word.dispatchEvent(new PointerEvent('pointerleave', {
        ...options, bubbles: false, pointerType: 'mouse', isPrimary: true
      }));
    } catch { /* Older browser fallback below. */ }
    word.dispatchEvent(new MouseEvent('mouseout', options));
    word.dispatchEvent(new MouseEvent('mouseleave', { ...options, bubbles: false }));
  }

  function waitForDictionary(descriptor, timeoutMs = 2400) {
    const initial = findCurrentWord(descriptor);
    if (initial && hasDictionary(initial)) {
      return Promise.resolve({ word: initial, markup: getTooltip(initial).innerHTML });
    }

    return new Promise(resolve => {
      let finished = false;
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => finish(null), timeoutMs);

      function finish(result) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(result);
      }
      function check() {
        const word = findCurrentWord(descriptor);
        if (word && hasDictionary(word)) {
          finish({ word, markup: getTooltip(word).innerHTML });
        }
      }

      // Observe the document, not the original word: hover can replace that node.
      observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'style', 'data-word-key']
      });
      check();
    });
  }

  async function processQueue() {
    if (processing) return;
    processing = true;
    try {
      while (queue.length) {
        const descriptor = queue.shift();
        queued.delete(descriptor.id);
        const prior = processed.get(descriptor.id) || { attempts: 0 };
        const word = findCurrentWord(descriptor);
        if (!word) {
          processed.set(descriptor.id, {
            status: 'attempted', attempts: prior.attempts || 0, lastAttempt: Date.now()
          });
          continue;
        }

        const cached = dictionaryCache.get(descriptor.meaning);
        if (cached && applyDictionaryMarkup(word, cached)) {
          processed.set(descriptor.id, { status: 'ready', attempts: prior.attempts || 0 });
          continue;
        }
        if (cacheVisibleDictionary(word)) {
          processed.set(descriptor.id, { status: 'ready', attempts: prior.attempts || 0 });
          continue;
        }

        const attempts = (prior.attempts || 0) + 1;
        processed.set(descriptor.id, { status: 'queued', attempts, lastAttempt: Date.now() });
        dispatchHover(word);
        const result = await waitForDictionary(descriptor);

        if (result?.markup) {
          dictionaryCache.set(descriptor.meaning, result.markup);
          // Release the previous hover before opening the next word.
          dispatchLeave(findCurrentWord(descriptor) || result.word);
          await delay(80);

          // Resolve the possibly replaced node again; never reuse stale references.
          const current = findCurrentWord(descriptor) ||
            (result.word.isConnected ? result.word : null);
          if (current) applyDictionaryMarkup(current, result.markup);
          processed.set(descriptor.id, { status: 'ready', attempts });
        } else {
          dispatchLeave(findCurrentWord(descriptor) || word);
          processed.set(descriptor.id, { status: 'attempted', attempts, lastAttempt: Date.now() });
          if (attempts < 3) setTimeout(scheduleScan, 2200);
        }
        await delay(140);
      }
    } finally {
      processing = false;
      if (queue.length) void processQueue();
    }
  }

  function scan() {
    addStyles();
    for (const word of document.querySelectorAll(WORD_SELECTOR)) {
      if (word.classList.contains('lln-group-part')) continue;

      if (!isPurple(word)) {
        word.removeAttribute(MARKER);
        getTooltip(word)?.removeAttribute(READY_MARKER);
        continue;
      }

      const descriptor = describe(word);
      word.setAttribute(MARKER, 'true');

      const cached = dictionaryCache.get(descriptor.meaning);
      if (cached) {
        applyDictionaryMarkup(word, cached);
        processed.set(descriptor.id, { status: 'ready', attempts: 0 });
        continue;
      }
      if (cacheVisibleDictionary(word)) {
        processed.set(descriptor.id, { status: 'ready', attempts: 0 });
        continue;
      }
      if (!visibleOnScreen(word)) continue;

      const state = processed.get(descriptor.id);
      if (state?.status === 'ready' || state?.status === 'queued') continue;
      if ((state?.attempts || 0) >= 3) continue;
      if (Date.now() - (state?.lastAttempt || 0) < 2000) continue;
      if (queued.has(descriptor.id)) continue;

      queued.add(descriptor.id);
      processed.set(descriptor.id, {
        status: 'queued', attempts: state?.attempts || 0, lastAttempt: state?.lastAttempt || 0
      });
      queue.push(descriptor);
    }
    void processQueue();
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'data-word-key', 'data-token-index']
  });
  scan();
})();