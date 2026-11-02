// ==UserScript==
// @name         SNS Post Stock (X / Threads)
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.0.0
// @description  One tap on 📌 saves an X / Threads post (text, author, metrics, media, links) to a Google Spreadsheet for later analysis.
// @author       nomuonji
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.x.com/*
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @match        https://www.threads.net/*
// @match        https://threads.net/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @noframes
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/sns-post-stock.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/sns-post-stock.user.js
// ==/UserScript==

/*
 * Receiver: apps-script/sns-post-stock/Code.gs (deploy as a Google Apps Script web app).
 * The web app URL is stored only in Violentmonkey's script storage, never in
 * this public repository.
 */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const URL_KEY = 'webAppUrl';
  const SAVED_KEY = 'savedKeys';
  const MAX_SAVED_KEYS = 5000;
  const BTN_CLASS = 'sps-btn';
  const TOAST_ID = 'sps-toast';
  const IS_X = /(^|\.)(x|twitter)\.com$/.test(location.hostname);

  // ---- Settings ----------------------------------------------------------
  function getWebAppUrl() {
    return String(GM_getValue(URL_KEY, '') || '').trim();
  }

  function promptWebAppUrl() {
    const value = window.prompt(
      'Google Apps Script のウェブアプリURL（…/exec）を貼り付けてください',
      getWebAppUrl()
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

  GM_registerMenuCommand('投稿ストック: 保存先URLを設定', promptWebAppUrl);

  let savedKeys = new Set(GM_getValue(SAVED_KEY, []));
  function markSaved(key) {
    savedKeys.delete(key);
    savedKeys.add(key);
    const list = [...savedKeys].slice(-MAX_SAVED_KEYS);
    savedKeys = new Set(list);
    GM_setValue(SAVED_KEY, list);
  }

  // ---- Network -----------------------------------------------------------
  function postJson(url, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        timeout: 20000,
        // text/plain keeps Apps Script from rejecting the body.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify(payload),
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

  // ---- Helpers -----------------------------------------------------------
  // "1,234" / "1.2K" / "3.4M" / "1.2万" / "3億" → number
  function parseCount(text) {
    if (!text) return null;
    const m = String(text).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KkMmBb万億]?)/);
    if (!m) return null;
    const mult = { k: 1e3, m: 1e6, b: 1e9, '万': 1e4, '億': 1e8 }[m[2].toLowerCase()] || 1;
    return Math.round(parseFloat(m[1]) * mult);
  }

  // Serialise rich text: keep emoji (img alt), line breaks and full link text.
  function richText(root) {
    let out = '';
    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) { out += node.nodeValue; return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'IMG') { out += node.getAttribute('alt') || ''; return; }
      if (tag === 'BR') { out += '\n'; return; }
      if (tag === 'SVG' || tag === 'svg' || tag === 'BUTTON') return;
      if (tag === 'A') {
        // X hides "https://" and the tail of long URLs in display:none spans.
        out += node.textContent.replace(/…$/, '');
        return;
      }
      node.childNodes.forEach(walk);
      if (tag === 'DIV' && getComputedStyle(node).display === 'block' && !out.endsWith('\n')) out += '\n';
    };
    walk(root);
    return out.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function absUrl(href) {
    try { return new URL(href, location.origin).href; } catch { return ''; }
  }

  function uniq(list) {
    return [...new Set(list.filter(Boolean))];
  }

  // ---- X -----------------------------------------------------------------
  const X_METRICS = {
    reply: 'replies', retweet: 'reposts', unretweet: 'reposts',
    like: 'likes', unlike: 'likes', bookmark: 'bookmarks', removeBookmark: 'bookmarks'
  };

  function xOwnScope(article) {
    // Elements inside a quoted post card belong to the quote, not the post.
    return el => {
      const quote = el.closest('div[role="link"]');
      return !quote || !article.contains(quote);
    };
  }

  function xStatusLink(article) {
    const time = article.querySelector('a[href*="/status/"] time');
    return time ? time.closest('a') : article.querySelector('a[href*="/status/"]');
  }

  function xExtract(article) {
    const own = xOwnScope(article);
    const link = [...article.querySelectorAll('a[href*="/status/"]')]
      .find(a => a.querySelector('time') && own(a)) || xStatusLink(article);
    const href = link ? absUrl(link.getAttribute('href')) : location.href;
    const idMatch = href.match(/\/([^/]+)\/status\/(\d+)/);
    if (!idMatch) return null;
    const time = link && link.querySelector('time');

    const userName = [...article.querySelectorAll('[data-testid="User-Name"]')].find(own);
    let name = '';
    if (userName) {
      const first = userName.querySelector('a[role="link"] span, span');
      name = first ? richText(first.closest('a') || first) : '';
    }

    const textEl = [...article.querySelectorAll('[data-testid="tweetText"]')].find(own);
    const metrics = {};
    article.querySelectorAll('[role="group"] [data-testid]').forEach(btn => {
      const key = X_METRICS[btn.getAttribute('data-testid')];
      if (!key || !own(btn)) return;
      const n = parseCount(btn.getAttribute('aria-label')) ?? parseCount(btn.textContent);
      metrics[key] = n ?? 0;
    });
    const views = [...article.querySelectorAll('a[href*="/analytics"]')].find(own);
    if (views) metrics.views = parseCount(views.getAttribute('aria-label')) ?? parseCount(views.textContent);

    const media = [];
    article.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]').forEach(img => {
      if (!own(img)) return;
      media.push({ type: 'image', url: img.src.replace(/name=\w+/, 'name=orig'), alt: img.alt || '' });
    });
    article.querySelectorAll('video').forEach(video => {
      if (!own(video)) return;
      media.push({ type: 'video', poster: video.poster || '', url: video.src && !video.src.startsWith('blob:') ? video.src : '' });
    });

    const links = textEl ? [...textEl.querySelectorAll('a[href]')]
      .map(a => ({ text: a.textContent.replace(/…$/, ''), url: absUrl(a.getAttribute('href')) })) : [];
    const card = [...article.querySelectorAll('[data-testid="card.wrapper"] a[href]')].find(own);
    if (card) links.push({ text: richText(card).slice(0, 300), url: absUrl(card.getAttribute('href')), card: true });

    let quoted = null;
    const quoteBox = [...article.querySelectorAll('div[role="link"]')]
      .find(el => el.querySelector('[data-testid="tweetText"], [data-testid="User-Name"]'));
    if (quoteBox) {
      const qText = quoteBox.querySelector('[data-testid="tweetText"]');
      const qUser = quoteBox.querySelector('[data-testid="User-Name"]');
      const handle = qUser && (qUser.textContent.match(/@([A-Za-z0-9_]{1,15})/) || [])[1];
      const qTime = quoteBox.querySelector('time');
      quoted = {
        author: { handle: handle ? '@' + handle : '', name: qUser ? richText(qUser).split('\n')[0] : '' },
        text: qText ? richText(qText) : '',
        createdAt: qTime ? qTime.getAttribute('datetime') : ''
      };
    }

    const social = article.querySelector('[data-testid="socialContext"]');
    return {
      platform: 'x',
      postId: idMatch[2],
      url: 'https://x.com/' + idMatch[1] + '/status/' + idMatch[2],
      author: { name, handle: '@' + idMatch[1] },
      text: textEl ? richText(textEl) : '',
      lang: textEl ? textEl.getAttribute('lang') || '' : '',
      createdAt: time ? time.getAttribute('datetime') : '',
      metrics,
      media,
      links,
      quoted,
      truncated: Boolean(article.querySelector('[data-testid="tweet-text-show-more-link"]')),
      context: social ? social.textContent.trim() : '',
      isReply: /Replying to|返信先/.test(article.textContent.slice(0, 400))
    };
  }

  function xInject(article) {
    const group = [...article.querySelectorAll('[role="group"]')]
      .find(g => g.querySelector('[data-testid="reply"], [data-testid="like"], [data-testid="unlike"]') && xOwnScope(article)(g));
    if (!group) return;
    const link = xStatusLink(article);
    const m = link && link.getAttribute('href').match(/\/status\/(\d+)/);
    placeButton(group, () => xExtract(article), m ? 'x:' + m[1] : '');
  }

  // ---- Threads -----------------------------------------------------------
  const TH_LABEL = [
    [/^(like|unlike|いいね|「いいね！」を取り消す)/i, 'likes'],
    [/^(reply|comment|返信|コメント)/i, 'replies'],
    [/^(repost|再投稿|リポスト)/i, 'reposts'],
    [/^(share|シェア)/i, 'shares']
  ];

  function thMetricKey(label) {
    const hit = TH_LABEL.find(([re]) => re.test((label || '').trim()));
    return hit ? hit[1] : '';
  }

  function thContainerOf(el) {
    return el.closest('[data-pressable-container="true"]');
  }

  function thActionButtons(container) {
    return [...container.querySelectorAll('svg[aria-label]')]
      .filter(svg => thContainerOf(svg) === container && thMetricKey(svg.getAttribute('aria-label')))
      .map(svg => ({ svg, btn: svg.closest('[role="button"], button') || svg.parentElement }));
  }

  function thPostLink(container) {
    return [...container.querySelectorAll('a[href*="/post/"]')]
      .find(a => a.querySelector('time') && thContainerOf(a) === container);
  }

  function thExtract(container) {
    const link = thPostLink(container);
    if (!link) return null;
    const href = absUrl(link.getAttribute('href'));
    const m = href.match(/\/@([^/]+)\/post\/([^/?#]+)/);
    if (!m) return null;
    const own = el => thContainerOf(el) === container;
    const time = link.querySelector('time');

    const authorLink = [...container.querySelectorAll('a[href^="/@"]')]
      .find(a => own(a) && !a.querySelector('time') && !a.querySelector('img') && a.textContent.trim());

    // Body text: leaf span[dir=auto] outside links/buttons. Threads class names
    // are obfuscated, so this is a heuristic; rawText is kept as a fallback.
    const spans = [...container.querySelectorAll('span[dir="auto"]')].filter(span =>
      own(span) && !span.closest('a, [role="button"], button, time') &&
      !span.querySelector('span[dir="auto"]'));
    const text = uniq(spans.map(s => richText(s))).join('\n').trim();

    const metrics = {};
    thActionButtons(container).forEach(({ svg, btn }) => {
      const key = thMetricKey(svg.getAttribute('aria-label'));
      metrics[key] = parseCount(btn.textContent) ?? 0;
    });

    const media = [];
    container.querySelectorAll('img').forEach(img => {
      if (!own(img) || img.closest('a[href^="/@"]:not([href*="/post/"])')) return;
      if (/profile|プロフィール/i.test(img.alt || '')) return;
      if ((img.naturalWidth || img.width) < 80) return;
      media.push({ type: 'image', url: img.src, alt: img.alt || '' });
    });
    container.querySelectorAll('video').forEach(video => {
      if (!own(video)) return;
      media.push({ type: 'video', poster: video.poster || '', url: video.src && !video.src.startsWith('blob:') ? video.src : '' });
    });

    const links = [...container.querySelectorAll('a[href]')]
      .filter(a => own(a) && !/^\/(@|search|explore)/.test(a.getAttribute('href')) && !a.querySelector('time'))
      .map(a => ({ text: a.textContent.trim().slice(0, 300), url: absUrl(a.getAttribute('href')) }))
      .map(l => {
        // Threads wraps outbound links in l.threads.com/?u=…
        try {
          const u = new URL(l.url);
          if (/^l\.threads\.(com|net)$/.test(u.hostname) && u.searchParams.get('u')) l.url = u.searchParams.get('u');
        } catch {}
        return l;
      });

    let quoted = null;
    const nested = [...container.querySelectorAll('[data-pressable-container="true"]')].find(el => el !== container);
    if (nested) {
      const q = thExtract(nested);
      if (q) quoted = { url: q.url, author: q.author, text: q.text, createdAt: q.createdAt };
    }

    const clone = container.cloneNode(true);
    clone.querySelectorAll('svg, .' + BTN_CLASS).forEach(n => n.remove());
    return {
      platform: 'threads',
      postId: m[2],
      url: 'https://www.threads.com/@' + m[1] + '/post/' + m[2],
      author: { name: authorLink ? authorLink.textContent.trim() : '', handle: '@' + m[1] },
      text,
      lang: (spans.find(s => s.getAttribute('lang')) || { getAttribute: () => '' }).getAttribute('lang') || '',
      createdAt: time ? time.getAttribute('datetime') : '',
      metrics,
      media,
      links,
      quoted,
      truncated: false,
      rawText: (clone.innerText || clone.textContent || '').trim().slice(0, 5000)
    };
  }

  function thInject(container) {
    const buttons = thActionButtons(container);
    if (buttons.length < 2) return;
    // The action row is the closest ancestor that holds all of the action buttons.
    let row = buttons[0].btn.parentElement;
    while (row && row !== container && !buttons.every(b => row.contains(b.btn))) row = row.parentElement;
    if (!row || row === container) return;
    const link = thPostLink(container);
    const m = link && link.getAttribute('href').match(/\/post\/([^/?#]+)/);
    placeButton(row, () => thExtract(container), m ? 'threads:' + m[1] : '');
  }

  // ---- UI ----------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .${BTN_CLASS}{display:inline-flex;align-items:center;justify-content:center;
      min-width:34px;height:34px;margin-left:4px;padding:0 6px;border:0;border-radius:999px;
      background:transparent;cursor:pointer;font:600 15px/1 system-ui,sans-serif;
      color:inherit;opacity:.7;-webkit-tap-highlight-color:transparent;flex:0 0 auto}
    .${BTN_CLASS}:hover{opacity:1;background:rgba(29,155,240,.12)}
    .${BTN_CLASS}[data-state="saved"]{opacity:1;color:rgb(0,186,124)}
    .${BTN_CLASS}[data-state="busy"]{opacity:.4;pointer-events:none}`;
  document.documentElement.appendChild(style);

  function setState(btn, state) {
    btn.dataset.state = state;
    btn.textContent = state === 'saved' ? '✓' : state === 'busy' ? '…' : '📌';
    btn.title = state === 'saved' ? '保存済み（もう一度押すと数値を更新）' : '投稿を保存';
  }

  // Add the button once per action row; refresh it if the site reused the row
  // for a different post (virtualised timelines).
  function placeButton(row, extract, key) {
    const existing = [...row.children].find(c => c.classList.contains(BTN_CLASS));
    if (existing) {
      existing._extract = extract;
      if (existing.dataset.key !== key && existing.dataset.state !== 'busy') {
        existing.dataset.key = key;
        setState(existing, key && savedKeys.has(key) ? 'saved' : 'idle');
      }
      return;
    }
    row.appendChild(makeButton(extract, key));
  }

  function makeButton(extract, key) {
    const btn = document.createElement('button');
    btn._extract = extract;
    btn.dataset.key = key;
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute('aria-label', '投稿を保存');
    setState(btn, key && savedKeys.has(key) ? 'saved' : 'idle');
    // Stop the tap from opening the post.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'touchend']) {
      btn.addEventListener(type, e => e.stopPropagation());
    }
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void save(btn, btn._extract);
    });
    return btn;
  }

  let toastTimer = 0;
  function toast(message, kind = 'info') {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:14%', 'transform:translateX(-50%)',
        'z-index:2147483647', 'padding:8px 14px', 'border-radius:6px',
        'font:600 14px/1.4 system-ui,sans-serif', 'color:#fff',
        'box-shadow:0 2px 10px rgba(0,0,0,.4)', 'pointer-events:none',
        'transition:opacity .2s', 'max-width:86vw', 'text-align:center'
      ].join(';');
      document.documentElement.appendChild(el);
    }
    el.style.background = kind === 'error' ? 'rgba(170,40,40,.95)' : 'rgba(30,30,36,.95)';
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, kind === 'error' ? 4500 : 2200);
  }

  // ---- Save --------------------------------------------------------------
  async function save(btn, extract) {
    let url = getWebAppUrl();
    if (!url) {
      if (!promptWebAppUrl()) return;
      url = getWebAppUrl();
    }
    let post;
    try {
      post = extract();
    } catch (error) {
      console.warn('[SNS Post Stock] extract failed:', error);
    }
    if (!post) {
      toast('投稿の情報を読み取れませんでした', 'error');
      return;
    }
    post.savedFrom = location.href;
    post.clientSavedAt = new Date().toISOString();
    post.scriptVersion = VERSION;
    post.userAgent = navigator.userAgent;

    const before = btn.dataset.state;
    setState(btn, 'busy');
    try {
      const result = await postJson(url, post);
      if (!result?.ok) throw new Error(result?.error || 'unknown error');
      const key = post.platform + ':' + post.postId;
      markSaved(key);
      btn.dataset.key = key;
      document.querySelectorAll('.' + BTN_CLASS).forEach(b => { if (b === btn || b.dataset.key === key) setState(b, 'saved'); });
      toast(result.duplicate
        ? '更新しました（' + result.count + '回目）' + (post.truncated ? ' ※本文は省略表示' : '')
        : '保存しました: ' + post.author.handle + (post.truncated ? '（本文は省略表示。詳細画面で保存すると全文）' : ''));
    } catch (error) {
      console.warn('[SNS Post Stock] save failed:', error);
      setState(btn, before === 'saved' ? 'saved' : 'idle');
      toast('保存できませんでした（' + error.message + '）', 'error');
    }
  }

  // ---- Observe -----------------------------------------------------------
  function scan() {
    if (IS_X) {
      document.querySelectorAll('article[data-testid="tweet"]').forEach(xInject);
    } else {
      document.querySelectorAll('[data-pressable-container="true"]').forEach(el => {
        if (thPostLink(el)) thInject(el);
      });
    }
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan();

  // Expose a tiny debug hook for checking extraction in the console.
  window.__snsPostStockDebug = () => {
    const sel = IS_X ? 'article[data-testid="tweet"]' : '[data-pressable-container="true"]';
    return [...document.querySelectorAll(sel)].slice(0, 5).map(el => (IS_X ? xExtract : thExtract)(el));
  };
})();
