// ==UserScript==
// @name         Language Reactor Word Stock
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.0.0
// @description  Alt+click a Language Reactor subtitle word to stock it (meaning, example, video link) in a Google Spreadsheet.
// @author       nomuonji
// @match        https://www.youtube.com/*
// @match        https://www.netflix.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      api-cdn-plus.dioco.io
// @noframes
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/language-reactor-word-stock.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/language-reactor-word-stock.user.js
// ==/UserScript==

/*
 * Receiver: apps-script/word-stock/Code.gs (deploy as a Google Apps Script web app).
 * The web app URL is stored only in Violentmonkey's script storage, never in
 * this public repository.
 */
(() => {
  'use strict';

  const URL_KEY = 'webAppUrl';
  const TARGET_LANG = 'ja';
  const MAX_MEANINGS = 3;
  const DICT_URL = 'https://api-cdn-plus.dioco.io/base_dict_getHoverDict_8';
  const WORD_SELECTOR = '.lln-word';
  const SENTENCE_SELECTOR = '.lln-subs-text, .lln-sub-text, #lln-subs';
  const TOAST_ID = 'lr-ws-toast';

  // ---- Settings ----------------------------------------------------------
  function getWebAppUrl() {
    return String(GM_getValue(URL_KEY, '') || '').trim();
  }

  function promptWebAppUrl() {
    const current = getWebAppUrl();
    const value = window.prompt(
      'Google Apps Script のウェブアプリURL（…/exec）を貼り付けてください',
      current
    );
    if (value === null) return false;
    const url = value.trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(\?.*)?$/.test(url)) {
      toast('URLの形式が違います（https://script.google.com/macros/s/…/exec）', 'error');
      return false;
    }
    GM_setValue(URL_KEY, url);
    toast(url ? '保存先URLを設定しました' : '保存先URLを削除しました');
    return Boolean(url);
  }

  GM_registerMenuCommand('単語ストック: 保存先URLを設定', promptWebAppUrl);

  // ---- Network -----------------------------------------------------------
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: 15000,
        ...options,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error('HTTP ' + res.status));
            return;
          }
          try { resolve(JSON.parse(res.responseText)); } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout'))
      });
    });
  }

  async function lookupMeaning(form, sourceLang) {
    try {
      const params = new URLSearchParams({
        form, lemma: '', sl: sourceLang, tl: TARGET_LANG, pos: '', pow: 'n'
      });
      const json = await gmRequest({ method: 'GET', url: DICT_URL + '?' + params });
      const entries = json?.data?.hoverDictEntries;
      if (!Array.isArray(entries)) return '';
      const cleaned = entries
        .map(entry => String(entry).replace(/\s*\([\x20-\x7E]*\)\s*$/, '').trim())
        .filter(Boolean);
      return [...new Set(cleaned)].slice(0, MAX_MEANINGS).join('・');
    } catch {
      return ''; // Save the word even when the dictionary is unavailable.
    }
  }

  function postWord(url, payload) {
    return gmRequest({
      method: 'POST',
      url,
      // text/plain keeps Apps Script from rejecting the body.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify(payload)
    });
  }

  // ---- Page data ---------------------------------------------------------
  function wordText(word) {
    return [...word.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('')
      .trim();
  }

  function wordInfo(word) {
    const parts = (word.getAttribute('data-word-key') || '').split('|');
    const keyed = parts.length >= 3 ? parts[1] : '';
    const form = (keyed || wordText(word)).trim().toLowerCase();
    const sourceLang = parts.length >= 3 && parts[parts.length - 1] ? parts[parts.length - 1] : 'en';
    return { form, sourceLang };
  }

  function sentenceOf(word) {
    const container = word.closest(SENTENCE_SELECTOR);
    if (!container) return '';
    const clone = container.cloneNode(true);
    clone.querySelectorAll('.tt, .lr-dl-layer, .lr-dl-label, button').forEach(node => node.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function videoLink() {
    const video = document.querySelector('video');
    const seconds = video ? Math.max(0, Math.floor(video.currentTime) - 2) : 0;
    if (location.hostname.endsWith('youtube.com')) {
      const id = new URLSearchParams(location.search).get('v');
      if (id) return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id) + '&t=' + seconds + 's';
    }
    return location.href;
  }

  function videoTitle() {
    return document.title.replace(/\s*-\s*YouTube\s*$/, '').replace(/^\(\d+\)\s*/, '').trim();
  }

  // ---- UI ----------------------------------------------------------------
  let toastTimer = 0;
  function toast(message, kind = 'info') {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:12%', 'transform:translateX(-50%)',
        'z-index:2147483647', 'padding:8px 14px', 'border-radius:6px',
        'font:600 14px/1.4 system-ui,sans-serif', 'color:#fff',
        'box-shadow:0 2px 10px rgba(0,0,0,.4)', 'pointer-events:none',
        'transition:opacity .2s', 'max-width:80vw'
      ].join(';');
      document.documentElement.appendChild(el);
    }
    el.style.background = kind === 'error' ? 'rgba(170,40,40,.95)' : 'rgba(30,30,36,.95)';
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, kind === 'error' ? 4000 : 2200);
  }

  // ---- Save --------------------------------------------------------------
  const inFlight = new Set();

  async function saveWord(word) {
    const { form, sourceLang } = wordInfo(word);
    if (!form) return;
    let url = getWebAppUrl();
    if (!url) {
      if (!promptWebAppUrl()) return;
      url = getWebAppUrl();
    }
    if (inFlight.has(form)) return;
    inFlight.add(form);

    const payload = {
      word: form,
      example: sentenceOf(word),
      title: videoTitle(),
      url: videoLink()
    };
    toast('保存中… ' + form);
    try {
      payload.meaning = await lookupMeaning(form, sourceLang);
      const result = await postWord(url, payload);
      if (!result?.ok) throw new Error(result?.error || 'unknown error');
      toast(result.duplicate
        ? '登録済み: ' + form + '（' + result.count + '回目）'
        : 'ストックしました: ' + form + (payload.meaning ? ' — ' + payload.meaning : ''));
    } catch (error) {
      console.warn('[LR Word Stock] save failed:', error);
      toast('保存できませんでした: ' + form + '（' + error.message + '）', 'error');
    } finally {
      inFlight.delete(form);
    }
  }

  // ---- Alt+click ---------------------------------------------------------
  function targetWord(event) {
    if (!event.altKey || event.button !== 0) return null;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return null;
    return event.target instanceof Element ? event.target.closest(WORD_SELECTOR) : null;
  }

  // Swallow the whole Alt+click so Language Reactor doesn't also react to it.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
    window.addEventListener(type, event => {
      const word = targetWord(event);
      if (!word) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (type === 'click') void saveWord(word);
    }, true);
  }
})();
