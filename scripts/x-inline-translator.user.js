// ==UserScript==
// @name         X Inline Translator (Chrome Built-in AI)
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      0.2.0
// @description  X投稿をローカル翻訳。英単語は1クリックで意味表示、ドラッグ選択はフレーズ翻訳。
// @author       nomuonji
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-idle
// @inject-into  page
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/x-inline-translator.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/x-inline-translator.user.js
// ==/UserScript==

(() => {
  'use strict';

  // No remote translation endpoint, keys, storage, GM_xmlhttpRequest or fetch.
  // Requires Chrome's on-device Translator API (desktop Chrome 138+).
  if (document.getElementById('vmxt-style')) return;

  const style = document.createElement('style');
  style.id = 'vmxt-style';
  style.textContent = [
    '.vmxt-actions{display:flex;align-items:center;gap:8px;margin:7px 0 1px;font-family:system-ui,sans-serif;font-size:12px;}',
    '.vmxt-button{appearance:none;border:1px solid rgba(29,155,240,.35);border-radius:16px;background:transparent;color:#1d9bf0;font:600 12px/1.5 system-ui,sans-serif;padding:2px 10px;cursor:pointer;}',
    '.vmxt-button:hover{background:rgba(29,155,240,.12);}',
    '.vmxt-button:disabled{cursor:progress;opacity:.65;}',
    '.vmxt-result{margin-top:7px;padding:10px 12px;max-width:100%;box-sizing:border-box;border:1px solid #384454;border-radius:10px;background:#14202a;color:#f1f5f9;font:14px/1.65 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;}',
    '.vmxt-result[hidden],.vmxt-popover[hidden]{display:none!important;}',
    '.vmxt-label{font-size:11px;opacity:.65;margin-bottom:4px;}',
    '.vmxt-popover{position:fixed;z-index:2147483640;box-sizing:border-box;width:min(310px,calc(100vw - 20px));padding:12px;border:1px solid #475569;border-radius:12px;background:#111b28;color:#f8fafc;box-shadow:0 6px 28px #0006;font:13px/1.55 system-ui,sans-serif;}',
    '.vmxt-pop-head{display:flex;align-items:center;gap:8px;}',
    '.vmxt-pop-word{font-size:15px;font-weight:700;overflow-wrap:anywhere;flex:1;}',
    '.vmxt-pop-definition{margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;}',
    '.vmxt-pop-foot{margin-top:7px;font-size:11px;color:#aab8c6;}',
    '.vmxt-pop-close,.vmxt-pop-speak{background:transparent;border:0;color:#a9ddff;padding:3px 6px;cursor:pointer;font-size:14px;}',
    '.vmxt-pop-translate{margin-top:7px;}'
  ].join('\n');
  (document.head || document.documentElement).append(style);

  const records = new WeakMap();
  const translators = new Map();
  let detectorPromise = null;
  let selectionPopover = null;
  let selectionSerial = 0;
  let scanScheduled = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function supported() {
    return typeof globalThis.Translator?.availability === 'function' &&
      typeof globalThis.Translator?.create === 'function';
  }

  function normalizeLanguage(value) {
    if (typeof value !== 'string') return null;
    const lower = value.trim().toLowerCase().replace('_', '-');
    if (!lower || lower === 'und' || lower === 'auto') return null;
    if (lower === 'zh-hant' || lower.startsWith('zh-hant-') || lower.startsWith('zh-tw')) return 'zh-Hant';
    const short = lower.split('-')[0];
    return /^[a-z]{2,3}$/.test(short) ? short : null;
  }

  function languageHint(tweetText) {
    const own = normalizeLanguage(tweetText.getAttribute('lang'));
    if (own) return own;
    const child = tweetText.querySelector('[lang]');
    return child ? normalizeLanguage(child.getAttribute('lang')) : null;
  }

  async function getDetector() {
    if (typeof globalThis.LanguageDetector?.availability !== 'function' ||
        typeof globalThis.LanguageDetector?.create !== 'function') return null;
    if (!detectorPromise) {
      detectorPromise = (async () => {
        const status = await globalThis.LanguageDetector.availability();
        if (status === 'unavailable') return null;
        return globalThis.LanguageDetector.create();
      })().catch(() => null);
    }
    return detectorPromise;
  }

  async function detectSource(text, hint) {
    if (hint) return hint;
    if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
    if (text.length < 15 && /^[\p{Script=Latin}\s\p{P}\p{N}]+$/u.test(text)) return 'en';
    const detector = await getDetector();
    if (detector) {
      try {
        const candidates = await detector.detect(text);
        const candidate = candidates?.find(item =>
          item.confidence >= 0.35 && normalizeLanguage(item.detectedLanguage));
        if (candidate) return normalizeLanguage(candidate.detectedLanguage);
      } catch (error) {
        console.warn('[X Inline Translator] Language detection failed:', error);
      }
    }
    return 'en';
  }

  async function getTranslator(sourceLanguage, notify) {
    if (!supported()) {
      throw new Error('このブラウザではTranslator APIを利用できません。デスクトップ版Chrome 138以降で開いてください。');
    }
    if (sourceLanguage === 'ja') return null;
    if (!translators.has(sourceLanguage)) {
      const promise = (async () => {
        const options = { sourceLanguage, targetLanguage: 'ja' };
        const status = await globalThis.Translator.availability(options);
        if (status === 'unavailable') {
          throw new Error('この環境では「' + sourceLanguage + ' → 日本語」の翻訳モデルを利用できません。');
        }
        if (status !== 'available') notify?.('翻訳モデルを準備中…');
        return globalThis.Translator.create({
          ...options,
          monitor(monitor) {
            monitor.addEventListener('downloadprogress', event => {
              if (Number.isFinite(event.loaded)) {
                notify?.('翻訳モデルをダウンロード中… ' + Math.round(event.loaded * 100) + '%');
              }
            });
          }
        });
      })();
      translators.set(sourceLanguage, promise);
      promise.catch(() => {
        if (translators.get(sourceLanguage) === promise) translators.delete(sourceLanguage);
      });
    }
    return translators.get(sourceLanguage);
  }

  async function translate(text, hint, notify) {
    if (!supported()) {
      throw new Error('Chrome組み込みTranslator APIが見つかりません。Chromeの対応状況を確認してください。');
    }
    notify?.('言語を確認中…');
    const sourceLanguage = await detectSource(text, hint);
    if (sourceLanguage === 'ja') return 'すでに日本語のテキストです。';
    notify?.('翻訳の準備中…');
    const translator = await getTranslator(sourceLanguage, notify);
    notify?.('翻訳中…');
    return translator.translate(text);
  }

  function sourceText(node) {
    return (node.innerText || node.textContent || '').trim();
  }

  function buildControls(article, tweetText, content) {
    const actions = element('div', 'vmxt-actions');
    const button = element('button', 'vmxt-button', '日本語訳');
    button.type = 'button';
    button.title = 'ブラウザ内で翻訳（外部の翻訳APIには投稿を送信しません）';
    const result = element('div', 'vmxt-result');
    const label = element('div', 'vmxt-label', 'Chrome 組み込み翻訳');
    const body = element('div', 'vmxt-result-body');
    result.append(label, body);
    result.hidden = true;
    actions.append(button, result);
    // Keep the result below the button, not in X's original text nodes.
    actions.style.display = 'block';
    actions.addEventListener('click', e => e.stopPropagation());
    actions.addEventListener('pointerdown', e => e.stopPropagation());
    tweetText.after(actions);

    const record = { text: content, actions, button, result, body, busy: false, done: false };
    records.set(article, record);
    button.addEventListener('click', async e => {
      e.stopPropagation();
      if (record.busy) return;
      if (record.done) {
        result.hidden = !result.hidden;
        button.textContent = result.hidden ? '日本語訳' : '訳を隠す';
        return;
      }
      result.hidden = false;
      record.busy = true;
      button.disabled = true;
      button.textContent = '翻訳中…';
      body.textContent = '確認中…';
      const isCurrent = () => records.get(article) === record && actions.isConnected &&
        sourceText(tweetText) === record.text;
      try {
        const translation = await translate(record.text, languageHint(tweetText), msg => {
          if (isCurrent()) body.textContent = msg;
        });
        if (!isCurrent()) return;
        body.textContent = translation;
        record.done = true;
        button.textContent = '訳を隠す';
      } catch (error) {
        if (!isCurrent()) return;
        body.textContent = '翻訳できませんでした: ' + (error?.message || String(error));
        button.textContent = '再試行';
      } finally {
        record.busy = false;
        button.disabled = false;
      }
    });
  }

  function scanTweets() {
    scanScheduled = false;
    document.querySelectorAll('article[data-testid="tweet"]').forEach(article => {
      const tweetText = article.querySelector('[data-testid="tweetText"]');
      const previous = records.get(article);
      const content = tweetText ? sourceText(tweetText) : '';
      const skip = !content || languageHint(tweetText) === 'ja';
      if (previous && previous.text === content && previous.actions.isConnected && !skip) return;
      if (previous) {
        previous.actions.remove();
        records.delete(article);
      }
      if (!skip) buildControls(article, tweetText, content);
    });
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(scanTweets);
  }

  function dismissSelection() {
    if (selectionPopover) selectionPopover.remove();
    selectionPopover = null;
    selectionSerial++;
  }


  // Resolve a clicked English word without wrapping or replacing X's React-managed text nodes.
  // Links, hashtags/mentions rendered as links, selection, and modified clicks remain native.
  function clickedEnglishWord(event) {
    if (event.button !== 0 || event.detail !== 1 ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        !(event.target instanceof Element)) return null;
    const tweetText = event.target.closest('[data-testid="tweetText"]');
    if (!tweetText || !tweetText.closest('article[data-testid="tweet"]')) return null;

    const interactive = event.target.closest(
      'a,button,input,textarea,select,[role="link"],[role="button"],[contenteditable="true"]'
    );
    if (interactive && tweetText.contains(interactive)) return null;
    const selection = globalThis.getSelection();
    if (selection && !selection.isCollapsed) return null;

    let node, offset;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(event.clientX, event.clientY);
      node = position?.offsetNode;
      offset = position?.offset;
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(event.clientX, event.clientY);
      node = range?.startContainer;
      offset = range?.startOffset;
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || !tweetText.contains(node) ||
        !Number.isInteger(offset)) return null;

    // Caret offsets can sit on either boundary; actual glyph rects decide the hit.
    const content = node.textContent || '';
    const wordPattern = /[\p{Script=Latin}]+(?:['’\-][\p{Script=Latin}]+)*/gu;
    for (const match of content.matchAll(wordPattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (match[0].length > 48 || offset < start || offset > end) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const hit = Array.from(range.getClientRects()).find(rect =>
        rect.width > 0 && rect.height > 0 &&
        event.clientX >= rect.left - 1 && event.clientX <= rect.right + 1 &&
        event.clientY >= rect.top - 1 && event.clientY <= rect.bottom + 1
      );
      if (hit) return { text: match[0], hint: 'en', rect: hit };
    }
    return null;
  }

  function selectedTweetText() {
    const selection = globalThis.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount < 1) return null;
    const selected = selection.toString().trim().replace(/\s+/g, ' ');
    if (!selected || selected.length > 250) return null;
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    const anchorElement = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    const focusElement = focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement;
    const textNode = anchorElement?.closest('[data-testid="tweetText"]');
    if (!textNode || !textNode.contains(focusElement)) return null;
    const article = textNode.closest('article[data-testid="tweet"]');
    if (!article) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.left)) return null;
    return { text: selected, hint: languageHint(textNode), rect };
  }

  function speak(text) {
    if (!('speechSynthesis' in globalThis)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.88;
    globalThis.speechSynthesis.cancel();
    globalThis.speechSynthesis.speak(utterance);
  }

  function showSelectionPopup(info, automatic) {
    dismissSelection();
    const serial = selectionSerial;
    const popup = element('div', 'vmxt-popover');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Xの選択テキスト翻訳');
    const head = element('div', 'vmxt-pop-head');
    const title = element('span', 'vmxt-pop-word', info.text);
    const isWord = /^[a-z]+(?:[-'][a-z]+)*$/i.test(info.text);
    const sound = element('button', 'vmxt-pop-speak', '🔊');
    sound.type = 'button';
    sound.title = '英語の発音を聞く';
    sound.setAttribute('aria-label', '発音を聞く');
    sound.hidden = !isWord;
    sound.addEventListener('click', () => speak(info.text));
    const close = element('button', 'vmxt-pop-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '閉じる');
    close.addEventListener('click', dismissSelection);
    head.append(title, sound, close);
    const translateButton = element('button', 'vmxt-button vmxt-pop-translate', isWord ? '単語の意味を表示' : '選択部分を訳す');
    translateButton.type = 'button';
    const definition = element('div', 'vmxt-pop-definition');
    const foot = element('div', 'vmxt-pop-foot', 'ローカルAIによる訳語です。辞書の全語義・品詞の網羅ではありません。');
    foot.hidden = true;
    popup.append(head, translateButton, definition, foot);
    popup.addEventListener('pointerdown', e => e.stopPropagation());
    popup.addEventListener('click', e => e.stopPropagation());
    document.body.append(popup);
    selectionPopover = popup;
    popup.style.left = Math.round(Math.max(10, Math.min(innerWidth - 320, info.rect.left))) + 'px';
    popup.style.top = Math.round(Math.max(10, Math.min(innerHeight - 170, info.rect.bottom + 8))) + 'px';

    let busy = false;
    async function runTranslate() {
      if (busy) return;
      busy = true;
      translateButton.disabled = true;
      translateButton.textContent = '翻訳中…';
      definition.textContent = '翻訳の準備中…';
      try {
        const value = await translate(info.text, isWord ? 'en' : info.hint, msg => {
          if (selectionPopover === popup && selectionSerial === serial) definition.textContent = msg;
        });
        if (selectionPopover !== popup || selectionSerial !== serial) return;
        definition.textContent = value;
        foot.hidden = false;
        translateButton.hidden = true;
      } catch (error) {
        if (selectionPopover !== popup || selectionSerial !== serial) return;
        definition.textContent = '翻訳できませんでした: ' + (error?.message || String(error));
        translateButton.textContent = '再試行';
        translateButton.disabled = false;
        busy = false;
      }
    }
    translateButton.addEventListener('click', runTranslate);
    if (automatic && isWord) runTranslate();
  }

  document.addEventListener('click', event => {
    const info = clickedEnglishWord(event);
    if (!info) return;
    // X normally opens the post when its text is clicked; intercept only English words.
    event.preventDefault();
    event.stopImmediatePropagation();
    showSelectionPopup(info, true);
  }, true);

  document.addEventListener('mouseup', event => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('.vmxt-popover')) return;
    const info = selectedTweetText();
    if (info) showSelectionPopup(info, false);
    else dismissSelection();
  });

  document.addEventListener('dblclick', event => {
    if (event.target instanceof Element && event.target.closest('.vmxt-popover')) return;
    const info = selectedTweetText();
    if (info) showSelectionPopup(info, true);
  });

  document.addEventListener('pointerdown', event => {
    if (selectionPopover && event.target instanceof Element &&
        !event.target.closest('.vmxt-popover') &&
        !event.target.closest('[data-testid="tweetText"]')) dismissSelection();
  });
  document.addEventListener('scroll', dismissSelection, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') dismissSelection();
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleScan();
})();