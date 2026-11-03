// ==UserScript==
// @name         SNS Post Stock (X / Threads)
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.1.1
// @description  One tap on 📌 saves (hover / long-press for tags) an X / Threads post (text, author, metrics, media, links) to a Google Spreadsheet for later analysis.
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

  const VERSION = '1.1.1';
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
  // Apps Script answers with an HTML page instead of JSON when the deployment
  // is not reachable as intended; turn the common cases into a readable hint.
  function explainHtml(res) {
    const html = String(res.responseText || '');
    const finalUrl = String(res.finalUrl || '');
    const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (/accounts\.google\.com|ServiceLogin/i.test(finalUrl + html)) {
      return 'Googleのログイン画面が返りました。デプロイの「アクセスできるユーザー」を「全員」にしてください';
    }
    if (/doPost|doGet/.test(text) && /(not found|見つかりません)/i.test(text)) {
      return 'doPostが見つかりません。Code.gsを保存してから、デプロイを管理で新バージョンを作ってください';
    }
    if (/(permission|権限|access denied|アクセス|許可)/i.test(text)) {
      return 'アクセスが拒否されました。デプロイを「自分として実行・全員がアクセス可」で作り直し、権限を許可してください';
    }
    if (/(not found|見つかりません|404)/i.test(title + text)) {
      return 'ウェブアプリが見つかりません。保存先URL（…/exec）が最新のデプロイか確認してください';
    }
    const detail = (text || title).slice(0, 120);
    return 'GASがJSONではなくHTMLを返しました' + (detail ? '：' + detail : '');
  }

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
          const body = String(res.responseText || '').trim();
          if (body.startsWith('<')) {
            console.warn('[SNS Post Stock] HTML response', res.status, res.finalUrl, body.slice(0, 2000));
            reject(new Error(explainHtml(res)));
            return;
          }
          if (res.status < 200 || res.status >= 300) {
            reject(new Error('HTTP ' + res.status));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('応答を読めませんでした：' + body.slice(0, 80)));
          }
        },
        onerror: () => reject(new Error('通信エラー')),
        ontimeout: () => reject(new Error('タイムアウト'))
      });
    });
  }

  // Menu: check the deployment from here (same request path as a real save).
  GM_registerMenuCommand('投稿ストック: 保存先の接続テスト', async () => {
    const url = getWebAppUrl();
    if (!url) { promptWebAppUrl(); return; }
    toast('接続テスト中…');
    try {
      const result = await postJson(url, { action: 'tags' });
      if (!result?.ok) throw new Error(result?.error || 'unknown error');
      toast('接続OK（タグ ' + (result.tags || []).length + '件）');
    } catch (error) {
      toast('接続NG：' + error.message, 'error');
    }
  });

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

  // ---- Tags (local cache) ------------------------------------------------
  const POST_TAGS_KEY = 'postTags';   // { "x:123": ["tag", …] } for saved posts
  const TAG_LIST_KEY = 'tagList';     // [{ name, count }] from the sheet
  const RECENT_TAGS_KEY = 'recentTags';
  const TAG_LIST_TTL = 10 * 60 * 1000;
  const MAX_CHIPS = 16;

  const postTags = GM_getValue(POST_TAGS_KEY, {}) || {};
  let tagList = GM_getValue(TAG_LIST_KEY, []) || [];
  let recentTags = GM_getValue(RECENT_TAGS_KEY, []) || [];
  let tagListFetchedAt = 0;

  function cleanTag(tag) {
    return String(tag || '').replace(/[,、，\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  function setPostTags(key, tags) {
    if (!key) return;
    postTags[key] = tags;
    for (const k of Object.keys(postTags)) if (!savedKeys.has(k)) delete postTags[k];
    GM_setValue(POST_TAGS_KEY, postTags);
    for (const t of tags) {
      if (!tagList.some(x => x.name.toLowerCase() === t.toLowerCase())) tagList.push({ name: t, count: 1 });
    }
    GM_setValue(TAG_LIST_KEY, tagList);
  }

  function useTag(tag) {
    recentTags = [tag, ...recentTags.filter(t => t.toLowerCase() !== tag.toLowerCase())].slice(0, 30);
    GM_setValue(RECENT_TAGS_KEY, recentTags);
  }

  async function refreshTagList(force) {
    const url = getWebAppUrl();
    if (!url || (!force && Date.now() - tagListFetchedAt < TAG_LIST_TTL)) return;
    tagListFetchedAt = Date.now();
    try {
      const result = await postJson(url, { action: 'tags' });
      if (result?.ok && Array.isArray(result.tags)) {
        tagList = result.tags;
        GM_setValue(TAG_LIST_KEY, tagList);
        if (panel.btn) renderPanel();
      }
    } catch (error) {
      console.warn('[SNS Post Stock] tag list failed:', error);
    }
  }

  // Recently used first, then the most used ones in the sheet.
  function candidateTags(filter) {
    const seen = new Set();
    const out = [];
    const push = name => {
      const k = name.toLowerCase();
      if (seen.has(k)) return;
      if (filter && !k.includes(filter.toLowerCase())) return;
      seen.add(k);
      out.push(name);
    };
    recentTags.forEach(push);
    tagList.forEach(t => push(t.name));
    return out;
  }

  // ---- UI ----------------------------------------------------------------
  const PANEL_ID = 'sps-panel';
  const style = document.createElement('style');
  style.textContent = `
    .${BTN_CLASS}{display:inline-flex;align-items:center;justify-content:center;
      min-width:34px;height:34px;margin-left:4px;padding:0 6px;border:0;border-radius:999px;
      background:transparent;cursor:pointer;font:600 15px/1 system-ui,sans-serif;
      color:inherit;opacity:.7;-webkit-tap-highlight-color:transparent;flex:0 0 auto;
      user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:manipulation}
    .${BTN_CLASS}:hover{opacity:1;background:rgba(29,155,240,.12)}
    .${BTN_CLASS}[data-state="saved"]{opacity:1;color:rgb(0,186,124)}
    .${BTN_CLASS}[data-state="busy"]{opacity:.4}
    .${BTN_CLASS} .sps-n{font-size:11px;margin-left:2px}
    #${PANEL_ID}{position:fixed;z-index:2147483646;width:min(300px,92vw);box-sizing:border-box;
      padding:8px;border-radius:10px;background:rgba(30,30,36,.97);color:#fff;
      box-shadow:0 4px 18px rgba(0,0,0,.45);font:500 13px/1.3 system-ui,sans-serif}
    #${PANEL_ID} .sps-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:12px;opacity:.8}
    #${PANEL_ID} .sps-head span{flex:1}
    #${PANEL_ID} .sps-chips{display:flex;flex-wrap:wrap;gap:6px;max-height:132px;overflow:auto}
    #${PANEL_ID} .sps-chip{border:1px solid rgba(255,255,255,.28);background:transparent;color:#fff;
      border-radius:999px;padding:5px 10px;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
    #${PANEL_ID} .sps-chip:hover{background:rgba(255,255,255,.12)}
    #${PANEL_ID} .sps-chip[data-on="1"]{background:rgb(0,186,124);border-color:rgb(0,186,124)}
    #${PANEL_ID} .sps-chip.sps-new{border-style:dashed}
    #${PANEL_ID} input{width:100%;box-sizing:border-box;margin-top:7px;padding:6px 8px;border-radius:6px;
      border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font:inherit;outline:none}
    #${PANEL_ID} .sps-empty{opacity:.6;font-size:12px}`;
  document.documentElement.appendChild(style);

  function setState(btn, state) {
    btn.dataset.state = state;
    const n = (postTags[btn.dataset.key] || []).length;
    btn.textContent = state === 'saved' ? '✓' : state === 'busy' ? '…' : '📌';
    if (state === 'saved' && n) {
      const badge = document.createElement('span');
      badge.className = 'sps-n';
      badge.textContent = '#' + n;
      btn.appendChild(badge);
    }
    btn.title = state === 'saved'
      ? '保存済み' + (n ? '（' + postTags[btn.dataset.key].join(', ') + '）' : '') + ' — 押すと数値を更新 / ホバーでタグ'
      : '投稿を保存（ホバー・長押しでタグを付けて保存）';
  }

  function refreshButtons(key) {
    document.querySelectorAll('.' + BTN_CLASS).forEach(b => {
      if (b.dataset.key === key && b.dataset.state !== 'busy') setState(b, savedKeys.has(key) ? 'saved' : 'idle');
    });
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
        if (panel.btn === existing) closePanel();
      }
      return;
    }
    row.appendChild(makeButton(extract, key));
  }

  const HOVER_OPEN_MS = 350;
  const HOVER_CLOSE_MS = 350;
  const LONG_PRESS_MS = 450;
  const AUTO_CLOSE_MS = 5000;
  const panel = { el: null, btn: null, parts: null, openTimer: 0, closeTimer: 0, autoTimer: 0, touched: false };

  function makeButton(extract, key) {
    const btn = document.createElement('button');
    btn._extract = extract;
    btn.dataset.key = key;
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute('aria-label', '投稿を保存');
    setState(btn, key && savedKeys.has(key) ? 'saved' : 'idle');

    let pressTimer = 0;
    let longPressed = false;
    // Stop the tap from opening the post.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'touchend']) {
      btn.addEventListener(type, e => e.stopPropagation());
    }
    btn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('pointerdown', e => {
      longPressed = false;
      if (e.pointerType === 'mouse') return;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { longPressed = true; openPanel(btn, false); }, LONG_PRESS_MS);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      btn.addEventListener(type, () => clearTimeout(pressTimer));
    }
    btn.addEventListener('pointerenter', e => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(panel.closeTimer);
      clearTimeout(panel.openTimer);
      panel.openTimer = setTimeout(() => openPanel(btn, false), HOVER_OPEN_MS);
    });
    btn.addEventListener('pointerleave', e => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(panel.openTimer);
      scheduleClose();
    });
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (longPressed) { longPressed = false; return; } // the long press opened the panel
      const touch = event.pointerType ? event.pointerType !== 'mouse' : Boolean(window.matchMedia && window.matchMedia('(hover: none)').matches);
      void run(btn, { save: true }).then(ok => {
        // No hover on touch screens: offer the tags right after a tap-save.
        if (ok && touch) openPanel(btn, true);
      });
    });
    return btn;
  }

  function scheduleClose() {
    clearTimeout(panel.closeTimer);
    panel.closeTimer = setTimeout(() => {
      const input = panel.el && panel.el.querySelector('input');
      if (input && document.activeElement === input && input.value) return;
      closePanel();
    }, HOVER_CLOSE_MS);
  }

  function closePanel() {
    clearTimeout(panel.closeTimer);
    clearTimeout(panel.autoTimer);
    if (panel.el) panel.el.remove();
    panel.el = null;
    panel.btn = null;
    panel.parts = null;
  }

  function openPanel(btn, auto) {
    if (!btn.isConnected) return;
    if (panel.btn !== btn) closePanel();
    panel.btn = btn;
    panel.touched = false;
    if (!panel.el) {
      const el = document.createElement('div');
      el.id = PANEL_ID;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'touchstart', 'touchend']) {
        el.addEventListener(type, e => {
          e.stopPropagation();
          panel.touched = true;
          clearTimeout(panel.autoTimer);
        });
      }
      el.addEventListener('pointerenter', () => clearTimeout(panel.closeTimer));
      el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') scheduleClose(); });
      buildPanel(el);
      document.documentElement.appendChild(el);
      panel.el = el;
    }
    renderPanel();
    positionPanel();
    clearTimeout(panel.autoTimer);
    if (auto) panel.autoTimer = setTimeout(() => { if (!panel.touched) closePanel(); }, AUTO_CLOSE_MS);
    void refreshTagList(false);
  }

  function positionPanel() {
    if (!panel.el || !panel.btn) return;
    const r = panel.btn.getBoundingClientRect();
    const w = panel.el.offsetWidth;
    const h = panel.el.offsetHeight;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const top = r.top - h - 6 >= 8 ? r.top - h - 6 : Math.min(r.bottom + 6, window.innerHeight - h - 8);
    panel.el.style.left = left + 'px';
    panel.el.style.top = top + 'px';
  }

  function buildPanel(el) {
    const head = document.createElement('div');
    head.className = 'sps-head';
    const title = document.createElement('span');
    head.appendChild(title);
    const chips = document.createElement('div');
    chips.className = 'sps-chips';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '絞り込み / 新しいタグ（Enterで追加）';
    input.enterKeyHint = 'done';
    input.addEventListener('keydown', e => {
      e.stopPropagation(); // keep X / Threads shortcuts (j, k, l …) out of the way
      if (e.key === 'Escape') { closePanel(); return; }
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const tag = cleanTag(input.value);
      if (!tag || !panel.btn) return;
      const on = (postTags[panel.btn.dataset.key] || []).some(t => t.toLowerCase() === tag.toLowerCase());
      input.value = '';
      toggleTag(panel.btn, tag, on);
    });
    for (const type of ['keyup', 'keypress']) input.addEventListener(type, e => e.stopPropagation());
    input.addEventListener('input', () => { renderPanel(); positionPanel(); });
    el.append(head, chips, input);
    panel.parts = { title, chips, input };
  }

  // Only the title and chips are redrawn, so typing (and IME) is never interrupted.
  function renderPanel() {
    const btn = panel.btn;
    if (!panel.el || !btn || !panel.parts) return;
    const { title, chips, input } = panel.parts;
    const key = btn.dataset.key;
    const saved = savedKeys.has(key);
    const current = postTags[key] || [];
    const filter = input.value.trim().toLowerCase();

    title.textContent = btn.dataset.state === 'busy' ? '保存中…'
      : saved ? '保存済み · タップでタグ切替' : 'タグを選ぶとそのまま保存';
    chips.textContent = '';
    const names = [...current, ...candidateTags('')]
      .filter((t, i, a) => a.findIndex(x => x.toLowerCase() === t.toLowerCase()) === i)
      .filter(t => !filter || t.toLowerCase().includes(filter))
      .slice(0, MAX_CHIPS);
    for (const name of names) {
      const on = current.some(t => t.toLowerCase() === name.toLowerCase());
      chips.appendChild(chip(name, on, () => toggleTag(btn, name, on)));
    }
    const typed = cleanTag(input.value);
    if (typed && !names.some(t => t.toLowerCase() === typed.toLowerCase())) {
      const c = chip('＋ ' + typed, false, () => { input.value = ''; toggleTag(btn, typed, false); });
      c.classList.add('sps-new');
      chips.appendChild(c);
    }
    if (!chips.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'sps-empty';
      empty.textContent = 'まだタグがありません。下に入力して追加';
      chips.appendChild(empty);
    }
  }

  function chip(label, on, onTap) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'sps-chip';
    c.dataset.on = on ? '1' : '0';
    c.textContent = label;
    c.addEventListener('click', e => { e.preventDefault(); onTap(); });
    return c;
  }

  function toggleTag(btn, tag, on) {
    useTag(tag);
    const key = btn.dataset.key;
    if (btn.dataset.state === 'busy' && !savedKeys.has(key)) {
      // A tap-save is still in flight: tag it once that has finished.
      void run(btn, { addTags: [tag] });
    } else if (!savedKeys.has(key)) {
      void run(btn, { save: true, addTags: [tag] });
    } else {
      // Optimistic update; the server's answer replaces it (or it is rolled back).
      const prev = postTags[key] || [];
      setPostTags(key, on ? prev.filter(t => t.toLowerCase() !== tag.toLowerCase()) : [...prev, tag]);
      refreshButtons(key);
      void run(btn, on ? { removeTags: [tag], prev } : { addTags: [tag], prev });
    }
    renderPanel();
    positionPanel();
  }

  window.addEventListener('scroll', e => {
    if (!panel.el || panel.el.contains(e.target)) return;
    const input = panel.el.querySelector('input');
    if (input && document.activeElement === input) positionPanel();
    else closePanel();
  }, { passive: true, capture: true });
  document.addEventListener('pointerdown', e => {
    if (panel.el && !panel.el.contains(e.target) && !(panel.btn && panel.btn.contains(e.target))) closePanel();
  }, true);

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
  // Operations on one button run one after another (tap, then tag chips…).
  function run(btn, op) {
    const next = (btn._chain || Promise.resolve()).then(() => (op.save ? save(btn, op) : retag(btn, op)));
    btn._chain = next.catch(() => {});
    return next;
  }

  async function save(btn, { addTags = [] } = {}) {
    let url = getWebAppUrl();
    if (!url) {
      if (!promptWebAppUrl()) return false;
      url = getWebAppUrl();
    }
    let post;
    try {
      post = btn._extract();
    } catch (error) {
      console.warn('[SNS Post Stock] extract failed:', error);
    }
    if (!post) {
      toast('投稿の情報を読み取れませんでした', 'error');
      return false;
    }
    post.savedFrom = location.href;
    post.clientSavedAt = new Date().toISOString();
    post.scriptVersion = VERSION;
    post.userAgent = navigator.userAgent;
    if (addTags.length) post.addTags = addTags;

    const before = btn.dataset.state;
    setState(btn, 'busy');
    if (panel.btn === btn) renderPanel();
    try {
      const result = await postJson(url, post);
      if (!result?.ok) throw new Error(result?.error || 'unknown error');
      const key = post.platform + ':' + post.postId;
      markSaved(key);
      btn.dataset.key = key;
      if (Array.isArray(result.tags)) setPostTags(key, result.tags);
      setState(btn, 'saved');
      refreshButtons(key);
      if (panel.btn === btn) { renderPanel(); positionPanel(); }
      const tagText = addTags.length ? ' #' + addTags.join(' #') : '';
      toast(result.duplicate
        ? '更新しました（' + result.count + '回目）' + tagText + (post.truncated ? ' ※本文は省略表示' : '')
        : '保存しました: ' + post.author.handle + tagText + (post.truncated ? '（本文は省略表示。詳細画面で保存すると全文）' : ''));
      return true;
    } catch (error) {
      console.warn('[SNS Post Stock] save failed:', error);
      setState(btn, before === 'saved' ? 'saved' : 'idle');
      if (panel.btn === btn) renderPanel();
      toast('保存できませんでした（' + error.message + '）', 'error');
      return false;
    }
  }

  async function retag(btn, { addTags = [], removeTags = [], prev = null }) {
    const url = getWebAppUrl();
    const [platform, ...rest] = (btn.dataset.key || '').split(':');
    const postId = rest.join(':');
    if (!url || !postId) return false;
    try {
      const result = await postJson(url, { action: 'tag', platform, postId, addTags, removeTags });
      if (!result?.ok) throw new Error(result?.error || 'unknown error');
      setPostTags(btn.dataset.key, result.tags || []);
      refreshButtons(btn.dataset.key);
      if (panel.btn === btn) { renderPanel(); positionPanel(); }
      toast(addTags.length ? 'タグを追加: #' + addTags.join(' #') : 'タグを外しました: #' + removeTags.join(' #'));
      return true;
    } catch (error) {
      console.warn('[SNS Post Stock] tag failed:', error);
      if (prev) {
        setPostTags(btn.dataset.key, prev);
        refreshButtons(btn.dataset.key);
        if (panel.btn === btn) renderPanel();
      }
      toast('タグを更新できませんでした（' + error.message + '）', 'error');
      void refreshTagList(true);
      return false;
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
