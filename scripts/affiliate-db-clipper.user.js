// ==UserScript==
// @name         Affiliate DB Clipper (Amazon / Rakuten → Free Consult)
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.1.0
// @description  One tap on an Amazon.co.jp / Rakuten Ichiba product page (or the Rakuten Affiliate link-creation page) adds the product to the Free Consult catalog in Affiliate Operator Firestore (amazon_products / rakuten_products) via the Worker REST API.
// @author       nomuonji
// @match        https://www.amazon.co.jp/*
// @match        https://amazon.co.jp/*
// @match        https://item.rakuten.co.jp/*
// @match        https://affiliate.rakuten.co.jp/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      consult.antonbase.com
// @noframes
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/affiliate-db-clipper.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/affiliate-db-clipper.user.js
// ==/UserScript==

/*
 * Destination (source of truth per nomuonji/free-consult-blog AGENTS.md):
 *   POST https://consult.antonbase.com/api/affiliate-intelligence
 *     Amazon  {action:'save_amazon_product'}  → Firestore `amazon_products`
 *     Rakuten {action:'save_rakuten_product'} → Firestore `rakuten_products`
 *   Same validation and revision checks as /intelligence/products/ and /intelligence/rakuten/.
 * Image policy (free-consult-blog docs/SOCIAL_PRODUCT_IMAGE_USAGE.md):
 *   Amazon: no image URLs are stored (page scraping is not the licensed API and
 *           stored image URLs are limited to 24h). Rakuten: images only from the
 *           Rakuten Affiliate link-creation page, never from the item page.
 * The admin token is kept only in Violentmonkey's script storage, never in this repo.
 */
