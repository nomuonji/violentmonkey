// ==UserScript==
// @name         Language Reactor Don't Learn Translations
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.0.0
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
  const processed = new WeakMap();
  const queue = [];
  let processing = false;

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .lln-word[${MARKER}="true"] > .tt[${READY_MARKER}="true"],
      .lln-word[${MARKER}="true"] > .tt[${READY_MARKER}="true"].lln-tt-hidden {
        opacity: 1 !important;
        visibility: visible !important;
        display: block !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function isPurple(word) {
    const match = getComputedStyle(word).color.match(/[\d.]+/g);
    if (!match || match.length < 3) return false;
    const rgb = match.slice(0, 3).map(Number);
    const distance = Math.sqrt(rgb.reduce(
      (sum, value, i) => sum + (value - TARGET_PURPLE[i]) ** 2, 0
    ));
    return distance <= COLOR_TOLERANCE;
  }

  function getTooltip(word) {
    return word.querySelector(':scope > .tt') || word.querySelector('.tt');
  }

  function dictionaryIsReady(word) {
    const tooltip = getTooltip(word);
    return Boolean(tooltip?.querySelector('.lln-hover-dict-entries'));
  }

  function keepDictionaryVisible(word) {
    const tooltip = getTooltip(word);
    if (!tooltip || !tooltip.querySelector('.lln-hover-dict-entries')) return false;
    word.setAttribute(MARKER, 'true');
    tooltip.setAttribute(READY_MARKER, 'true');
    return true;
  }

  function getWordKey(word) {
    const text = [...word.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('')
      .trim();
    return `${word.getAttribute('data-word-key') || ''}|${text}`;
  }

  function visibleOnScreen(word) {
    const rect = word.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function waitForDictionary(word, timeoutMs = 1800) {
    if (dictionaryIsReady(word)) return Promise.resolve(true);
    return new Promise(resolve => {
      let finished = false;
      let observer;
      const timeout = setTimeout(() => finish(false), timeoutMs);
      function finish(success) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        observer?.disconnect();
        resolve(success);
      }
      observer = new MutationObserver(() => {
        if (dictionaryIsReady(word)) finish(true);
      });
      observer.observe(word, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
      if (dictionaryIsReady(word)) finish(true);
    });
  }

  function dispatchHover(word) {
    const rect = word.getBoundingClientRect();
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      relatedTarget: document.body
    };
    try {
      word.dispatchEvent(new PointerEvent('pointerover', {
        ...eventOptions,
        pointerType: 'mouse',
        isPrimary: true
      }));
    } catch { /* PointerEvent may be unavailable in older browsers. */ }
    word.dispatchEvent(new MouseEvent('mouseover', eventOptions));
  }

  function dispatchLeave(word) {
    const options = {
      bubbles: true,
      cancelable: true,
      view: window,
      relatedTarget: document.body
    };
    try {
      word.dispatchEvent(new PointerEvent('pointerout', {
        ...options,
        pointerType: 'mouse',
        isPrimary: true
      }));
    } catch { /* PointerEvent may be unavailable in older browsers. */ }
    word.dispatchEvent(new MouseEvent('mouseout', options));
  }

  async function processQueue() {
    if (processing) return;
    processing = true;
    try {
      while (queue.length) {
        const { word, key } = queue.shift();
        const state = processed.get(word);
        if (!word.isConnected || !isPurple(word) || getWordKey(word) !== key) continue;
        if (keepDictionaryVisible(word)) {
          processed.set(word, { key, status: 'ready' });
          continue;
        }

        dispatchHover(word);
        const loaded = await waitForDictionary(word);
        dispatchLeave(word);

        if (loaded && keepDictionaryVisible(word)) {
          processed.set(word, { key, status: 'ready' });
        } else {
          processed.set(word, { key, status: 'attempted' });
        }
        // Avoid rapid bursts if several Don't Learn words appear together.
        await new Promise(resolve => setTimeout(resolve, 120));
      }
    } finally {
      processing = false;
      if (queue.length) void processQueue();
    }
  }

  function scan() {
    addStyles();
    document.querySelectorAll(WORD_SELECTOR).forEach(word => {
      // Contractions are split into visual fragments; process the main token once.
      if (word.classList.contains('lln-group-part')) return;

      const tooltip = getTooltip(word);
      if (!isPurple(word)) {
        word.removeAttribute(MARKER);
        tooltip?.removeAttribute(READY_MARKER);
        processed.delete(word);
        return;
      }

      word.setAttribute(MARKER, 'true');
      if (keepDictionaryVisible(word)) {
        const key = getWordKey(word);
        processed.set(word, { key, status: 'ready' });
        return;
      }

      const key = getWordKey(word);
      const previous = processed.get(word);
      if (previous?.key === key) return;

      processed.set(word, { key, status: 'queued' });
      if (visibleOnScreen(word)) queue.push({ word, key });
    });
    void processQueue();
  }

  let scanScheduled = false;
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
    attributeFilter: ['style', 'class', 'data-word-key']
  });
  scan();
})();
