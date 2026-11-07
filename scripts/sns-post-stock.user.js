// ==UserScript==
// @name         SNS Post Stock (X / Threads)
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.2.0
// @description  One tap on 📌 saves X / Threads posts directly to a Notion database (text, author, metrics, media, links and tags).
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
// @connect      api.notion.com
// @noframes
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/sns-post-stock.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/sns-post-stock.user.js
// ==/UserScript==

/*
 * Direct receiver: Notion API (no Google Apps Script / Sheets intermediary).
 * The integration token is stored only in Violentmonkey's local script storage;
 * it is never embedded in this source file or committed to the repository.
 */
(() => {
  'use strict';

  const VERSION = '1.2.0';

  // ---- Settings / Notion API ---------------------------------------------
  const TOKEN_KEY = 'notionApiToken';
  const DATABASE_ID = 'a94abaa6-d2c8-4152-8c42-aa4f3c08c4f5';
  const DATA_SOURCE_ID = '5582b90f-2cb8-40f5-8656-a1c7fbc37b38';
  const NOTION_VERSION = '2026-03-11';
  const SAVED_KEY = 'savedKeys';
  const MAX_SAVED_KEYS = 5000;
  const BTN_CLASS = 'sps-btn';
  const TOAST_ID = 'sps-toast';
  const IS_X = /(^|\.)(x|twitter)\.com$/.test(location.hostname);

  function getNotionToken() {
    return String(GM_getValue(TOKEN_KEY, '') || '').trim();
  }

  function promptNotionToken() {
    const value = window.prompt(
      'Notion API integration token を入力してください（このブラウザのViolentmonkey内だけに保存されます）',
      getNotionToken()
    );
    if (value === null) return false;
    const token = value.trim();
    if (token && !/^(ntn_|secret_)[A-Za-z0-9_-]{20,}$/.test(token)) {
      toast('Notion API token の形式を確認してください', 'error');
      return false;
    }
    GM_setValue(TOKEN_KEY, token);
    toast(token ? 'Notion token をローカル設定に保存しました' : 'Notion token を削除しました');
    return Boolean(token);
  }

  GM_registerMenuCommand('投稿ストック: Notion API token を設定', promptNotionToken);
  GM_registerMenuCommand('投稿ストック: Notion API token を削除', () => {
    GM_setValue(TOKEN_KEY, '');
    toast('Notion token をローカル設定から削除しました');
  });

  let savedKeys = new Set(GM_getValue(SAVED_KEY, []));
  function markSaved(key) {
    savedKeys.delete(key);
    savedKeys.add(key);
    const list = [...savedKeys].slice(-MAX_SAVED_KEYS);
    savedKeys = new Set(list);
    GM_setValue(SAVED_KEY, list);
  }

  function notionRequest(method, path, payload) {
    const token = getNotionToken();
    if (!token) return Promise.reject(new Error('Notion API token が未設定です。メニューから設定してください'));
    return new Promise((resolve, reject) => {
      const options = {
        method,
        url: 'https://api.notion.com/v1' + path,
        timeout: 25000,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
        onload: res => {
          let body;
          try { body = JSON.parse(String(res.responseText || '{}')); }
          catch { reject(new Error('Notion API の応答をJSONとして読めませんでした（HTTP ' + res.status + '）')); return; }
          if (res.status < 200 || res.status >= 300) {
            const code = body.code ? ' [' + body.code + ']' : '';
            let message = body.message || ('HTTP ' + res.status);
            if (res.status === 401) message = 'Notion API token が無効です。tokenを再設定してください';
            if (res.status === 403) message = 'Notion integration にデータベースのアクセス権がありません。SNS Post Archive の「Add connections」で該当integrationを追加してください';
            if (res.status === 404) message = 'Notion database が見つからないか、integrationに共有されていません。データベースの共有設定を確認してください';
            reject(new Error(message + code));
            return;
          }
          resolve(body);
        },
        onerror: () => reject(new Error('Notion API への通信に失敗しました')),
        ontimeout: () => reject(new Error('Notion API がタイムアウトしました'))
      };
      if (payload !== undefined) options.data = JSON.stringify(payload);
      GM_xmlhttpRequest(options);
    });
  }

  GM_registerMenuCommand('投稿ストック: Notion 接続テスト', async () => {
    if (!getNotionToken() && !promptNotionToken()) return;
    toast('Notion 接続テスト中…');
    try {
      const result = await notionRequest('GET', '/data_sources/' + DATA_SOURCE_ID);
      toast('Notion接続OK：' + (result.title?.[0]?.plain_text || 'SNS Post Archive'));
    } catch (error) {
      toast('Notion接続NG：' + error.message, 'error');
    }
  });

  // ---- Notion data helpers ------------------------------------------------
  function richText(value) {
    const text = String(value ?? '');
    if (!text) return [];
    const chunks = [];
    let chunk = '';
    for (const char of text) {
      if (chunk.length + char.length > 1800) {
        if (chunks.length < 100) chunks.push({ type: 'text', text: { content: chunk } });
        chunk = '';
      }
      if (chunks.length >= 100) break;
      chunk += char;
    }
    if (chunk && chunks.length < 100) chunks.push({ type: 'text', text: { content: chunk } });
    return chunks;
  }

  function readRichText(prop) {
    return Array.isArray(prop?.rich_text)
      ? prop.rich_text.map(part => part.plain_text ?? part.text?.content ?? '').join('')
      : '';
  }

  function readDate(prop) {
    return prop?.date?.start || '';
  }

  function readNumber(prop, fallback = 0) {
    return typeof prop?.number === 'number' ? prop.number : fallback;
  }

  function parseJsonText(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; }
    catch { return fallback; }
  }

  function cleanNotionDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function postTitle(post) {
    const author = String(post.author?.name || post.author?.handle || 'Unknown');
    const body = String(post.text || post.rawText || '').replace(/\s+/g, ' ').trim();
    return (author + ' — ' + (body || post.postId || 'SNS post')).slice(0, 180);
  }

  function platformLabel(platform) {
    return String(platform || '').toLowerCase() === 'threads' ? 'Threads' : 'X';
  }

  function queryByPostKey(key) {
    return notionRequest('POST', '/data_sources/' + DATA_SOURCE_ID + '/query', {
      filter: { property: 'Post Key', rich_text: { equals: key } },
      page_size: 1
    }).then(result => result.results?.[0] || null);
  }

  function mergePostTags(current, add, remove) {
    const tags = [...(current || [])];
    const has = tag => tags.some(item => item.toLowerCase() === tag.toLowerCase());
    (add || []).map(cleanTag).filter(Boolean).forEach(tag => { if (!has(tag)) tags.push(tag); });
    const drop = (remove || []).map(tag => cleanTag(tag).toLowerCase());
    return tags.filter(tag => !drop.includes(tag.toLowerCase())).slice(0, 100);
  }

  function buildNotionProperties(record) {
    const metrics = record.metrics || {};
    const snapshots = record.snapshots || [];
    const payloadText = JSON.stringify(record);
    const clippedPayload = payloadText.length > 170000 ? payloadText.slice(0, 170000) : payloadText;
    const savedFrom = /^https?:\/\//i.test(String(record.savedFrom || '')) ? record.savedFrom : null;
    const postUrl = /^https?:\/\//i.test(String(record.url || '')) ? record.url : null;
    const title = postTitle(record);
    const date = value => {
      const start = cleanNotionDate(value);
      return { date: start ? { start } : null };
    };
    const number = value => ({ number: typeof value === 'number' && Number.isFinite(value) ? value : null });
    return {
      'Name': { title: [{ type: 'text', text: { content: title } }] },
      'Post Key': { rich_text: richText(record.platform + ':' + record.postId) },
      'Platform': { select: { name: platformLabel(record.platform) } },
      'Post URL': { url: postUrl },
      'Author Name': { rich_text: richText(record.author?.name || '') },
      'Handle': { rich_text: richText(record.author?.handle || '') },
      'Author ID': { rich_text: richText(record.author?.id || '') },
      'Text': { rich_text: richText(record.text || record.rawText || '') },
      'Created At': date(record.createdAt),
      'Likes': number(metrics.likes),
      'Reposts': number(metrics.reposts),
      'Replies': number(metrics.replies),
      'Quotes': number(metrics.quotes),
      'Bookmarks': number(metrics.bookmarks),
      'Views': number(metrics.views),
      'Shares': number(metrics.shares),
      'Media Count': number((record.media || []).length),
      'Media JSON': { rich_text: richText(JSON.stringify(record.media || [])) },
      'Links JSON': { rich_text: richText(JSON.stringify(record.links || [])) },
      'Saved From': { url: savedFrom },
      'First Saved At': date(record.firstSavedAt),
      'Last Saved At': date(record.lastSavedAt),
      'Save Count': number(record.saveCount || 1),
      'Tags': { multi_select: (record.tags || []).map(name => ({ name })) },
      'Memo': { rich_text: richText(record.memo || '') },
      'Metrics History': { rich_text: richText(JSON.stringify(snapshots)) },
      'Full Payload': { rich_text: richText(clippedPayload) },
      'Truncated': { checkbox: Boolean(record.truncated) }
    };
  }

  function tagsFromPage(page) {
    return (page?.properties?.Tags?.multi_select || []).map(item => item.name).filter(Boolean);
  }

  function countTagsFromPages(pages) {
    const counts = new Map();
    for (const page of pages) {
      for (const tag of tagsFromPage(page)) {
        const key = tag.toLowerCase();
        const item = counts.get(key) || { name: tag, count: 0 };
        item.count += 1;
        counts.set(key, item);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  async function fetchTagList() {
    const pages = [];
    let cursor = '';
    for (let page = 0; page < 10; page += 1) {
      const body = { page_size: 100, sorts: [{ property: 'Last Saved At', direction: 'descending' }] };
      if (cursor) body.start_cursor = cursor;
      const result = await notionRequest('POST', '/data_sources/' + DATA_SOURCE_ID + '/query', body);
      pages.push(...(result.results || []));
      if (!result.has_more || !result.next_cursor) break;
      cursor = result.next_cursor;
    }
    return countTagsFromPages(pages);
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

  // ---- Tags (local cache) ------------------------------------------------
  const POST_TAGS_KEY = 'postTags';   // { "x:123": ["tag", …] } for saved posts
  const TAG_LIST_KEY = 'tagList';     // [{ name, count }] cached from Notion
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
    if (!getNotionToken() || (!force && Date.now() - tagListFetchedAt < TAG_LIST_TTL)) return;
    tagListFetchedAt = Date.now();
    try {
      const tags = await fetchTagList();
      tagList = tags;
      GM_setValue(TAG_LIST_KEY, tagList);
      if (panel.btn) renderPanel();
    } catch (error) {
      console.warn('[SNS Post Stock] tag list failed:', error);
    }
  }

  // Recently used first, then the most used ones in Notion.
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
    if (!getNotionToken() && !promptNotionToken()) return false;
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

    const before = btn.dataset.state;
    setState(btn, 'busy');
    if (panel.btn === btn) renderPanel();
    try {
      const key = post.platform + ':' + post.postId;
      const existing = await queryByPostKey(key);
      const now = new Date().toISOString();
      const props = existing?.properties || {};
      const previousPayload = parseJsonText(readRichText(props['Full Payload']), {});
      const previousText = readRichText(props['Text']);
      const previousTags = tagsFromPage(existing);
      const previousMemo = readRichText(props['Memo']);
      const oldCount = readNumber(props['Save Count'], 1);
      const firstSavedAt = readDate(props['First Saved At']) || existing?.created_time || now;
      const previousSnapshots = parseJsonText(readRichText(props['Metrics History']), previousPayload.snapshots || []);
      const snapshots = [...(Array.isArray(previousSnapshots) ? previousSnapshots : []),
        { at: now, metrics: post.metrics || {} }].slice(-30);
      const count = existing ? oldCount + 1 : 1;
      const tags = mergePostTags(previousTags, addTags, []);
      const record = Object.assign({}, post, {
        firstSavedAt,
        lastSavedAt: now,
        saveCount: count,
        snapshots,
        tags,
        memo: previousMemo
      });

      // Keep an earlier full-text capture when a new timeline capture is truncated.
      if (post.truncated && previousText && previousText.length > String(post.text || '').length) {
        record.text = previousText;
        record.truncated = Boolean(props.Truncated?.checkbox);
        if (previousPayload.rawText) record.rawText = previousPayload.rawText;
      }

      const properties = buildNotionProperties(record);
      let result;
      if (existing) {
        result = await notionRequest('PATCH', '/pages/' + existing.id, { properties });
      } else {
        result = await notionRequest('POST', '/pages', {
          parent: { database_id: DATABASE_ID },
          properties
        });
      }

      markSaved(key);
      btn.dataset.key = key;
      setPostTags(key, tags);
      setState(btn, 'saved');
      refreshButtons(key);
      if (panel.btn === btn) { renderPanel(); positionPanel(); }
      const tagText = addTags.length ? ' #' + addTags.join(' #') : '';
      toast(existing
        ? 'Notionを更新しました（' + count + '回目）' + tagText + (post.truncated ? ' ※本文は省略表示' : '')
        : 'Notionに保存しました: ' + (post.author?.handle || post.author?.name || '投稿') + tagText + (post.truncated ? '（本文は省略表示。詳細画面で保存すると全文）' : ''));
      return Boolean(result?.id);
    } catch (error) {
      console.warn('[SNS Post Stock] save failed:', error);
      setState(btn, before === 'saved' ? 'saved' : 'idle');
      if (panel.btn === btn) renderPanel();
      toast('Notionに保存できませんでした（' + error.message + '）', 'error');
      return false;
    }
  }

  async function retag(btn, { addTags = [], removeTags = [], prev = null } = {}) {
    const [platform, ...rest] = (btn.dataset.key || '').split(':');
    const postId = rest.join(':');
    if (!postId || !getNotionToken()) return false;
    try {
      const page = await queryByPostKey(platform + ':' + postId);
      if (!page) throw new Error('Notionに対象投稿が見つかりません');
      const tags = mergePostTags(tagsFromPage(page), addTags, removeTags);
      await notionRequest('PATCH', '/pages/' + page.id, {
        properties: { 'Tags': { multi_select: tags.map(name => ({ name })) } }
      });
      setPostTags(btn.dataset.key, tags);
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