(() => {
  'use strict';

  const VERSION = '1.1.0';
  const API = 'https://consult.antonbase.com/api/affiliate-intelligence';
  const K = {
    adminToken: 'adminToken',
    associateTag: 'associateTag',
    categories: 'recentCategories',
    lastCategory: 'lastCategory',
    saved: 'savedKeys'
  };
  const DEFAULT_CATEGORIES = [
    'そのほか', 'デスク周り', 'インテリア', 'テーブルウェア', '掃除・暮らし', '推し活',
    '美容・身だしなみ', 'ユニーク雑貨', '文房具', '防災', 'キッチン・生活', '家電・季節用品',
    '美容・スキンケア', '美容家電', 'ペット用品', 'ゲーム・趣味'
  ];
  const SHELVES = [['odd', '変な商品'], ['useful', '便利な商品']];
  const ROOT_ID = 'adc-root';
  const host = location.hostname;
  const IS_AMAZON = /(^|\.)amazon\.co\.jp$/.test(host);
  const IS_RAKUTEN = host === 'item.rakuten.co.jp';
  const IS_RAKUTEN_AFFILIATE = host === 'affiliate.rakuten.co.jp';

  // ---- Small helpers -----------------------------------------------------
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const getSaved = () => GM_getValue(K.saved, {}) || {};
  function markSaved(key, value) {
    const saved = getSaved();
    if (value) saved[key] = value; else delete saved[key];
    const keys = Object.keys(saved);
    if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete saved[k];
    GM_setValue(K.saved, saved);
  }
  function rememberCategory(category) {
    if (!category) return;
    const list = [category, ...(GM_getValue(K.categories, []) || []).filter(c => c !== category)].slice(0, 20);
    GM_setValue(K.categories, list);
    GM_setValue(K.lastCategory, category);
  }
  const categoryOptions = () => [...new Set([...(GM_getValue(K.categories, []) || []), ...DEFAULT_CATEGORIES])];
  const defaultCategory = () => GM_getValue(K.lastCategory, '') || 'そのほか';

  function request({ method, url, headers = {}, body }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, timeout: 25000, headers,
        data: body === undefined ? undefined : JSON.stringify(body),
        onload: res => {
          let json = null;
          try { json = JSON.parse(res.responseText || 'null'); } catch { /* not JSON */ }
          resolve({ status: res.status, json });
        },
        onerror: () => reject(new Error('通信エラー')),
        ontimeout: () => reject(new Error('タイムアウト'))
      });
    });
  }

  // ---- Token settings (password-style input, never logged) ---------------
  function askSecret(title, help) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
      const box = document.createElement('form');
      box.style.cssText = 'background:#fff;color:#16382c;max-width:420px;width:90vw;padding:18px;border-radius:10px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 6px 30px rgba(0,0,0,.35)';
      const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'font-weight:700;margin-bottom:6px';
      const p = document.createElement('div'); p.textContent = help; p.style.cssText = 'font-size:12px;color:#546b60;margin-bottom:10px';
      const input = document.createElement('input');
      input.type = 'password'; input.autocomplete = 'off'; input.placeholder = '空で保存すると削除';
      input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;border:1px solid #c5d3ca;border-radius:6px';
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'キャンセル';
      const ok = document.createElement('button'); ok.type = 'submit'; ok.textContent = '保存';
      for (const b of [cancel, ok]) b.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid #24553f;cursor:pointer;background:' + (b === ok ? '#24553f;color:#fff' : '#fff;color:#24553f');
      row.append(cancel, ok); box.append(h, p, input, row); wrap.append(box);
      document.documentElement.append(wrap);
      input.focus();
      const done = v => { wrap.remove(); resolve(v); };
      cancel.onclick = () => done(null);
      box.onsubmit = e => { e.preventDefault(); done(input.value.trim()); };
    });
  }
  async function ensureSecret(key, title, help) {
    let v = String(GM_getValue(key, '') || '');
    if (v) return v;
    v = await askSecret(title, help);
    if (!v) return '';
    GM_setValue(key, v);
    return v;
  }
  const ADMIN_HELP = 'Free Consult 管理画面（/intelligence/）で使っている管理者トークン（Cloudflareの AFFILIATE_INTELLIGENCE_ADMIN_TOKEN）。このブラウザのViolentmonkeyにだけ保存されます。';
  const adminToken = () => ensureSecret(K.adminToken, 'アフィDB: 管理者トークン', ADMIN_HELP);

  // ---- Amazon ------------------------------------------------------------
  function amazonAsin() {
    const m = location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN|o\/ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    const fromUrl = m && m[1].toUpperCase();
    const fromInput = document.querySelector('input#ASIN, input[name="ASIN"]')?.value?.toUpperCase();
    const asin = fromUrl || fromInput || '';
    return /^[A-Z0-9]{10}$/.test(asin) ? asin : '';
  }
  function amazonExtract() {
    const asin = amazonAsin();
    if (!asin) return null;
    let title = clean(document.querySelector('#productTitle, #title, #ebooksProductTitle')?.textContent);
    if (!title) title = clean(document.querySelector('meta[name="title"]')?.content).replace(/^Amazon\.co\.jp[:：]\s*/, '').replace(/\s*[:：]\s*[^:：]*$/, '');
    if (!title) return null;
    const crumbs = [...document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a, #wayfinding-breadcrumbs_container a')]
      .map(a => clean(a.textContent)).filter(Boolean);
    const url = 'https://www.amazon.co.jp/dp/' + asin;
    return { asin, title: title.slice(0, 180), crumbs, url };
  }
  function amazonPayload(data, edits) {
    const tag = String(GM_getValue(K.associateTag, '') || '').trim();
    const product = {
      asin: data.asin,
      title: data.title,
      category: edits.category || 'そのほか',
      summary: edits.summary || '',
      sourceUrl: data.url,
      status: edits.status || 'draft',
      notes: ('Affiliate DB Clipper v' + VERSION + ' で ' + todayJst() + ' にAmazon商品ページから登録。'
        + (data.crumbs.length ? ' Amazonカテゴリ: ' + data.crumbs.join(' > ') : '')).slice(0, 2000),
      editorialShelves: edits.shelves || []
    };
    if (edits.catalogId) product.catalogId = edits.catalogId;
    if (/^[a-z0-9-]{2,50}-22$/.test(tag)) product.affiliateUrl = data.url + '?tag=' + tag;
    return product;
  }
  const AMAZON_ERRORS = {
    unauthorized: '管理者トークンが違います（メニューから再設定）',
    conflict: 'ほかの編集と競合しました。もう一度押してください',
    invalid_product: '入力値が不正です（タイトル・カテゴリ・共通商品ID等）',
    invalid_affiliate_url: 'アソシエイトタグの形式が不正です',
    amazon_catalog_backend_unavailable: 'Firestoreに接続できません（Worker側の障害）'
  };
  async function amazonApi(method, query, body) {
    const token = await adminToken();
    if (!token) throw new Error('管理者トークンが未設定です');
    const res = await request({
      method, url: API + (query ? '?' + query : ''), body,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    });
    if (res.status === 401) GM_setValue(K.adminToken, '');
    if (res.status < 200 || res.status >= 300) {
      const code = res.json?.error || 'HTTP ' + res.status;
      throw new Error(AMAZON_ERRORS[code] || code);
    }
    return res.json;
  }
  const Amazon = {
    key: d => 'amazon:' + d.asin,
    async load(d) {
      const r = await amazonApi('GET', 'collection=amazon_products&id=' + encodeURIComponent(d.asin));
      return r?.item || null;
    },
    async create(d) {
      const edits = { category: defaultCategory(), shelves: [] };
      const r = await amazonApi('POST', '', { action: 'save_amazon_product', product: amazonPayload(d, edits) });
      return r.item;
    },
    async update(d, existing, edits) {
      const product = { asin: d.asin, title: edits.title, category: edits.category, summary: edits.summary,
        editorialShelves: edits.shelves, status: edits.status };
      if (edits.catalogId) product.catalogId = edits.catalogId;
      const r = await amazonApi('POST', '', { action: 'save_amazon_product', product,
        expectedUpdateTime: existing._updateTime });
      return r.item;
    },
    statuses: [['draft', '下書き'], ['published', '公開'], ['archived', '保管']],
    adminUrl: 'https://consult.antonbase.com/intelligence/products/'
  };

  // ---- Rakuten (Firestore rakuten_products via the Worker) ----------------
  const canonicalItem = raw => {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || u.hostname !== 'item.rakuten.co.jp') return '';
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
      return m ? 'https://item.rakuten.co.jp/' + m[1] + '/' + m[2] + '/' : '';
    } catch { return ''; }
  };
  const rakutenId = url => {
    const m = url.match(/^https:\/\/item\.rakuten\.co\.jp\/([^/]+)\/([^/]+)\/$/);
    return m ? slug('rakuten-' + decodeURIComponent(m[1]) + '-' + decodeURIComponent(m[2])).slice(0, 110).replace(/-+$/, '') : '';
  };
  function rakutenExtract() {
    if (!IS_RAKUTEN) return null;
    const url = canonicalItem(location.href);
    if (!url || /^\/(event|search|review)\//.test(location.pathname)) return null;
    let title = clean(document.querySelector('.normal_reserve_item_name, .item_name, [class*="item-name"]')?.textContent);
    if (!title) {
      title = clean(document.querySelector('meta[property="og:title"]')?.content || document.title)
        .replace(/^【楽天市場】\s*/, '').replace(/\s*[:：][^:：]*$/, '');
    }
    if (!title) return null;
    const siteName = clean(document.querySelector('meta[property="og:site_name"]')?.content);
    return { kind: 'item', id: rakutenId(url), url, title: title.slice(0, 180),
      shopName: siteName && siteName !== '楽天市場' ? siteName : '' };
  }
  // Rakuten Affiliate "link creation" page: read the generated link HTML.
  // Images are taken ONLY from here (docs/SOCIAL_PRODUCT_IMAGE_USAGE.md §3).
  const decodeEntities = t => String(t).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  function linkTarget(href) {
    try {
      const u = new URL(decodeEntities(href));
      if (u.hostname !== 'hb.afl.rakuten.co.jp') return '';
      for (const key of ['pc', 'm']) {
        const v = u.searchParams.get(key);
        if (v && canonicalItem(v)) return canonicalItem(v);
      }
    } catch { /* ignore */ }
    return '';
  }
  function linkBuilderExtract() {
    if (!IS_RAKUTEN_AFFILIATE) return [];
    const snippets = [];
    for (const n of document.querySelectorAll('textarea, input[type="text"], input:not([type])')) if (n.value) snippets.push(n.value);
    for (const a of document.querySelectorAll('a[href*="hb.afl.rakuten.co.jp"]')) snippets.push((a.closest('table, div') || a).outerHTML);
    const found = new Map();
    for (const raw of snippets) {
      const html = /<a[\s>]/i.test(raw) ? raw : '';
      const doc = html ? new DOMParser().parseFromString(html, 'text/html') : null;
      const anchors = doc ? [...doc.querySelectorAll('a[href]')] : [];
      const hrefs = anchors.length ? anchors.map(a => a.getAttribute('href'))
        : (raw.match(/https:\/\/hb\.afl\.rakuten\.co\.jp\/[^\s"'<>]+/g) || []);
      for (const href of hrefs) {
        const url = linkTarget(href);
        if (!url) continue;
        const affiliateUrl = decodeEntities(href);
        const imgs = doc ? [...doc.querySelectorAll('img[src]')].map(i => i.getAttribute('src')) : [];
        const imageUrl = imgs.map(decodeEntities).find(src => {
          try { const u = new URL(src); return u.protocol === 'https:' && ['thumbnail.image.rakuten.co.jp', 'tshop.r10s.jp', 'image.rakuten.co.jp'].includes(u.hostname); }
          catch { return false; }
        }) || '';
        const texts = anchors.map(a => clean(a.textContent)).filter(t => t && !/^https?:/.test(t));
        const alt = doc ? clean(doc.querySelector('img[alt]')?.getAttribute('alt')) : '';
        const title = (texts.sort((x, y) => y.length - x.length)[0] || alt || '').replace(/^【楽天市場】\s*/, '').slice(0, 180);
        const prev = found.get(url);
        // Prefer the snippet that carries an image and a product name.
        if (!prev || (!prev.imageUrl && imageUrl) || (!prev.title && title))
          found.set(url, { kind: 'link', id: rakutenId(url), url, affiliateUrl, imageUrl: imageUrl || prev?.imageUrl || '', title: title || prev?.title || '' });
      }
    }
    return [...found.values()];
  }
  const RAKUTEN_ERRORS = {
    unauthorized: '管理者トークンが違います（メニューから再設定）',
    conflict: 'ほかの編集と競合しました。もう一度押してください',
    image_not_from_link_builder: '画像はリンク作成ページ由来のものしか登録できません',
    invalid_affiliate_url: 'アフィリエイトURLの形式が不正です',
    invalid_destination_url: '楽天市場の商品ページURLではありません',
    invalid_id: 'IDが不正です',
    rakuten_catalog_backend_unavailable: 'Firestoreに接続できません（Worker側の障害）'
  };
  async function rakutenApi(method, query, body) {
    const token = await adminToken();
    if (!token) throw new Error('管理者トークンが未設定です');
    const res = await request({
      method, url: API + (query ? '?' + query : ''), body,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    });
    if (res.status === 401) GM_setValue(K.adminToken, '');
    if (res.status < 200 || res.status >= 300) {
      const code = res.json?.error || 'HTTP ' + res.status;
      const err = new Error(RAKUTEN_ERRORS[code] || code);
      err.code = code; err.existingId = res.json?.existingId;
      throw err;
    }
    return res.json;
  }
  function rakutenNewItem(d, edits) {
    return {
      id: d.id, title: d.title || d.url, category: edits.category || 'そのほか', summary: '',
      status: 'research', destinationUrl: d.url, sourceUrl: d.url, sourceDate: todayJst(),
      sourceKind: 'retailer_listing', editorialShelves: [], catalogId: 'product-' + d.id,
      internalNote: 'Affiliate DB Clipper v' + VERSION + ' で ' + todayJst() + ' に'
        + (d.kind === 'link' ? '楽天アフィリエイトのリンク作成ページから登録。' : '楽天商品ページから登録。')
        + (d.shopName ? '（ショップ: ' + d.shopName + '）' : '') + '販売根拠・提携条件は未確認。'
    };
  }
  // Link-builder data: the affiliate link and its image. affiliateEnabled stays
  // off; it is switched on in the admin page after the PR/media checks.
  const linkFields = d => d.kind !== 'link' ? {} : {
    affiliateUrl: d.affiliateUrl,
    ...(d.imageUrl ? { imageUrl: d.imageUrl, imageAlt: d.title, imageSourceType: 'rakuten-affiliate-link-builder' } : {})
  };
  const Rakuten = {
    key: d => 'rakuten:' + d.url,
    async load(d) {
      const r = await rakutenApi('GET', 'collection=rakuten_products&url=' + encodeURIComponent(d.url));
      return r?.item || null;
    },
    async create(d) {
      const product = { ...rakutenNewItem(d, { category: defaultCategory() }), ...linkFields(d) };
      try {
        const r = await rakutenApi('POST', '', { action: 'save_rakuten_product', product, sourceSystem: 'affiliate-db-clipper' });
        return r.item;
      } catch (e) {
        if (e.code === 'duplicate_item') return this.load(d);
        if (e.code === 'conflict') {
          // A row with this ID already exists (e.g. same item, different URL casing).
          const r = await rakutenApi('GET', 'collection=rakuten_products&id=' + encodeURIComponent(d.id));
          if (r?.item) return d.kind === 'link' ? this.attachLink(d, r.item) : r.item;
        }
        throw e;
      }
    },
    // On the link-creation page an existing row gets the link and image added.
    async attachLink(d, existing) {
      const r = await rakutenApi('POST', '', { action: 'save_rakuten_product',
        product: { id: existing.id, ...linkFields(d) }, expectedUpdateTime: existing._updateTime });
      return r.item;
    },
    async update(d, existing, edits) {
      const product = { id: existing.id, title: edits.title, category: edits.category, summary: edits.summary,
        editorialShelves: edits.shelves, status: edits.status };
      if (edits.catalogId) product.catalogId = edits.catalogId;
      const r = await rakutenApi('POST', '', { action: 'save_rakuten_product', product,
        expectedUpdateTime: existing._updateTime });
      return r.item;
    },
    // 'published' also needs the 公開確認 check, so it is set in the admin page.
    statuses: [['research', '調査中'], ['ready', '掲載準備'], ['archived', '保管']],
    adminUrl: 'https://consult.antonbase.com/intelligence/rakuten/'
  };

  // ---- UI ----------------------------------------------------------------
  const STYLE = `
#${ROOT_ID}{position:fixed;right:16px;bottom:88px;z-index:2147483646;font:13px/1.45 system-ui,sans-serif;color:#16382c}
#${ROOT_ID} .adc-btn{display:flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;border:0;cursor:pointer;
 background:#24553f;color:#fff;font:700 13px system-ui,sans-serif;box-shadow:0 3px 12px rgba(0,0,0,.3);margin-left:auto}
#${ROOT_ID} .adc-btn[data-state=saved]{background:#fff;color:#24553f;outline:2px solid #24553f}
#${ROOT_ID} .adc-btn[data-state=busy]{opacity:.65;cursor:progress}
#${ROOT_ID} .adc-panel{width:300px;max-width:86vw;background:#fff;border:1px solid #d5e1d9;border-radius:10px;padding:12px;margin-bottom:8px;
 box-shadow:0 6px 24px rgba(0,0,0,.25)}
#${ROOT_ID} .adc-panel label{display:block;margin-top:8px;font-size:12px;color:#546b60}
#${ROOT_ID} .adc-panel input[type=text],#${ROOT_ID} .adc-panel textarea,#${ROOT_ID} .adc-panel select{width:100%;box-sizing:border-box;padding:5px 7px;
 border:1px solid #c5d3ca;border-radius:6px;font:13px system-ui,sans-serif;color:#16382c;background:#fff}
#${ROOT_ID} .adc-panel textarea{min-height:56px;resize:vertical}
#${ROOT_ID} .adc-shelves{display:flex;gap:12px;margin-top:4px}
#${ROOT_ID} .adc-shelves label{display:flex;gap:4px;align-items:center;margin:0;color:#16382c;font-size:13px}
#${ROOT_ID} .adc-title{font-weight:700;font-size:13px;margin-right:18px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
#${ROOT_ID} .adc-close{position:absolute;right:10px;top:6px;border:0;background:none;font-size:18px;cursor:pointer;color:#546b60}
#${ROOT_ID} .adc-row{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:10px}
#${ROOT_ID} .adc-row a{color:#24553f;font-size:12px}
#${ROOT_ID} .adc-save{padding:6px 14px;border-radius:6px;border:0;background:#24553f;color:#fff;font-weight:700;cursor:pointer}
#${ROOT_ID} .adc-msg{font-size:12px;margin-top:6px;min-height:1em}
#${ROOT_ID} .adc-msg.err{color:#b43e38}`;

  let toastTimer = 0;
  function toast(message, kind = 'info') {
    let el = document.getElementById('adc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'adc-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:14%;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:6px;'
        + 'font:600 14px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.4);pointer-events:none;transition:opacity .2s;max-width:86vw;text-align:center';
      document.documentElement.appendChild(el);
    }
    el.style.background = kind === 'error' ? 'rgba(170,40,40,.95)' : 'rgba(30,30,36,.95)';
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, kind === 'error' ? 5000 : 2500);
  }

  function el(tag, attrs = {}, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const state = { adapter: null, data: null, record: null, busy: false, root: null, btn: null, panel: null, pageKey: '' };

  function setButton(kind) {
    const { btn } = state;
    if (!btn) return;
    btn.dataset.state = kind;
    btn.textContent = kind === 'busy' ? '… 保存中' : kind === 'saved' ? '✓ DB登録済み'
      : IS_RAKUTEN_AFFILIATE ? '＋ リンクと画像をDBへ' : '＋ アフィDBに追加';
    btn.title = kind === 'saved' ? 'クリックで編集パネル' : IS_AMAZON ? 'Free Consult の amazon_products に下書きで登録'
      : IS_RAKUTEN_AFFILIATE ? '作成したアフィリエイトリンクと画像を rakuten_products に保存' : 'Free Consult の rakuten_products に調査中で登録';
  }

  function closePanel() { state.panel?.remove(); state.panel = null; }

  function openPanel(message) {
    closePanel();
    const { adapter, data, record } = state;
    if (!record) return;
    const panel = el('div', { class: 'adc-panel' });
    panel.style.position = 'relative';
    const close = el('button', { class: 'adc-close', type: 'button', 'aria-label': '閉じる' }, '×');
    close.onclick = closePanel;
    panel.append(close, el('div', { class: 'adc-title' }, IS_AMAZON ? 'Amazon → amazon_products' : '楽天 → rakuten_products'));

    const ttl = el('input', { type: 'text', maxlength: '180' });
    ttl.value = record.title || data.title;
    const lt = el('label', {}, '商品名'); lt.append(ttl);

    const listId = 'adc-cats';
    const cat = el('input', { type: 'text', list: listId });
    cat.value = record.category || '';
    const dl = el('datalist', { id: listId });
    for (const c of categoryOptions()) dl.append(el('option', { value: c }));
    const lc = el('label', {}, 'カテゴリ'); lc.append(cat, dl);

    const sum = el('textarea', { maxlength: '800', placeholder: '紹介文（自分の言葉で。商品ページの文章を貼らない）' });
    sum.value = record.summary || '';
    const ls = el('label', {}, '紹介文'); ls.append(sum);

    const shelvesBox = el('div', { class: 'adc-shelves' });
    const current = new Set(record.editorialShelves || []);
    const checks = SHELVES.map(([key, label]) => {
      const c = el('input', { type: 'checkbox', value: key });
      c.checked = current.has(key);
      const l = el('label'); l.append(c, document.createTextNode(label));
      shelvesBox.append(l);
      return c;
    });
    const lsh = el('label', {}, '棚'); lsh.append(shelvesBox);

    const cid = el('input', { type: 'text', placeholder: 'Amazon/楽天で同じ商品なら同じIDに' });
    cid.value = record.catalogId || '';
    const lcid = el('label', {}, '共通商品ID'); lcid.append(cid);

    const st = el('select');
    const statuses = [...adapter.statuses];
    if (record.status && !statuses.some(([v]) => v === record.status)) statuses.unshift([record.status, record.status]);
    for (const [v, label] of statuses) {
      const o = el('option', { value: v }, label);
      if (v === record.status) o.selected = true;
      st.append(o);
    }
    const lst = el('label', {}, '状態'); lst.append(st);

    const msg = el('div', { class: 'adc-msg' }, message || '');
    const row = el('div', { class: 'adc-row' });
    const admin = el('a', { href: adapter.adminUrl, target: '_blank', rel: 'noopener' }, '管理画面 ↗');
    const save = el('button', { class: 'adc-save', type: 'button' }, '更新');
    row.append(admin, save);

    save.onclick = async () => {
      if (state.busy) return;
      const edits = {
        title: clean(ttl.value).slice(0, 180) || record.title || data.title,
        category: clean(cat.value) || 'そのほか',
        summary: String(sum.value || '').trim().slice(0, 800),
        shelves: checks.filter(c => c.checked).map(c => c.value),
        catalogId: clean(cid.value),
        status: st.value
      };
      if (edits.catalogId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edits.catalogId)) {
        msg.className = 'adc-msg err'; msg.textContent = '共通商品IDは半角英小文字・数字・ハイフンのみ'; return;
      }
      state.busy = true; save.disabled = true;
      msg.className = 'adc-msg'; msg.textContent = '更新中…';
      try {
        let latest = state.record;
        try {
          state.record = await adapter.update(data, latest, edits);
        } catch (e) {
          // Revision changed (e.g. edited in the admin page): reload once and retry.
          if (!/競合/.test(e.message)) throw e;
          latest = await adapter.load(data);
          state.record = await adapter.update(data, latest, edits);
        }
        rememberCategory(edits.category);
        msg.textContent = '更新しました';
      } catch (e) {
        msg.className = 'adc-msg err'; msg.textContent = '更新できません：' + e.message;
      } finally { state.busy = false; save.disabled = false; }
    };

    panel.append(lt, lc, ls, lsh, lcid, lst, row, msg);
    state.root.prepend(panel);
    state.panel = panel;
  }

  async function save(data) {
    state.data = data;
    state.busy = true; setButton('busy');
    try {
      let record = await state.adapter.load(data);
      let message = '既に登録済みです。必要ならここで編集できます。';
      if (!record) {
        record = await state.adapter.create(data);
        message = IS_AMAZON ? '下書きで登録しました。カテゴリ・紹介文・棚を足すなら下で更新。'
          : data.kind === 'link' ? '調査中で登録し、アフィリエイトリンク' + (data.imageUrl ? 'と画像' : '') + 'を保存しました。広告表示のONは管理画面で。'
            : '調査中で登録しました。カテゴリ・紹介文・棚を足すなら下で更新。';
        toast('アフィDBに登録しました');
      } else if (data.kind === 'link' && (record.affiliateUrl !== data.affiliateUrl || (data.imageUrl && record.imageUrl !== data.imageUrl))) {
        record = await state.adapter.attachLink(data, record);
        message = '登録済みの商品に、アフィリエイトリンク' + (data.imageUrl ? 'と画像' : '') + 'を保存しました。広告表示のONは管理画面で。';
        toast('リンクを保存しました');
      }
      state.record = record;
      markSaved(state.adapter.key(data), todayJst());
      setButton('saved');
      openPanel(message);
    } catch (e) {
      setButton(getSaved()[state.adapter.key(data)] ? 'saved' : 'idle');
      toast('登録できません：' + e.message, 'error');
    } finally { state.busy = false; }
  }

  // Several generated links on the link-creation page: let the user pick one.
  function openChooser(candidates) {
    closePanel();
    const panel = el('div', { class: 'adc-panel' });
    panel.style.position = 'relative';
    const close = el('button', { class: 'adc-close', type: 'button', 'aria-label': '閉じる' }, '×');
    close.onclick = closePanel;
    panel.append(close, el('div', { class: 'adc-title' }, 'どの商品を保存しますか？'));
    for (const c of candidates) {
      const b = el('button', { class: 'adc-save', type: 'button' }, (c.title || c.url).slice(0, 60) + (c.imageUrl ? ' 🖼' : ''));
      b.style.cssText = 'display:block;width:100%;margin-top:8px;text-align:left';
      b.onclick = () => { closePanel(); save(c); };
      panel.append(b);
    }
    state.root.prepend(panel);
    state.panel = panel;
  }

  function currentData() {
    if (IS_AMAZON) return amazonExtract();
    if (IS_RAKUTEN) return rakutenExtract();
    if (IS_RAKUTEN_AFFILIATE) {
      const list = linkBuilderExtract();
      return list.length === 1 ? list[0] : list.length ? { kind: 'choice', list } : null;
    }
    return null;
  }

  async function onClick() {
    if (state.busy) return;
    if (state.panel) { closePanel(); return; }
    const data = currentData();
    if (!data) { toast('商品情報を読み取れませんでした', 'error'); return; }
    if (data.kind === 'choice') { openChooser(data.list); return; }
    if (state.record && state.data && state.adapter.key(state.data) === state.adapter.key(data) && data.kind !== 'link') { openPanel(''); return; }
    await save(data);
  }

  function mount() {
    const adapter = IS_AMAZON ? Amazon : (IS_RAKUTEN || IS_RAKUTEN_AFFILIATE) ? Rakuten : null;
    const data = currentData();
    const key = !data ? '' : data.kind === 'choice' ? data.list.map(adapter.key).join('|') : adapter.key(data);
    if (key === state.pageKey && (document.getElementById(ROOT_ID) || !key)) return;
    document.getElementById(ROOT_ID)?.remove();
    Object.assign(state, { adapter, data: null, record: null, root: null, btn: null, panel: null, pageKey: key });
    if (!data) return;
    if (!document.getElementById('adc-style')) {
      const s = el('style', { id: 'adc-style' }, STYLE);
      document.head.append(s);
    }
    const root = el('div', { id: ROOT_ID });
    const btn = el('button', { class: 'adc-btn', type: 'button' });
    btn.addEventListener('click', onClick);
    root.append(btn);
    document.body.append(root);
    state.root = root; state.btn = btn;
    setButton(data.kind !== 'choice' && data.kind !== 'link' && getSaved()[key] ? 'saved' : 'idle');
  }

  // ---- Menu --------------------------------------------------------------
  GM_registerMenuCommand('アフィDB: 管理者トークンを設定', async () => {
    const v = await askSecret('アフィDB: 管理者トークン', ADMIN_HELP);
    if (v !== null) { GM_setValue(K.adminToken, v); toast(v ? '管理者トークンを保存しました' : '管理者トークンを削除しました'); }
  });
  GM_registerMenuCommand('アフィDB: Amazonアソシエイトタグを設定（任意）', () => {
    const v = window.prompt('アソシエイトのトラッキングID（例: xxxxx-22）。登録時に affiliateUrl として保存します（広告表示のONは管理画面で）。空で削除。',
      GM_getValue(K.associateTag, ''));
    if (v === null) return;
    const tag = v.trim();
    if (tag && !/^[a-z0-9-]{2,50}-22$/.test(tag)) { toast('形式が違います（例: xxxxx-22）', 'error'); return; }
    GM_setValue(K.associateTag, tag);
    toast(tag ? 'タグを保存しました' : 'タグを削除しました');
  });
  GM_registerMenuCommand('アフィDB: 接続テスト', async () => {
    toast('接続テスト中…');
    try {
      if (IS_AMAZON) {
        const r = await amazonApi('GET', 'collection=amazon_products&id=B000000000');
        toast('Amazon側 接続OK' + (r?.sourceOfTruth ? '（' + r.sourceOfTruth + '）' : ''));
      } else {
        const r = await rakutenApi('GET', 'collection=rakuten_products&id=connection-test');
        toast('楽天側 接続OK' + (r?.sourceOfTruth ? '（' + r.sourceOfTruth + '）' : ''));
      }
    } catch (e) { toast('接続NG：' + e.message, 'error'); }
  });

  // Amazon / Rakuten swap content without full reloads on some flows.
  mount();
  let lastHref = location.href;
  // Re-check on navigation, and on the link-creation page whenever a link is generated.
  setInterval(() => {
    if (location.href !== lastHref || IS_RAKUTEN_AFFILIATE) { lastHref = location.href; if (!state.busy && !state.panel) mount(); }
    else if (!document.getElementById(ROOT_ID) && state.pageKey) mount();
  }, 1000);
  window.__affiliateDbClipperDebug = () => ({
    version: VERSION, site: IS_AMAZON ? 'amazon' : IS_RAKUTEN ? 'rakuten' : IS_RAKUTEN_AFFILIATE ? 'rakuten-affiliate' : 'other',
    extracted: currentData(),
    hasAdminToken: Boolean(GM_getValue(K.adminToken, ''))
  });
})();
