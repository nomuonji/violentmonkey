// ==UserScript==
// @name         YouTube Preference Pusher
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.0.0
// @description  YouTubeのおすすめを自分の好み（手動リスト＋高評価・再生リスト・登録チャンネルからの学習）で採点し、並べ替え・薄表示・好み枠の差し込み・ワンクリックの「興味なし」送信を行います。
// @author       nomuonji
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @noframes
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/youtube-preference-pusher.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/youtube-preference-pusher.user.js
// ==/UserScript==

/*
 * 方針
 * - YouTube側を自動操作で「調教」することはしない（自動再生・自動高評価はしない）。
 * - 画面に出てきたおすすめを自分のルールで採点し、上げる／薄くする／隠す。
 * - 好きなチャンネルの新着やキーワード検索の結果を「好み枠」としてホームに差し込む。
 * - 「興味なし」「チャンネルをおすすめに表示しない」は、ユーザーがボタンを押したときだけ送る。
 * - 通信は youtube.com 内（自分のログイン状態での閲覧と同じ範囲）だけ。外部サーバーには何も送らない。
 * - 学習データは Violentmonkey のスクリプト用ストレージにだけ保存する。
 */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const NS = 'ypp';

  // ======================================================================
  //  Core (pure logic; also loaded by tests in Node)
  // ======================================================================

  const DEFAULT_SETTINGS = {
    enabled: true,
    surfaceHome: true,
    surfaceWatch: true,
    surfaceSearch: true,
    reorderHome: true,
    reorderWatch: true,
    boostAt: 1.5,          // これ以上は「好み」として強調・上へ
    dimAt: 0,              // これ以下は「好み要素なし」として薄く
    lowAction: 'dim',      // dim | hide | none
    showChips: 'marked',   // marked | all | none
    hideShorts: false,
    minViews: 0,
    maxAgeDays: 0,
    shelf: true,
    shelfCount: 12,
    shelfRefreshHours: 4,
    shelfMaxAgeDays: 30,
    shelfPeriod: 'month',  // week | month
    shelfPerChannel: 2,
    shelfChannels: 20,
    shelfUseLearnedTerms: true,
    learnMax: 1000,
    includeSubs: true,
    includeWatchLater: false,
    includeHistory: false,
    historyMax: 300,
    playlists: [],
    autoRelearnDays: 7,
    learnFromWatch: false,
    watchSeconds: 120,
    sendToYoutube: true,   // 👎/🚫 を押したとき YouTube にも「興味なし」等を送る
  };

  const DEFAULT_MANUAL = {
    likeChannels: '',
    likeKeywords: '',
    ngChannels: '',
    ngKeywords: '',
  };

  const STOPWORDS = new Set((
    'the and for with you your this that from are was how what why who when not but all can will ' +
    'official video videos music mv pv shorts short live full part episode ep vol new feat ft vs ' +
    'channel youtube top best one two out get got has have just more about into over its our ' +
    'of in to on at is it an by as or be me we do so no if up my am us he she they them his her ' +
    '動画 公式 チャンネル 紹介 まとめ ライブ 配信 生配信 について する した して です ます これ それ ' +
    'あの この その こと もの ため よう さん ちゃん くん たち 完全 最新 最強 必見 話題 衝撃 本当 ' +
    '今日 今回 前編 後編 www 年版 ver 第一 第二 時間 好き 理由 人生 問題 方法 解説 語る 悪い 非公式 周年 放送 無料 ' +
    '全部 最後 最初 自分 みんな 本気 意味 結果 結論 真相 秘密 sp'
  ).split(/\s+/).filter(Boolean));

  const SEGMENTER = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? new Intl.Segmenter('ja', { granularity: 'word' })
    : null;

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function clone(v) {
    return v === undefined ? v : JSON.parse(JSON.stringify(v));
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function tokenize(text) {
    const t = norm(text).replace(/https?:\/\/\S+/g, ' ');
    const raw = [];
    if (SEGMENTER) {
      // 「ゲンロン」が「ゲン」「ロン」に割れるなど、カタカナ語は分割されやすいので隣接するカタカナ片をつなぎ直す
      const KATA = /^[\p{Script=Katakana}ー・]+$/u;
      let prevEnd = -1; let prevKata = false;
      for (const s of SEGMENTER.segment(t)) {
        if (!s.isWordLike) { prevEnd = -1; prevKata = false; continue; }
        const kata = KATA.test(s.segment);
        if (kata && prevKata && prevEnd === s.index && raw.length) raw[raw.length - 1] += s.segment;
        else raw.push(s.segment);
        prevEnd = s.index + s.segment.length; prevKata = kata;
      }
    } else {
      raw.push(...t.split(/[^\p{L}\p{N}]+/u));
    }
    const out = new Set();
    for (let w of raw) {
      w = w.replace(/^[#＃]/, '').trim();
      if (w.length < 2 || w.length > 30) continue;
      if (/^[\d.,:/%-]+$/.test(w)) continue;
      if (STOPWORDS.has(w)) continue;
      if (/^[\p{Script=Hiragana}ー]+$/u.test(w) && w.length < 4) continue;
      if (/^[a-z]$/.test(w)) continue;
      out.add(w);
    }
    return [...out];
  }

  // "1.2万 回視聴" / "12万 回" / "1.2M views" / "視聴回数 3,456 回"
  function parseViews(text) {
    const s = String(text || '').normalize('NFKC');
    let m = s.match(/([\d.,]+)\s*(万|億|千)?\s*(?:回視聴|回再生|回\b|人が視聴中|人視聴中)/) ||
      s.match(/視聴回数\s*([\d.,]+)\s*(万|億|千)?/);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      const mul = { 万: 1e4, 億: 1e8, 千: 1e3 }[m[2]] || 1;
      if (Number.isFinite(n)) return Math.round(n * mul);
    }
    m = s.match(/([\d.,]+)\s*([KMB])?\s*(?:views|view|watching)/i);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      const mul = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
      if (Number.isFinite(n)) return Math.round(n * mul);
    }
    if (/視聴回数なし|No views/i.test(s)) return 0;
    return null;
  }

  // 新しいUIでは再生数がアイコン＋「31万」だけになるので、メタデータの各パーツから拾う
  function viewsFromParts(parts) {
    for (const p of parts) {
      const v = parseViews(p);
      if (v != null) return v;
    }
    for (const p of parts) {
      const m = String(p || '').normalize('NFKC').trim().match(/^([\d.,]+)\s*(万|億|千|[KMB])?$/i);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        const mul = { 万: 1e4, 億: 1e8, 千: 1e3, K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || { 万: 1e4, 億: 1e8, 千: 1e3 }[m[2]] || 1;
        if (Number.isFinite(n)) return Math.round(n * mul);
      }
    }
    return null;
  }

  // "3 日前" / "1 か月前" / "2 years ago" / "配信済み 5 時間前"
  function parseAgeDays(text) {
    const s = String(text || '').normalize('NFKC');
    let m = s.match(/(\d+)\s*(秒|分|時間|日|週間|か月|ヶ月|カ月|ケ月|年)前/);
    if (m) {
      const n = Number(m[1]);
      const d = { 秒: 1 / 86400, 分: 1 / 1440, 時間: 1 / 24, 日: 1, 週間: 7, か月: 30, ヶ月: 30, カ月: 30, ケ月: 30, 年: 365 }[m[2]];
      return n * d;
    }
    m = s.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
    if (m) {
      const n = Number(m[1]);
      const d = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }[m[2].toLowerCase()];
      return n * d;
    }
    return null;
  }

  function parseChannelRef(line) {
    let s = String(line || '').trim();
    let m = s.match(/youtube\.com\/(@[^/?#\s]+)/i);
    if (m) return { type: 'handle', value: norm(decodeURIComponent(m[1])) };
    m = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/i) || s.match(/^(UC[\w-]{22})$/);
    if (m) return { type: 'id', value: m[1] };
    if (/^@\S+$/.test(s)) return { type: 'handle', value: norm(s) };
    return { type: 'name', value: norm(s) };
  }

  // 1行1件。末尾に " | 2" で重み。 "//" 以降はコメント。
  function parseList(text, kind) {
    const out = [];
    for (let line of String(text || '').split(/\r?\n/)) {
      line = line.replace(/(^|\s)\/\/.*$/, '').trim();
      if (!line) continue;
      let weight = null;
      const wm = line.match(/^(.*?)\s*\|\s*([+-]?\d+(?:\.\d+)?)\s*$/);
      if (wm) { line = wm[1].trim(); weight = Number(wm[2]); }
      if (!line) continue;
      if (kind === 'channel') {
        out.push({ raw: line, weight, ...parseChannelRef(line) });
      } else {
        const rm = line.match(/^\/(.+)\/([gimsuy]*)$/);
        if (rm) {
          try { out.push({ raw: line, weight, type: 'regex', re: new RegExp(rm[1], rm[2].replace('g', '') || 'i') }); }
          catch (_) { /* 不正な正規表現は無視 */ }
        } else {
          out.push({ raw: line, weight, type: 'text', value: norm(line) });
        }
      }
    }
    return out;
  }

  function parseManual(manual) {
    return {
      likeChannels: parseList(manual.likeChannels, 'channel'),
      likeKeywords: parseList(manual.likeKeywords, 'keyword'),
      ngChannels: parseList(manual.ngChannels, 'channel'),
      ngKeywords: parseList(manual.ngKeywords, 'keyword'),
    };
  }

  function resolveKey(entry) {
    return entry.type === 'handle' ? 'h:' + entry.value : entry.type === 'id' ? 'id:' + entry.value : 'n:' + entry.value;
  }

  function matchChannel(entry, v, resolved) {
    const name = norm(v.channelName);
    const handle = norm(v.handle);
    const r = resolved && resolved[resolveKey(entry)];
    if (entry.type === 'handle') {
      if (handle && handle === entry.value) return true;
    } else if (entry.type === 'id') {
      if (v.channelId && v.channelId === entry.value) return true;
    } else if (name && name === entry.value) {
      return true;
    }
    if (r) {
      if (r.id && v.channelId && r.id === v.channelId) return true;
      if (r.name && name && norm(r.name) === name) return true;
      if (r.handle && handle && norm(r.handle) === handle) return true;
    }
    return false;
  }

  function matchKeyword(entry, hay) {
    if (entry.type === 'regex') return entry.re.test(hay);
    return entry.value && hay.includes(entry.value);
  }

  function emptyCorpus() { return { N: 0, df: {} }; }

  function addDoc(corpus, tokens, weight = 1) {
    corpus.N += weight;
    for (const t of tokens) corpus.df[t] = (corpus.df[t] || 0) + weight;
  }

  function mergeCorpora(...cs) {
    const out = emptyCorpus();
    for (const c of cs) {
      if (!c) continue;
      out.N += c.N || 0;
      for (const [t, n] of Object.entries(c.df || {})) out.df[t] = (out.df[t] || 0) + n;
    }
    return out;
  }

  function pruneCorpus(corpus, maxTerms) {
    const entries = Object.entries(corpus.df);
    if (entries.length <= maxTerms) return corpus;
    entries.sort((a, b) => b[1] - a[1]);
    corpus.df = Object.fromEntries(entries.slice(0, maxTerms));
    return corpus;
  }

  // 好きなもの（fg）と、普段フィードに流れてくるもの（bg）の対数オッズ比で語の重みを出す。
  // 「動画」「解説」のような、どこにでも出る語は bg にも多いので重みが下がる。
  function termWeights(fg, bg, ignore) {
    const out = new Map();
    if (!fg || fg.N <= 0) return out;
    const minDf = fg.N < 15 ? 1 : Math.max(2, Math.ceil(fg.N * 0.004));
    const B = (bg && bg.N) || 0;
    for (const [t, l] of Object.entries(fg.df)) {
      if (l < minDf || (ignore && ignore.has(t))) continue;
      const pl = (l + 0.5) / (fg.N + 1);
      const b = (bg && bg.df[t]) || 0;
      // 背景（普段のフィード）での出現率。背景が少ないうちは「一般的な語の出現率」0.3% を事前分布として混ぜる
      const pb = 0.7 * ((b + 0.5) / (B + 300)) + 0.3 * 0.003;
      const w = clamp(Math.log(pl / pb), -1, 2.5);
      if (w > 0.3) out.set(t, w);
    }
    return out;
  }

  function buildModel({ learned, fb, watch, bg, ignore, settings }) {
    const ign = {
      channels: new Set((ignore && ignore.channels) || []),
      terms: new Set((ignore && ignore.terms) || []),
    };
    const fgParts = [learned && learned.corpus, fb && fb.pos];
    if (settings.learnFromWatch && watch) fgParts.push(watch.corpus);
    const fg = mergeCorpora(...fgParts);
    const termPos = termWeights(fg, bg, ign.terms);
    const termNeg = termWeights(fb && fb.neg, bg, ign.terms);
    // 好きな語として強いものは嫌いな語から外す
    for (const t of termPos.keys()) termNeg.delete(t);

    const chans = new Map();
    const byName = new Map();
    const byHandle = new Map();
    const upsert = (c) => {
      const key = c.id || 'n:' + norm(c.name);
      if (!key || key === 'n:') return null;
      let e = chans.get(key) || (c.name && byName.get(norm(c.name)) && chans.get(byName.get(norm(c.name))));
      if (!e) {
        e = { key, id: c.id || '', name: c.name || '', handle: c.handle || '', likes: 0, sub: false, fb: 0, watches: 0 };
        chans.set(key, e);
      }
      if (c.id && !e.id) e.id = c.id;
      if (c.name && !e.name) e.name = c.name;
      if (c.handle && !e.handle) e.handle = c.handle;
      if (e.name) byName.set(norm(e.name), e.key);
      if (e.handle) byHandle.set(norm(e.handle), e.key);
      return e;
    };
    for (const c of Object.values((learned && learned.channels) || {})) {
      const e = upsert(c); if (!e) continue;
      e.likes += c.likes || 0; e.sub = e.sub || !!c.sub;
    }
    for (const c of Object.values((fb && fb.channels) || {})) {
      const e = upsert(c); if (!e) continue;
      e.fb += c.fb || 0;
    }
    if (settings.learnFromWatch && watch) {
      for (const c of Object.values(watch.channels || {})) {
        const e = upsert(c); if (!e) continue;
        e.watches += c.n || 0;
      }
    }
    for (const e of chans.values()) {
      const parts = [];
      let w = 0;
      if (e.likes) { const x = Math.min(2.5, 0.9 * Math.log2(1 + e.likes)); w += x; parts.push(['likes', x]); }
      if (e.sub) { w += 0.6; parts.push(['sub', 0.6]); }
      if (e.watches) { const x = Math.min(1, 0.3 * Math.log2(1 + e.watches)); w += x; parts.push(['watch', x]); }
      if (e.fb) { const x = clamp(e.fb, -3, 3); w += x; parts.push(['fb', x]); }
      e.w = (ign.channels.has(e.key) || ign.channels.has(e.id)) ? Math.min(0, e.fb || 0) : w;
      e.parts = parts;
    }
    return { termPos, termNeg, chans, byName, byHandle, fgN: fg.N };
  }

  function lookupChannel(model, v) {
    if (v.channelId && model.chans.has(v.channelId)) return model.chans.get(v.channelId);
    if (v.handle) { const k = model.byHandle.get(norm(v.handle)); if (k) return model.chans.get(k); }
    if (v.channelName) { const k = model.byName.get(norm(v.channelName)); if (k) return model.chans.get(k); }
    return null;
  }

  function fmt(n) {
    return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(1);
  }

  function scoreVideo(v, ctx) {
    const { manual, settings, model, resolved } = ctx;
    const reasons = [];
    const hay = norm((v.title || '') + ' ' + (v.channelName || ''));

    for (const e of manual.ngChannels) {
      if (matchChannel(e, v, resolved)) return { score: -99, hidden: true, reasons: ['NGチャンネル: ' + e.raw] };
    }
    for (const e of manual.ngKeywords) {
      if (matchKeyword(e, hay)) return { score: -99, hidden: true, reasons: ['NGキーワード: ' + e.raw] };
    }
    if (settings.hideShorts && v.isShort) return { score: -99, hidden: true, reasons: ['Shorts'] };
    if (settings.minViews > 0 && v.views != null && v.views < settings.minViews) {
      return { score: -99, hidden: true, reasons: ['再生数が少ない'] };
    }
    if (settings.maxAgeDays > 0 && v.ageDays != null && v.ageDays > settings.maxAgeDays) {
      return { score: -99, hidden: true, reasons: ['古い動画'] };
    }

    let score = 0;
    for (const e of manual.likeChannels) {
      if (matchChannel(e, v, resolved)) {
        const w = e.weight != null ? e.weight : 3;
        score += w; reasons.push(`好きなチャンネル ${fmt(w)}`);
        break;
      }
    }
    let kw = 0;
    const kwHits = [];
    for (const e of manual.likeKeywords) {
      if (matchKeyword(e, hay)) { kw += e.weight != null ? e.weight : 2; kwHits.push(e.raw); }
    }
    if (kwHits.length) {
      kw = clamp(kw, -6, 4);
      score += kw; reasons.push(`キーワード「${kwHits.slice(0, 3).join('」「')}」 ${fmt(kw)}`);
    }

    if (model) {
      const ch = lookupChannel(model, v);
      if (ch && ch.w) {
        score += ch.w;
        const label = ch.parts.map(([k]) => ({ likes: `高評価${ch.likes}本`, sub: '登録中', watch: '視聴履歴', fb: ch.fb > 0 ? '👍' : '👎' }[k])).join('・');
        reasons.push(`学習チャンネル（${label}） ${fmt(ch.w)}`);
      }
      const toks = v.tokens || tokenize(v.title || '');
      const pos = []; const neg = [];
      for (const t of toks) {
        if (model.termPos.has(t)) pos.push([t, model.termPos.get(t)]);
        if (model.termNeg.has(t)) neg.push([t, model.termNeg.get(t)]);
      }
      if (pos.length) {
        pos.sort((a, b) => b[1] - a[1]);
        const x = Math.min(2, pos.slice(0, 3).reduce((s, p) => s + p[1], 0) * 0.5);
        score += x; reasons.push(`好みの語: ${pos.slice(0, 4).map((p) => p[0]).join(', ')} ${fmt(x)}`);
      }
      if (neg.length) {
        neg.sort((a, b) => b[1] - a[1]);
        const x = Math.min(1.5, neg.slice(0, 2).reduce((s, p) => s + p[1], 0) * 0.6);
        score -= x; reasons.push(`苦手な語: ${neg.slice(0, 3).map((p) => p[0]).join(', ')} ${fmt(-x)}`);
      }
    }
    return { score: Math.round(score * 100) / 100, hidden: false, reasons };
  }

  function classify(result, settings) {
    if (result.hidden) return 'hidden';
    if (result.score >= settings.boostAt) return 'boost';
    if (settings.lowAction !== 'none' && result.score <= settings.dimAt) return settings.lowAction === 'hide' ? 'hidden' : 'dim';
    return 'neutral';
  }

  // ---- YouTube data extraction (ytInitialData / innertube JSON) -----------

  function ytText(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (t.simpleText != null) return t.simpleText;
    if (Array.isArray(t.runs)) return t.runs.map((r) => r.text || '').join('');
    if (t.content != null) return t.content;
    return '';
  }

  function findBrowseId(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return '';
    if (typeof obj.browseId === 'string' && /^UC[\w-]{22}$/.test(obj.browseId)) return obj.browseId;
    for (const v of Object.values(obj)) {
      const r = findBrowseId(v, depth + 1);
      if (r) return r;
    }
    return '';
  }

  function findHandle(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return '';
    if (typeof obj.canonicalBaseUrl === 'string' && obj.canonicalBaseUrl.startsWith('/@')) return decodeURIComponent(obj.canonicalBaseUrl.slice(1));
    for (const v of Object.values(obj)) {
      const r = findHandle(v, depth + 1);
      if (r) return r;
    }
    return '';
  }

  function parseVideoRenderer(r) {
    const by = r.shortBylineText || r.ownerText || r.longBylineText;
    const info = [ytText(r.viewCountText), ytText(r.shortViewCountText), ytText(r.publishedTimeText), ytText(r.videoInfo)].join(' ');
    return {
      videoId: r.videoId,
      title: ytText(r.title) || ytText(r.headline),
      channelName: ytText(by),
      channelId: findBrowseId(by) || '',
      handle: findHandle(by) || '',
      views: parseViews(info),
      ageDays: parseAgeDays(info),
      isShort: false,
    };
  }

  function parseLockup(l) {
    const meta = l.metadata && l.metadata.lockupMetadataViewModel;
    if (!meta) return null;
    const rows = (meta.metadata && meta.metadata.contentMetadataViewModel && meta.metadata.contentMetadataViewModel.metadataRows) || [];
    const parts = rows.map((row) => (row.metadataParts || []).map((p) => ytText(p.text)));
    const flat = parts.flat().join(' ');
    return {
      videoId: l.contentId,
      title: ytText(meta.title),
      channelName: (parts[0] && parts[0][0]) || '',
      channelId: findBrowseId(meta) || '',
      handle: findHandle(meta) || '',
      views: viewsFromParts(parts.slice(1).flat()),
      ageDays: parseAgeDays(flat),
      isShort: false,
    };
  }

  const VIDEO_RENDERER_KEYS = ['playlistVideoRenderer', 'videoRenderer', 'gridVideoRenderer', 'compactVideoRenderer', 'playlistPanelVideoRenderer'];

  function extractYt(root) {
    const videos = []; const channels = []; const playlists = [];
    let continuation = '';
    const seen = new Set();
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 60) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      for (const k of VIDEO_RENDERER_KEYS) {
        if (o[k] && o[k].videoId) {
          const v = parseVideoRenderer(o[k]);
          if (v.title && !seen.has(v.videoId)) { seen.add(v.videoId); videos.push(v); }
          return;
        }
      }
      if (o.lockupViewModel) {
        const l = o.lockupViewModel;
        const type = String(l.contentType || '');
        if (/PLAYLIST|PODCAST/.test(type)) {
          const meta = l.metadata && l.metadata.lockupMetadataViewModel;
          playlists.push({ id: l.contentId, title: ytText(meta && meta.title) });
        } else if (l.contentId && l.contentId.length === 11) {
          const v = parseLockup(l);
          if (v && v.title && !seen.has(v.videoId)) { seen.add(v.videoId); videos.push(v); }
        }
        return;
      }
      if (o.shortsLockupViewModel) {
        const s = o.shortsLockupViewModel;
        const id = s.onTap && s.onTap.innertubeCommand && s.onTap.innertubeCommand.reelWatchEndpoint && s.onTap.innertubeCommand.reelWatchEndpoint.videoId;
        const title = s.overlayMetadata && ytText(s.overlayMetadata.primaryText);
        if (id && title && !seen.has(id)) {
          seen.add(id);
          videos.push({ videoId: id, title, channelName: '', channelId: '', handle: '', views: parseViews(ytText(s.overlayMetadata.secondaryText)), ageDays: null, isShort: true });
        }
        return;
      }
      if (o.channelRenderer && o.channelRenderer.channelId) {
        const c = o.channelRenderer;
        channels.push({ id: c.channelId, name: ytText(c.title), handle: findHandle(c) || '' });
        return;
      }
      if (o.gridPlaylistRenderer || o.playlistRenderer) {
        const p = o.gridPlaylistRenderer || o.playlistRenderer;
        playlists.push({ id: p.playlistId, title: ytText(p.title) });
        return;
      }
      if (o.continuationItemRenderer || o.continuationItemViewModel) {
        // 旧: continuationItemRenderer.continuationEndpoint.continuationCommand.token
        // 新: continuationItemViewModel.continuationCommand.innertubeCommand.continuationCommand.token
        const tok = (JSON.stringify(o.continuationItemRenderer || o.continuationItemViewModel).match(/"token":"([^"]+)"/) || [])[1];
        if (tok) continuation = tok;
        return;
      }
      for (const v of Object.values(o)) walk(v, depth + 1);
    };
    walk(root, 0);
    return { videos, channels, playlists, continuation };
  }

  function extractInitialData(html) {
    const m = html.match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (_) { return null; }
  }

  function decodeEntities(s) {
    return String(s || '')
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  function parseRss(xml, now = Date.now()) {
    const out = [];
    for (const part of String(xml || '').split('<entry>').slice(1)) {
      const get = (re) => { const m = part.match(re); return m ? decodeEntities(m[1]) : ''; };
      const videoId = get(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      if (!videoId) continue;
      const published = get(/<published>([^<]+)<\/published>/);
      const views = get(/<media:statistics views="(\d+)"/);
      const link = get(/<link rel="alternate" href="([^"]+)"/);
      const ts = Date.parse(published);
      out.push({
        videoId,
        title: get(/<title>([^<]*)<\/title>/),
        channelName: get(/<author>\s*<name>([^<]*)<\/name>/),
        channelId: get(/<yt:channelId>([^<]+)<\/yt:channelId>/),
        handle: '',
        views: views ? Number(views) : null,
        ageDays: Number.isFinite(ts) ? (now - ts) / 86400000 : null,
        isShort: /\/shorts\//.test(link),
      });
    }
    return out;
  }

  function searchParams(period) {
    // SearchParams protobuf: filters{ uploadDate: 3=今週 / 4=今月, type: 1=動画 }
    const d = period === 'week' ? 3 : 4;
    const bytes = [0x12, 0x04, 0x08, d, 0x10, 0x01];
    return typeof btoa === 'function' ? btoa(String.fromCharCode(...bytes)) : Buffer.from(bytes).toString('base64');
  }

  // 好み枠の候補を採点・多様化して上位を返す
  function pickShelf(candidates, ctx, opts) {
    const { watched = {}, dismissed = {} } = opts;
    const settings = ctx.settings;
    const seen = new Set();
    const scored = [];
    for (const v of candidates) {
      if (!v || !v.videoId || seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      if (watched[v.videoId] || dismissed[v.videoId]) continue;
      if (v.ageDays != null && v.ageDays > settings.shelfMaxAgeDays) continue;
      if (settings.hideShorts && v.isShort) continue;
      const r = scoreVideo(v, ctx);
      if (r.hidden) continue;
      let s = r.score;
      if (v.ageDays != null) s += v.ageDays < 3 ? 0.6 : v.ageDays < 10 ? 0.3 : 0;
      scored.push({ ...v, score: Math.round(s * 100) / 100, reasons: r.reasons });
    }
    scored.sort((a, b) => b.score - a.score);
    const per = new Map();
    const out = [];
    for (const v of scored) {
      const k = v.channelId || norm(v.channelName);
      const n = per.get(k) || 0;
      if (n >= settings.shelfPerChannel) continue;
      per.set(k, n + 1);
      out.push(v);
      if (out.length >= settings.shelfCount) break;
    }
    return out;
  }

  const core = {
    DEFAULT_SETTINGS, DEFAULT_MANUAL, norm, tokenize, parseViews, viewsFromParts, parseAgeDays, parseList, parseManual,
    parseChannelRef, matchChannel, emptyCorpus, addDoc, mergeCorpora, pruneCorpus, termWeights, buildModel,
    scoreVideo, classify, extractYt, extractInitialData, parseRss, searchParams, pickShelf, resolveKey,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = core;
    return;
  }

  // ======================================================================
  //  Browser runtime
  // ======================================================================

  const PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (a, b) => a + Math.random() * (b - a);

  // ---- storage -----------------------------------------------------------
  const store = {
    get(k, d) {
      try { const v = GM_getValue(NS + '.' + k); return v === undefined ? clone(d) : v; } catch (_) { return clone(d); }
    },
    set(k, v) {
      try { GM_setValue(NS + '.' + k, v); } catch (e) { console.warn('[ypp] save failed', k, e); }
    },
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS, ...store.get('settings', {}) },
    manualText: { ...DEFAULT_MANUAL, ...store.get('manual', {}) },
    learned: store.get('learned', { at: 0, corpus: emptyCorpus(), channels: {}, counts: {} }),
    fb: store.get('fb', { pos: emptyCorpus(), neg: emptyCorpus(), channels: {} }),
    watch: store.get('watch', { ids: {}, corpus: emptyCorpus(), channels: {} }),
    bg: store.get('bg', emptyCorpus()),
    ignore: store.get('ignore', { channels: [], terms: [] }),
    dismissed: store.get('dismissed', {}),
    shelf: store.get('shelf', { at: 0, items: [], note: '' }),
    resolved: store.get('resolved', {}),
    manual: null,
    model: null,
    version: 0,
    epoch: 0,
    bgSeen: new Set(),
    bgDirty: false,
    shelfBusy: false,
    learnBusy: false,
    bulkStop: false,
    bulkBusy: false,
  };

  function rebuild() {
    state.manual = parseManual(state.manualText);
    state.model = buildModel({
      learned: state.learned, fb: state.fb, watch: state.watch, bg: state.bg, ignore: state.ignore, settings: state.settings,
    });
    state.version++;
  }

  function ctx() {
    return { manual: state.manual, settings: state.settings, model: state.model, resolved: state.resolved };
  }

  function saveSettings() { store.set('settings', state.settings); }

  // ---- DOM helpers (Trusted Types 対策で innerHTML は使わない) -------------
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'textContent') el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  let toastTimer = 0;
  function toast(msg, kind = 'info', ms = 3200) {
    let el = document.getElementById('ypp-toast');
    if (!el) { el = h('div', { id: 'ypp-toast' }); document.body.append(el); }
    el.textContent = msg;
    el.dataset.kind = kind;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function addStyle(css) {
    const s = document.createElement('style');
    s.id = 'ypp-style';
    s.textContent = css;
    (document.head || document.documentElement).append(s);
  }

  // ---- innertube ---------------------------------------------------------
  function cfg(key) {
    const yc = PAGE.ytcfg;
    if (!yc) return undefined;
    try { const v = yc.get && yc.get(key); if (v !== undefined) return v; } catch (_) { /* noop */ }
    return yc.data_ ? yc.data_[key] : undefined;
  }

  async function sha1Hex(text) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function authHeader() {
    const m = document.cookie.match(/(?:^|;\s*)SAPISID=([^;]+)/) || document.cookie.match(/(?:^|;\s*)__Secure-3PAPISID=([^;]+)/);
    if (!m) return null;
    const ts = Math.floor(Date.now() / 1000);
    const hash = await sha1Hex(`${ts} ${m[1]} https://www.youtube.com`);
    return `SAPISIDHASH ${ts}_${hash}`;
  }

  async function innertube(endpoint, body, { auth = false } = {}) {
    const context = cfg('INNERTUBE_CONTEXT');
    if (!context) throw new Error('YouTubeの内部設定(ytcfg)が読めません。ページを再読み込みしてください。');
    const key = cfg('INNERTUBE_API_KEY');
    const headers = {
      'content-type': 'application/json',
      'x-origin': 'https://www.youtube.com',
      'x-youtube-client-name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),
      'x-youtube-client-version': String(cfg('INNERTUBE_CONTEXT_CLIENT_VERSION') || (context.client && context.client.clientVersion) || ''),
    };
    if (auth) {
      headers['x-goog-authuser'] = String(cfg('SESSION_INDEX') || 0);
      const a = await authHeader();
      if (!a) throw new Error('ログイン情報が見つかりません（YouTubeにログインしてください）');
      headers.authorization = a;
      const page = cfg('DELEGATED_SESSION_ID');
      if (page) headers['x-goog-pageid'] = page;
    }
    const url = `/youtubei/v1/${endpoint}?prettyPrint=false${key ? '&key=' + encodeURIComponent(key) : ''}`;
    // ログインが要らない検索などはCookieを送らない（検索履歴を汚さず、パーソナライズもされない）
    const res = await fetch(url, { method: 'POST', credentials: auth ? 'include' : 'omit', headers, body: JSON.stringify({ context: clone(context), ...body }) });
    if (!res.ok) throw new Error(`YouTube ${endpoint}: HTTP ${res.status}`);
    return res.json();
  }

  async function browseAll(browseId, max, onProgress, opts = {}) {
    const acc = { videos: [], channels: [], playlists: [] };
    let data = await innertube('browse', { browseId, ...(opts.params ? { params: opts.params } : {}) }, { auth: true });
    let pages = 0;
    for (;;) {
      const x = extractYt(data);
      acc.videos.push(...x.videos); acc.channels.push(...x.channels); acc.playlists.push(...x.playlists);
      pages++;
      if (onProgress) onProgress(acc);
      const n = Math.max(acc.videos.length, acc.channels.length);
      if (!x.continuation || n >= max || pages > 60) break;
      await sleep(jitter(350, 700));
      data = await innertube('browse', { continuation: x.continuation }, { auth: true });
    }
    return acc;
  }

  // ---- 学習 ---------------------------------------------------------------
  async function learnAll() {
    if (state.learnBusy) return;
    state.learnBusy = true;
    const s = state.settings;
    const corpus = emptyCorpus();
    const channels = {};
    const counts = { likes: 0, playlists: 0, subs: 0, history: 0, errors: [] };
    const seenVideos = new Set();
    const addVideos = (videos, sourceKey) => {
      for (const v of videos) {
        if (!v.videoId || seenVideos.has(v.videoId)) continue;
        seenVideos.add(v.videoId);
        addDoc(corpus, tokenize(v.title));
        counts[sourceKey]++;
        if (v.channelId || v.channelName) {
          const key = v.channelId || 'n:' + norm(v.channelName);
          const c = channels[key] || (channels[key] = { id: v.channelId || '', name: v.channelName || '', handle: v.handle || '', likes: 0, sub: false });
          c.likes++;
          if (!c.name && v.channelName) c.name = v.channelName;
        }
      }
    };
    const progress = (label) => (acc) => setLearnStatus(`${label}: ${acc.videos.length || acc.channels.length} 件…`);
    try {
      setLearnStatus('高評価した動画を読み込み中…');
      try {
        const r = await browseAll('VLLL', s.learnMax, progress('高評価'));
        addVideos(r.videos, 'likes');
      } catch (e) { counts.errors.push('高評価: ' + e.message); }

      const lists = [...(s.playlists || [])];
      if (s.includeWatchLater) lists.push('WL');
      for (const pid of lists) {
        try {
          setLearnStatus(`再生リスト ${pid} を読み込み中…`);
          const r = await browseAll('VL' + pid, Math.min(500, s.learnMax), progress('再生リスト'));
          addVideos(r.videos, 'playlists');
        } catch (e) { counts.errors.push(`再生リスト ${pid}: ${e.message}`); }
        await sleep(jitter(400, 800));
      }

      if (s.includeHistory) {
        try {
          setLearnStatus('視聴履歴を読み込み中…');
          const r = await browseAll('FEhistory', s.historyMax, progress('視聴履歴'));
          addVideos(r.videos.slice(0, s.historyMax), 'history');
        } catch (e) { counts.errors.push('視聴履歴: ' + e.message); }
      }

      if (s.includeSubs) {
        try {
          setLearnStatus('登録チャンネルを読み込み中…');
          const r = await browseAll('FEchannels', 2000, progress('登録チャンネル'));
          for (const c of r.channels) {
            const e = channels[c.id] || (channels[c.id] = { id: c.id, name: c.name, handle: c.handle, likes: 0, sub: false });
            e.sub = true; counts.subs++;
          }
        } catch (e) { counts.errors.push('登録チャンネル: ' + e.message); }
      }

      if (corpus.N === 0 && !counts.subs) {
        throw new Error(counts.errors.join(' / ') || '学習できる動画が見つかりませんでした');
      }
      pruneCorpus(corpus, 6000);
      state.learned = { at: Date.now(), corpus, channels, counts };
      store.set('learned', state.learned);
      rebuild(); rescoreAll();
      const msg = `学習完了: 高評価 ${counts.likes} / 再生リスト ${counts.playlists} / 履歴 ${counts.history} / 登録 ${counts.subs}` + (counts.errors.length ? `（一部失敗: ${counts.errors.join(' / ')}）` : '');
      setLearnStatus(msg);
      toast(msg, counts.errors.length ? 'warn' : 'ok', 6000);
    } catch (e) {
      setLearnStatus('学習に失敗: ' + e.message);
      toast('学習に失敗: ' + e.message, 'error', 6000);
    } finally {
      state.learnBusy = false;
      renderPanel();
    }
  }

  async function fetchMyPlaylists() {
    for (const id of ['FEplaylist_aggregation', 'FElibrary']) {
      try {
        const r = await browseAll(id, 300);
        const lists = r.playlists.filter((p) => p.id && !['LL', 'WL'].includes(p.id));
        if (lists.length) return dedupeBy(lists, (p) => p.id);
      } catch (_) { /* 次を試す */ }
    }
    return [];
  }

  function dedupeBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr) if (!m.has(keyFn(x))) m.set(keyFn(x), x);
    return [...m.values()];
  }

  let learnStatusText = '';
  function setLearnStatus(t) {
    learnStatusText = t;
    const el = document.getElementById('ypp-learn-status');
    if (el) el.textContent = t;
  }

  // ---- チャンネル解決（@handle / 名前 → チャンネルID） ----------------------
  async function resolveChannel(entry) {
    const key = resolveKey(entry);
    const hit = state.resolved[key];
    if (hit && hit.id) return hit;
    let out = null;
    try {
      if (entry.type === 'id') {
        out = { id: entry.value, name: '', handle: '' };
      } else if (entry.type === 'handle') {
        const r = await innertube('navigation/resolve_url', { url: 'https://www.youtube.com/' + entry.value });
        const id = r && r.endpoint && r.endpoint.browseEndpoint && r.endpoint.browseEndpoint.browseId;
        if (id) out = { id, name: '', handle: entry.value };
      } else {
        const r = await innertube('search', { query: entry.raw, params: 'EgIQAg==' });
        const chans = extractYt(r).channels;
        const exact = chans.find((c) => norm(c.name) === entry.value);
        const c = exact || chans[0];
        if (c) out = { id: c.id, name: c.name, handle: c.handle };
      }
    } catch (e) {
      console.warn('[ypp] resolve failed', entry.raw, e);
    }
    if (out) {
      state.resolved[key] = { ...out, at: Date.now() };
      store.set('resolved', state.resolved);
    }
    return out;
  }

  // ---- 好み枠（シェルフ） ---------------------------------------------------
  async function refreshShelf(force = false) {
    const s = state.settings;
    if (state.shelfBusy) return;
    if (!force && Date.now() - (state.shelf.at || 0) < s.shelfRefreshHours * 3600e3) return;
    state.shelfBusy = true;
    renderShelf();
    const candidates = [];
    let fetched = 0; const errors = [];
    try {
      // 1) チャンネル: 手動の好きなチャンネル → 学習チャンネル（重み順）
      const chanIds = new Map();
      for (const e of state.manual.likeChannels) {
        if (chanIds.size >= s.shelfChannels) break;
        const r = await resolveChannel(e);
        if (r && r.id) chanIds.set(r.id, '好きなチャンネル');
      }
      const learnedTop = [...state.model.chans.values()].filter((c) => c.id && c.w > 0.5).sort((a, b) => b.w - a.w);
      for (const c of learnedTop) {
        if (chanIds.size >= s.shelfChannels) break;
        if (!chanIds.has(c.id)) chanIds.set(c.id, '学習チャンネル');
      }
      for (const [id] of chanIds) {
        try {
          const res = await fetch(`/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`, { credentials: 'omit' });
          if (res.ok) { candidates.push(...parseRss(await res.text())); fetched++; }
        } catch (e) { errors.push(e.message); }
        await sleep(jitter(250, 550));
      }
      // 2) キーワード検索: 手動キーワード → 学習した語
      const queries = [];
      for (const e of state.manual.likeKeywords) {
        if (e.type === 'text' && queries.length < 8) queries.push(e.raw);
      }
      if (s.shelfUseLearnedTerms) {
        const terms = [...state.model.termPos.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
        for (const t of terms) {
          if (queries.length >= 11) break;
          if (!queries.some((q) => norm(q).includes(t))) queries.push(t);
        }
      }
      for (const q of queries) {
        try {
          const r = await innertube('search', { query: q, params: searchParams(s.shelfPeriod) });
          candidates.push(...extractYt(r).videos);
          fetched++;
        } catch (e) { errors.push(e.message); }
        await sleep(jitter(400, 800));
      }
      const items = pickShelf(candidates, ctx(), { watched: state.watch.ids, dismissed: state.dismissed });
      state.shelf = {
        at: Date.now(),
        items,
        note: `取得元 ${fetched} 件 / 候補 ${candidates.length} 本` + (errors.length ? ` / 失敗 ${errors.length}` : ''),
      };
      store.set('shelf', state.shelf);
      if (!chanIds.size && !queries.length) state.shelf.note = '好きなチャンネル・キーワードを設定するか、学習を実行すると表示されます';
    } catch (e) {
      state.shelf.note = '更新に失敗: ' + e.message;
    } finally {
      state.shelfBusy = false;
      renderShelf();
    }
  }

  let shelfEl = null;
  function ensureShelf() {
    if (!state.settings.shelf || getSurface() !== 'home') { if (shelfEl) shelfEl.remove(); return; }
    const grid = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer');
    if (!grid) return;
    const contents = grid.querySelector(':scope > #contents');
    if (!shelfEl) shelfEl = h('div', { id: 'ypp-shelf' });
    if (shelfEl.parentNode !== grid || (contents && shelfEl.nextElementSibling !== contents)) {
      grid.insertBefore(shelfEl, contents || grid.firstChild);
      renderShelf();
    }
    refreshShelf(false);
  }

  function ago(days) {
    if (days == null) return '';
    if (days < 1 / 24) return 'たった今';
    if (days < 1) return `${Math.round(days * 24)}時間前`;
    if (days < 30) return `${Math.round(days)}日前`;
    if (days < 365) return `${Math.round(days / 30)}か月前`;
    return `${Math.round(days / 365)}年前`;
  }

  function fmtViews(n) {
    if (n == null) return '';
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '億回';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万回';
    return n + '回';
  }

  function renderShelf() {
    if (!shelfEl) return;
    clear(shelfEl);
    const sh = state.shelf;
    const ageNow = sh.at ? (Date.now() - sh.at) / 86400000 : null;
    const items = (sh.items || []).filter((v) => !state.dismissed[v.videoId] && !state.watch.ids[v.videoId]);
    shelfEl.append(
      h('div', { class: 'ypp-shelf-head' },
        h('span', { class: 'ypp-shelf-title' }, '🎯 あなたの好み枠'),
        h('span', { class: 'ypp-shelf-note' }, state.shelfBusy ? '更新中…' : [sh.at ? `${ago(ageNow)}に更新` : '', sh.note].filter(Boolean).join(' · ')),
        h('button', { class: 'ypp-mini', onclick: () => refreshShelf(true), disabled: state.shelfBusy }, '更新'),
        h('button', { class: 'ypp-mini', onclick: () => openPanel('prefs') }, '設定'),
        h('button', { class: 'ypp-mini', title: '好み枠を隠す（設定でいつでも戻せます）', onclick: () => { state.settings.shelf = false; saveSettings(); ensureShelf(); } }, '✕'),
      ),
    );
    if (!items.length) {
      shelfEl.append(h('div', { class: 'ypp-shelf-empty' }, state.shelfBusy ? '好きなチャンネルの新着とキーワード検索から集めています…' : (sh.note || 'まだ候補がありません。「設定」から好きなチャンネル・キーワードを入れるか、「学習」を実行してください。')));
      return;
    }
    const row = h('div', { class: 'ypp-shelf-row' });
    for (const v of items) {
      const href = v.isShort ? `/shorts/${v.videoId}` : `/watch?v=${v.videoId}`;
      row.append(
        h('div', { class: 'ypp-sc' },
          h('a', { class: 'ypp-sc-thumb', href, title: v.reasons.join('\n') },
            h('img', { src: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`, loading: 'lazy', alt: '' }),
            h('span', { class: 'ypp-sc-score' }, '★ ' + v.score.toFixed(1)),
          ),
          h('button', {
            class: 'ypp-sc-x', title: 'この動画を好み枠から外す',
            onclick: (ev) => { ev.preventDefault(); state.dismissed[v.videoId] = Date.now(); trimMap(state.dismissed, 3000); store.set('dismissed', state.dismissed); renderShelf(); },
          }, '✕'),
          h('a', { class: 'ypp-sc-title', href, title: v.title }, v.title),
          h('div', { class: 'ypp-sc-meta' }, [v.channelName, fmtViews(v.views), ago(v.ageDays)].filter(Boolean).join(' · ')),
          h('div', { class: 'ypp-sc-why' }, v.reasons[0] || ''),
        ),
      );
    }
    shelfEl.append(row);
  }

  function trimMap(map, max) {
    const keys = Object.keys(map);
    if (keys.length <= max) return;
    keys.sort((a, b) => map[a] - map[b]);
    for (const k of keys.slice(0, keys.length - max)) delete map[k];
  }

  // ---- カードの読み取り ----------------------------------------------------
  const SELECTORS = {
    home: 'ytd-browse[page-subtype="home"] ytd-rich-item-renderer',
    watch: '#related ytd-compact-video-renderer, #related yt-lockup-view-model',
    search: 'ytd-search ytd-video-renderer, ytd-search yt-lockup-view-model',
  };

  function getSurface() {
    const p = location.pathname;
    if (p === '/' || p === '') return 'home';
    if (p === '/watch') return 'watch';
    if (p === '/results') return 'search';
    return '';
  }

  function surfaceOn(surface) {
    const s = state.settings;
    return s.enabled && ((surface === 'home' && s.surfaceHome) || (surface === 'watch' && s.surfaceWatch) || (surface === 'search' && s.surfaceSearch));
  }

  function videoIdFromHref(href) {
    if (!href) return null;
    if (/[?&]list=/.test(href)) return null; // ミックス・再生リストは対象外
    let m = href.match(/[?&]v=([\w-]{11})/);
    if (m) return { id: m[1], short: false };
    m = href.match(/\/shorts\/([\w-]{11})/);
    if (m) return { id: m[1], short: true };
    return null;
  }

  const firstText = (root, sels) => {
    for (const sel of sels) {
      const el = root.querySelector(sel);
      if (!el) continue;
      const t = (el.getAttribute('title') || el.textContent || '').trim();
      if (t) return t;
    }
    return '';
  };

  const infoCache = new WeakMap();
  function readCard(el) {
    const link = el.querySelector('a[href*="/watch?v="], a[href^="/shorts/"]');
    const vid = videoIdFromHref(link && link.getAttribute('href'));
    if (!vid) return null;
    const cached = infoCache.get(el);
    if (cached && cached.videoId === vid.id) return cached;
    if (el.querySelector('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, feed-ad-metadata-view-model')) return null;
    const title = firstText(el, [
      'h3[title]', '.ytLockupMetadataViewModelTitle', '#video-title', 'a#video-title-link', '.yt-lockup-metadata-view-model__title',
      '.yt-lockup-metadata-view-model-wiz__title', 'h3 a', 'h3', '.shortsLockupViewModelHostMetadataTitle',
    ]);
    if (!title) return null;
    const handleA = el.querySelector('a[href^="/@"]');
    const idA = el.querySelector('a[href^="/channel/UC"]');
    const parts = [...el.querySelectorAll('.ytContentMetadataViewModelMetadataText, .yt-content-metadata-view-model__metadata-text, #metadata-line span')]
      .map((x) => x.textContent.trim()).filter(Boolean);
    let channelName = firstText(el, ['ytd-channel-name #text', '#channel-name #text', 'ytd-channel-name a']) || parts[0] || '';
    if (!channelName && handleA) channelName = handleA.textContent.trim();
    const text = el.innerText || el.textContent || '';
    const info = {
      videoId: vid.id,
      title,
      channelName,
      handle: handleA ? decodeURIComponent(handleA.getAttribute('href').slice(1).split(/[/?#]/)[0]) : '',
      channelId: idA ? (idA.getAttribute('href').match(/UC[\w-]{22}/) || [''])[0] : '',
      views: parseViews(text) != null ? parseViews(text) : viewsFromParts(parts.slice(1)),
      ageDays: parseAgeDays(parts.join(' ')) != null ? parseAgeDays(parts.join(' ')) : parseAgeDays(text),
      isShort: vid.short,
    };
    info.tokens = tokenize(info.title);
    infoCache.set(el, info);
    return info;
  }

  // ---- 採点と表示 ----------------------------------------------------------
  const scoreCache = new Map();
  function scoreOf(info) {
    const c = scoreCache.get(info.videoId);
    if (c && c.v === state.version) return c.r;
    const r = scoreVideo(info, ctx());
    scoreCache.set(info.videoId, { v: state.version, r });
    if (scoreCache.size > 5000) scoreCache.delete(scoreCache.keys().next().value);
    return r;
  }

  function observeBg(info) {
    if (state.bgSeen.has(info.videoId)) return;
    state.bgSeen.add(info.videoId);
    addDoc(state.bg, info.tokens);
    if (state.bg.N > 6000) {
      state.bg.N /= 2;
      for (const k of Object.keys(state.bg.df)) {
        state.bg.df[k] /= 2;
        if (state.bg.df[k] < 0.75) delete state.bg.df[k];
      }
    }
    state.bgDirty = true;
  }

  setInterval(() => {
    if (!state.bgDirty) return;
    state.bgDirty = false;
    pruneCorpus(state.bg, 8000);
    store.set('bg', state.bg);
  }, 15000);

  const CLASS_LIST = ['ypp-boost', 'ypp-dim', 'ypp-hidden', 'ypp-neutral'];

  function decorate(el, info, r, cls) {
    el.classList.add('ypp-card');
    for (const c of CLASS_LIST) el.classList.toggle(c, c === 'ypp-' + cls);
    let ui = el.querySelector(':scope > .ypp-ui');
    if (!ui) {
      ui = h('div', { class: 'ypp-ui' });
      el.append(ui);
    }
    const key = `${info.videoId}|${state.version}|${cls}|${state.settings.showChips}`;
    if (ui.dataset.key === key) return;
    ui.dataset.key = key;
    clear(ui);
    const showChip = state.settings.showChips === 'all' || (state.settings.showChips === 'marked' && (cls === 'boost' || cls === 'dim'));
    if (showChip) {
      ui.append(h('span', { class: 'ypp-chip ypp-chip-' + cls, title: r.reasons.join('\n') || '好み要素なし' },
        (cls === 'boost' ? '★ ' : '') + fmt(r.score)));
    }
    const btn = (label, title, fn) => h('button', {
      class: 'ypp-act', title,
      onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); },
      onmousedown: (ev) => ev.stopPropagation(),
    }, label);
    ui.append(h('span', { class: 'ypp-acts' },
      btn('👍', '好み：このチャンネルとタイトルの傾向を上げる', () => feedbackLike(info)),
      btn('👎', '興味なし：傾向を下げ、YouTubeにも「興味なし」を送る', () => feedbackDislike(el, info)),
      btn('🚫', 'このチャンネルをNGに追加し、YouTubeにも「チャンネルをおすすめに表示しない」を送る', () => feedbackBlock(el, info)),
    ));
  }

  function undecorate(el) {
    el.classList.remove('ypp-card', ...CLASS_LIST);
    el.style.order = '';
    const ui = el.querySelector(':scope > .ypp-ui');
    if (ui) ui.remove();
  }

  // バッチ（読み込まれた塊）ごとに並べ替える。既に見えている上の方は動かさない。
  const batchOf = new Map();
  let batchCounter = 0;

  function reorder(groups, surface) {
    for (const [parent, cards] of groups) {
      if (surface === 'watch') {
        const d = getComputedStyle(parent).display;
        if (!/flex|grid/.test(d)) parent.classList.add('ypp-flexcol');
      }
      let newBatch = null;
      for (const c of cards) {
        const k = state.epoch + ':' + c.info.videoId;
        if (!batchOf.has(k)) {
          if (newBatch == null) newBatch = ++batchCounter;
          batchOf.set(k, newBatch);
        }
        c.batch = batchOf.get(k);
      }
      if (batchOf.size > 4000) batchOf.clear();
      const byBatch = new Map();
      for (const c of cards) {
        if (!byBatch.has(c.batch)) byBatch.set(c.batch, []);
        byBatch.get(c.batch).push(c);
      }
      const minBatch = Math.min(...byBatch.keys());
      for (const [b, list] of byBatch) {
        const sorted = list.map((c, i) => ({ c, i })).sort((x, y) => (y.c.rank - x.c.rank) || (x.i - y.i));
        sorted.forEach(({ c }, rank) => { c.el.style.order = String((b - minBatch + 1) * 1000 + rank); });
      }
      // 動画以外の子要素（棚・続きの読み込み）は、位置を保つ
      let lastOrder = 0;
      for (const child of parent.children) {
        if (child.classList.contains('ypp-card') && child.style.order) { lastOrder = Number(child.style.order); continue; }
        if (/continuation/i.test(child.tagName)) child.style.order = '99999999';
        else child.style.order = String(Math.floor(lastOrder / 1000) * 1000 + 999);
      }
    }
  }

  let scanTimer = 0; let scanFirst = 0;
  function scheduleScan() {
    const now = Date.now();
    if (!scanFirst) scanFirst = now;
    clearTimeout(scanTimer);
    const wait = now - scanFirst > 1000 ? 0 : 200;
    scanTimer = setTimeout(() => { scanFirst = 0; scan(); }, wait);
  }

  function scan() {
    const surface = getSurface();
    ensureFab();
    if (!surface || !surfaceOn(surface)) {
      for (const el of document.querySelectorAll('.ypp-card')) undecorate(el);
      if (shelfEl && surface !== 'home') shelfEl.remove();
      return;
    }
    if (!state.model) rebuild();
    const groups = new Map();
    const reorderOn = (surface === 'home' && state.settings.reorderHome) || (surface === 'watch' && state.settings.reorderWatch);
    for (const el of document.querySelectorAll(SELECTORS[surface])) {
      if (el.tagName === 'YT-LOCKUP-VIEW-MODEL' && el.closest('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer')) continue;
      const info = readCard(el);
      if (!info) continue;
      if (surface !== 'search') observeBg(info);
      const r = scoreOf(info);
      let cls = classify(r, state.settings);
      if (surface === 'search' && cls === 'dim') cls = 'neutral'; // 検索は自分で探しているので薄くしない
      decorate(el, info, r, cls);
      if (reorderOn && !el.closest('ytd-rich-section-renderer')) {
        const parent = el.parentElement;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push({ el, info, rank: cls === 'hidden' ? -100 : r.score });
      }
    }
    if (reorderOn) {
      reorder(groups, surface);
    } else {
      const parents = new Set([...document.querySelectorAll('.ypp-card')].map((el) => el.parentElement).filter(Boolean));
      for (const p of parents) for (const c of p.children) if (c.style.order) c.style.order = '';
    }
    if (surface === 'home') ensureShelf();
  }

  function rescoreAll() {
    scoreCache.clear();
    scan();
  }

  // ---- フィードバック -------------------------------------------------------
  function bumpChannel(info, delta) {
    if (!info.channelName && !info.channelId) return;
    const key = info.channelId || 'n:' + norm(info.channelName);
    const c = state.fb.channels[key] || (state.fb.channels[key] = { id: info.channelId || '', name: info.channelName || '', handle: info.handle || '', fb: 0 });
    c.fb = clamp((c.fb || 0) + delta, -3, 3);
    if (!c.handle && info.handle) c.handle = info.handle;
  }

  function saveFb() {
    pruneCorpus(state.fb.pos, 3000);
    pruneCorpus(state.fb.neg, 3000);
    store.set('fb', state.fb);
    rebuild(); rescoreAll();
  }

  function feedbackLike(info) {
    addDoc(state.fb.pos, info.tokens, 2);
    bumpChannel(info, 1);
    saveFb();
    toast(`👍 「${info.channelName || info.title}」の傾向を上げました`, 'ok');
  }

  async function feedbackDislike(el, info) {
    addDoc(state.fb.neg, info.tokens, 2);
    bumpChannel(info, -0.6);
    saveFb();
    if (state.settings.sendToYoutube) {
      const ok = await sendMenuAction(el, 'notInterested');
      toast(ok ? '👎 学習し、YouTubeにも「興味なし」を送りました' : '👎 学習しました（YouTubeのメニューが見つからず「興味なし」は送れませんでした）', ok ? 'ok' : 'warn');
    } else {
      toast('👎 傾向を下げました', 'ok');
    }
  }

  async function feedbackBlock(el, info) {
    const ref = info.handle || info.channelName;
    if (!ref) { toast('チャンネル名が読めませんでした', 'error'); return; }
    const lines = state.manualText.ngChannels.split(/\r?\n/).map((s) => s.trim());
    if (!lines.includes(ref)) {
      state.manualText.ngChannels = [...lines.filter(Boolean), ref].join('\n');
      store.set('manual', state.manualText);
    }
    let ok = false;
    if (state.settings.sendToYoutube) ok = await sendMenuAction(el, 'dontRecommend');
    rebuild(); rescoreAll();
    toast(`🚫 ${ref} をNGに追加しました` + (state.settings.sendToYoutube ? (ok ? '（YouTubeにも送信）' : '（YouTube側メニューは見つかりませんでした）') : ''), ok || !state.settings.sendToYoutube ? 'ok' : 'warn');
  }

  // ---- YouTubeのメニュー操作（ユーザーが押したときだけ） ----------------------
  const MENU_PATTERNS = {
    notInterested: /^(興味なし|Not interested)$/i,
    dontRecommend: /チャンネルをおすすめに表示しない|Don.t recommend channel/i,
  };

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function findMenuButton(card) {
    const buttons = [...card.querySelectorAll('button')].filter((b) => !b.closest('.ypp-ui'));
    const labeled = buttons.filter((b) => /操作メニュー|その他の操作|アクション|メニュー|Action menu|More actions/i.test(b.getAttribute('aria-label') || ''));
    if (labeled.length) return labeled[labeled.length - 1];
    return card.querySelector('ytd-menu-renderer yt-icon-button button, ytd-menu-renderer button, .yt-lockup-metadata-view-model__menu-button button, button-view-model button');
  }

  function findMenuItem(re) {
    const items = document.querySelectorAll('ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, yt-list-item-view-model, tp-yt-paper-item, [role="menuitem"]');
    for (const it of items) {
      if (!visible(it)) continue;
      const t = (it.textContent || '').trim().replace(/\s+/g, ' ');
      if (re.test(t)) return it.querySelector('[role="menuitem"], button, tp-yt-paper-item') || it;
    }
    return null;
  }

  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const r = fn();
      if (r) return r;
      await sleep(80);
    }
    return null;
  }

  function closeMenus() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  }

  async function sendMenuAction(card, kind) {
    const btn = findMenuButton(card);
    if (!btn) return false;
    btn.click();
    const item = await waitFor(() => findMenuItem(MENU_PATTERNS[kind]), 1800);
    if (!item) { closeMenus(); return false; }
    item.click();
    await sleep(300);
    return true;
  }

  async function bulkNotInterested() {
    if (state.bulkBusy) { state.bulkStop = true; return; }
    const targets = [...document.querySelectorAll('.ypp-card.ypp-dim')].filter((el) => visible(el));
    if (!targets.length) { toast('いま画面に「薄く表示」の動画はありません'); return; }
    state.bulkBusy = true; state.bulkStop = false;
    renderPanel();
    let ok = 0; let ng = 0;
    for (const el of targets) {
      if (state.bulkStop) break;
      const info = infoCache.get(el);
      el.scrollIntoView({ block: 'center' });
      await sleep(jitter(250, 450));
      const done = await sendMenuAction(el, 'notInterested');
      if (done) {
        ok++;
        if (info) { addDoc(state.fb.neg, info.tokens, 1); bumpChannel(info, -0.3); }
      } else ng++;
      setBulkStatus(`送信中… ${ok + ng}/${targets.length}（成功 ${ok}）`);
      await sleep(jitter(900, 1600));
    }
    state.bulkBusy = false;
    saveFb();
    const msg = `「興味なし」を ${ok} 件送りました` + (ng ? `（${ng} 件はメニューが見つからず未送信）` : '') + (state.bulkStop ? '（途中で停止）' : '');
    setBulkStatus(msg); toast(msg, ng ? 'warn' : 'ok', 6000);
    renderPanel();
  }

  let bulkStatusText = '';
  function setBulkStatus(t) {
    bulkStatusText = t;
    const el = document.getElementById('ypp-bulk-status');
    if (el) el.textContent = t;
  }

  // ---- 視聴の記録 -----------------------------------------------------------
  let watchTimer = 0;
  function trackWatch() {
    clearInterval(watchTimer);
    if (getSurface() !== 'watch') return;
    const id = new URLSearchParams(location.search).get('v');
    if (!id) return;
    state.watch.ids[id] = Date.now();
    trimMap(state.watch.ids, 4000);
    store.set('watch', state.watch);
    let played = 0; let counted = false;
    watchTimer = setInterval(() => {
      if (new URLSearchParams(location.search).get('v') !== id) { clearInterval(watchTimer); return; }
      const v = document.querySelector('video.html5-main-video, #movie_player video');
      if (!v || v.paused || v.ended) return;
      played += 1;
      if (!counted && played >= state.settings.watchSeconds && state.settings.learnFromWatch) {
        counted = true;
        const title = firstText(document, ['ytd-watch-metadata h1', 'h1.ytd-watch-metadata', '#title h1']);
        const owner = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a');
        const name = owner ? owner.textContent.trim() : '';
        const href = owner ? owner.getAttribute('href') || '' : '';
        if (title) addDoc(state.watch.corpus, tokenize(title));
        if (name) {
          const key = 'n:' + norm(name);
          const c = state.watch.channels[key] || (state.watch.channels[key] = { id: '', name, handle: href.startsWith('/@') ? decodeURIComponent(href.slice(1)) : '', n: 0 });
          c.n++;
        }
        pruneCorpus(state.watch.corpus, 4000);
        store.set('watch', state.watch);
        rebuild();
      }
    }, 1000);
  }

  // ---- 設定パネル -----------------------------------------------------------
  let panel = null; let panelTab = 'prefs';
  let playlistChoices = null;

  function openPanel(tab) {
    if (tab) panelTab = tab;
    if (!panel) { panel = h('div', { id: 'ypp-panel' }); document.body.append(panel); }
    panel.hidden = false;
    renderPanel();
  }

  function closePanel() { if (panel) panel.hidden = true; }

  function field(label, input, help) {
    return h('label', { class: 'ypp-field' }, h('span', { class: 'ypp-label' }, label), input, help ? h('small', null, help) : null);
  }

  function numInput(key, step = 1, min = 0) {
    return h('input', {
      type: 'number', step, min, value: state.settings[key],
      onchange: (e) => { state.settings[key] = Number(e.target.value) || 0; saveSettings(); rebuild(); rescoreAll(); },
    });
  }

  function checkInput(key, label, after) {
    return h('label', { class: 'ypp-check' },
      h('input', {
        type: 'checkbox', checked: !!state.settings[key],
        onchange: (e) => { state.settings[key] = e.target.checked; saveSettings(); rebuild(); rescoreAll(); if (after) after(); },
      }), label);
  }

  function selectInput(key, options) {
    const sel = h('select', { onchange: (e) => { state.settings[key] = e.target.value; saveSettings(); rebuild(); rescoreAll(); } },
      options.map(([v, l]) => h('option', { value: v }, l)));
    sel.value = state.settings[key];
    return sel;
  }

  function renderPanel() {
    if (!panel || panel.hidden) return;
    clear(panel);
    const tabs = [['prefs', '好み'], ['learn', '学習'], ['view', '表示'], ['ops', '操作'], ['data', 'データ']];
    panel.append(
      h('div', { class: 'ypp-p-head' },
        h('strong', null, '🎯 YouTube Preference Pusher'),
        h('span', { class: 'ypp-ver' }, 'v' + VERSION),
        h('button', { class: 'ypp-mini', onclick: closePanel }, '閉じる')),
      h('div', { class: 'ypp-tabs' }, tabs.map(([k, l]) => h('button', {
        class: 'ypp-tab' + (panelTab === k ? ' on' : ''), onclick: () => { panelTab = k; renderPanel(); },
      }, l))),
    );
    const body = h('div', { class: 'ypp-p-body' });
    panel.append(body);
    ({ prefs: tabPrefs, learn: tabLearn, view: tabView, ops: tabOps, data: tabData })[panelTab](body);
  }

  function tabPrefs(body) {
    const areas = {};
    const area = (key, label, help, ph) => {
      areas[key] = h('textarea', { rows: 5, placeholder: ph, value: state.manualText[key] });
      return field(label, areas[key], help);
    };
    body.append(
      h('p', { class: 'ypp-help' }, '1行に1件。末尾に「 | 2」で重み（省略時はチャンネル +3、キーワード +2）。「//」以降はメモ。キーワードは「/正規表現/」も可。'),
      area('likeChannels', '好きなチャンネル', '@ハンドル、チャンネルURL、UC…のID、またはチャンネル名', '@example\nhttps://www.youtube.com/@example2\nチャンネル名 | 4'),
      area('likeKeywords', '好きなキーワード', 'タイトル・チャンネル名に含まれていれば加点。好み枠の検索にも使います', '機械学習\n将棋 | 3\n/ゆっくり(解説|実況)/'),
      area('ngChannels', 'NGチャンネル（非表示）', '🚫ボタンで自動追加されます', '@noisy_channel'),
      area('ngKeywords', 'NGキーワード（非表示）', '', '炎上\n/【?切り抜き】?/'),
      h('div', { class: 'ypp-row' },
        h('button', {
          class: 'ypp-primary',
          onclick: () => {
            for (const k of Object.keys(areas)) state.manualText[k] = areas[k].value;
            store.set('manual', state.manualText);
            rebuild(); rescoreAll();
            toast('好みを保存しました', 'ok');
          },
        }, '保存して反映'),
        h('button', { onclick: () => { for (const k of Object.keys(areas)) state.manualText[k] = areas[k].value; store.set('manual', state.manualText); rebuild(); refreshShelf(true); toast('保存して好み枠を更新中…'); } }, '保存して好み枠も更新')),
    );
  }

  function tabLearn(body) {
    const L = state.learned;
    const s = state.settings;
    body.append(
      h('p', { class: 'ypp-help' }, '高評価した動画・選んだ再生リスト・登録チャンネルを読み、好きなチャンネルとタイトルの語を学習します。YouTube上の自分のデータを読むだけで、何も書き換えません。'),
      h('div', { class: 'ypp-stat' }, L.at
        ? `前回: ${new Date(L.at).toLocaleString()}　高評価 ${L.counts.likes || 0} / 再生リスト ${L.counts.playlists || 0} / 履歴 ${L.counts.history || 0} / 登録 ${L.counts.subs || 0}`
        : 'まだ学習していません'),
      h('div', { class: 'ypp-row' },
        h('button', { class: 'ypp-primary', disabled: state.learnBusy, onclick: learnAll }, state.learnBusy ? '学習中…' : '今すぐ学習'),
        h('span', { id: 'ypp-learn-status', class: 'ypp-status' }, learnStatusText)),
      checkInput('includeSubs', '登録チャンネルを好みに含める（+0.6）'),
      checkInput('includeWatchLater', '「後で見る」も学習に使う'),
      checkInput('includeHistory', '視聴履歴も学習に使う（高評価が少ないとき向け。今のおすすめの偏りも少し引き継ぎます）'),
      field('↑ 読む履歴の最大件数', numInput('historyMax', 50, 50)),
      field('学習する高評価の最大件数', numInput('learnMax', 100, 100)),
      field('自動で学び直す間隔（日、0で手動のみ）', numInput('autoRelearnDays', 1, 0)),
      checkInput('learnFromWatch', '一定時間見た動画からも学習する（今のおすすめの偏りを引き継ぐので既定はオフ）'),
      field('↑ 何秒見たら学習するか', numInput('watchSeconds', 10, 10)),
    );

    const plBox = h('div', { class: 'ypp-box' });
    const renderPl = () => {
      clear(plBox);
      plBox.append(h('div', { class: 'ypp-label' }, '学習に使う再生リスト'));
      const selected = new Set(s.playlists || []);
      const toggle = (id, on) => {
        if (on) selected.add(id); else selected.delete(id);
        s.playlists = [...selected]; saveSettings();
      };
      const known = new Map((playlistChoices || []).map((p) => [p.id, p.title]));
      for (const id of selected) if (!known.has(id)) known.set(id, id);
      for (const [id, title] of known) {
        plBox.append(h('label', { class: 'ypp-check' },
          h('input', { type: 'checkbox', checked: selected.has(id), onchange: (e) => toggle(id, e.target.checked) }), title));
      }
      const input = h('input', { type: 'text', placeholder: '再生リストのURLまたはID（他人の公開リストも可）' });
      plBox.append(
        h('div', { class: 'ypp-row' },
          h('button', {
            onclick: async (e) => {
              e.target.disabled = true; e.target.textContent = '取得中…';
              try { playlistChoices = await fetchMyPlaylists(); if (!playlistChoices.length) toast('再生リストが見つかりませんでした', 'warn'); }
              catch (err) { toast('取得に失敗: ' + err.message, 'error'); }
              renderPl();
            },
          }, '自分の再生リストを取得')),
        h('div', { class: 'ypp-row' }, input, h('button', {
          onclick: () => {
            const m = input.value.match(/[?&]list=([\w-]+)/) || input.value.trim().match(/^([\w-]{10,})$/);
            if (!m) { toast('再生リストのURLかIDを入れてください', 'warn'); return; }
            toggle(m[1], true); renderPl();
          },
        }, '追加')),
      );
    };
    renderPl();
    body.append(plBox);

    const model = state.model;
    const chans = [...model.chans.values()].filter((c) => c.w).sort((a, b) => b.w - a.w).slice(0, 20);
    const terms = [...model.termPos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    const negTerms = [...model.termNeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    const ignoreAdd = (kind, value) => {
      const set = new Set(state.ignore[kind]); set.add(value);
      state.ignore[kind] = [...set]; store.set('ignore', state.ignore);
      rebuild(); rescoreAll(); renderPanel();
    };
    body.append(
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, '学習したチャンネル（上位）　✕で学習から除外'),
        chans.length ? chans.map((c) => h('div', { class: 'ypp-li' },
          h('span', null, `${c.name || c.handle || c.id}`), h('span', { class: 'ypp-w' }, fmt(c.w)),
          h('button', { class: 'ypp-x', onclick: () => ignoreAdd('channels', c.key) }, '✕'))) : h('small', null, 'なし')),
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, '好みの語（上位）　クリックで除外'),
        h('div', { class: 'ypp-tags' }, terms.length ? terms.map(([t, w]) => h('button', { class: 'ypp-tag', title: `重み ${w.toFixed(2)}（クリックで除外）`, onclick: () => ignoreAdd('terms', t) }, t)) : h('small', null, 'なし'))),
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, '苦手な語（👎から）'),
        h('div', { class: 'ypp-tags' }, negTerms.length ? negTerms.map(([t]) => h('button', { class: 'ypp-tag neg', onclick: () => ignoreAdd('terms', t) }, t)) : h('small', null, 'なし'))),
      (state.ignore.channels.length || state.ignore.terms.length) ? h('div', { class: 'ypp-row' },
        h('small', null, `除外中: チャンネル ${state.ignore.channels.length} / 語 ${state.ignore.terms.length}`),
        h('button', { onclick: () => { state.ignore = { channels: [], terms: [] }; store.set('ignore', state.ignore); rebuild(); rescoreAll(); renderPanel(); } }, '除外を解除')) : null,
    );
  }

  function tabView(body) {
    body.append(
      checkInput('enabled', 'このスクリプトを有効にする'),
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, '対象'),
        checkInput('surfaceHome', 'ホーム'),
        checkInput('reorderHome', '　ホームを好み順に並べ替える（読み込まれた塊ごと）'),
        checkInput('surfaceWatch', '動画ページの関連動画'),
        checkInput('reorderWatch', '　関連動画を好み順に並べ替える'),
        checkInput('surfaceSearch', '検索結果（NG非表示と採点表示のみ。薄くはしない）')),
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, 'しきい値'),
        field('このスコア以上は「好み」として強調', numInput('boostAt', 0.5, -10)),
        field('このスコア以下は「好み要素なし」', numInput('dimAt', 0.5, -10), '0 にすると、好みの手がかりが1つもない動画が対象になります'),
        field('「好み要素なし」の扱い', selectInput('lowAction', [['dim', '薄く表示'], ['hide', '隠す'], ['none', '何もしない']])),
        field('スコア表示', selectInput('showChips', [['marked', '強調・薄表示の動画だけ'], ['all', 'すべて'], ['none', '表示しない']]))),
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, 'フィルタ'),
        checkInput('hideShorts', 'Shortsを隠す'),
        field('最低再生回数（0で無効）', numInput('minViews', 1000, 0)),
        field('何日より古い動画を隠す（0で無効）', numInput('maxAgeDays', 30, 0))),
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, '好み枠（ホーム上部に差し込み）'),
        checkInput('shelf', '好み枠を表示する', () => ensureShelf()),
        field('表示する本数', numInput('shelfCount', 1, 4)),
        field('更新間隔（時間）', numInput('shelfRefreshHours', 1, 1)),
        field('何日以内の動画から選ぶか', numInput('shelfMaxAgeDays', 1, 1)),
        field('キーワード検索の期間', selectInput('shelfPeriod', [['week', '今週'], ['month', '今月']])),
        field('1チャンネルあたりの最大本数', numInput('shelfPerChannel', 1, 1)),
        field('新着を見るチャンネル数', numInput('shelfChannels', 1, 0)),
        checkInput('shelfUseLearnedTerms', '学習した語でも検索する')),
    );
  }

  function tabOps(body) {
    const dimCount = [...document.querySelectorAll('.ypp-card.ypp-dim')].filter((el) => visible(el)).length;
    body.append(
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, '一括「興味なし」'),
        h('p', { class: 'ypp-help' }, 'いま画面に読み込まれている「薄く表示」の動画に、YouTubeの「興味なし」を1本ずつ送ります。押したときだけ動き、間隔をあけて順番に処理します。もう一度押すと止まります。'),
        h('div', { class: 'ypp-row' },
          h('button', { class: state.bulkBusy ? '' : 'ypp-danger', onclick: bulkNotInterested }, state.bulkBusy ? '停止する' : `薄い動画 ${dimCount} 件に「興味なし」を送る`),
          h('span', { id: 'ypp-bulk-status', class: 'ypp-status' }, bulkStatusText))),
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, 'カードのボタン'),
        h('p', { class: 'ypp-help' }, '各動画にマウスを乗せると 👍 / 👎 / 🚫 が出ます。👍 はこのスクリプト内の学習だけ、👎 と 🚫 は下の設定がオンならYouTubeにも送ります。'),
        checkInput('sendToYoutube', '👎/🚫 を押したらYouTubeにも「興味なし」「チャンネルをおすすめに表示しない」を送る')),
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, '好み枠'),
        h('div', { class: 'ypp-row' },
          h('button', { onclick: () => refreshShelf(true) }, '今すぐ更新'),
          h('button', { onclick: () => { state.dismissed = {}; store.set('dismissed', state.dismissed); renderShelf(); toast('外した動画を戻しました'); } }, '✕で外した動画を戻す'))),
    );
  }

  function tabData(body) {
    const ta = h('textarea', { rows: 8, placeholder: 'ここにエクスポートしたJSONを貼り付けて「読み込む」' });
    body.append(
      h('p', { class: 'ypp-help' }, '設定と学習データはこのブラウザのViolentmonkeyにだけ保存されています。別のブラウザへ移すときはエクスポート→インポートしてください。'),
      h('div', { class: 'ypp-row' },
        h('button', {
          onclick: () => {
            const data = { v: 1, settings: state.settings, manual: state.manualText, learned: state.learned, fb: state.fb, ignore: state.ignore, resolved: state.resolved };
            ta.value = JSON.stringify(data);
            ta.select();
            try { navigator.clipboard.writeText(ta.value); toast('コピーしました', 'ok'); } catch (_) { toast('テキストを選択しました。コピーしてください'); }
          },
        }, 'エクスポート'),
        h('button', {
          onclick: () => {
            try {
              const d = JSON.parse(ta.value);
              if (d.settings) { state.settings = { ...DEFAULT_SETTINGS, ...d.settings }; saveSettings(); }
              if (d.manual) { state.manualText = { ...DEFAULT_MANUAL, ...d.manual }; store.set('manual', state.manualText); }
              if (d.learned) { state.learned = d.learned; store.set('learned', d.learned); }
              if (d.fb) { state.fb = d.fb; store.set('fb', d.fb); }
              if (d.ignore) { state.ignore = d.ignore; store.set('ignore', d.ignore); }
              if (d.resolved) { state.resolved = d.resolved; store.set('resolved', d.resolved); }
              rebuild(); rescoreAll(); renderPanel(); toast('読み込みました', 'ok');
            } catch (e) { toast('JSONを読めませんでした: ' + e.message, 'error'); }
          },
        }, '読み込む')),
      ta,
      h('div', { class: 'ypp-box' },
        h('div', { class: 'ypp-label' }, 'リセット'),
        h('div', { class: 'ypp-row' },
          h('button', { onclick: () => { state.fb = { pos: emptyCorpus(), neg: emptyCorpus(), channels: {} }; store.set('fb', state.fb); rebuild(); rescoreAll(); renderPanel(); toast('👍/👎 の学習を消しました'); } }, '👍/👎 の学習を消す'),
          h('button', { onclick: () => { state.learned = { at: 0, corpus: emptyCorpus(), channels: {}, counts: {} }; store.set('learned', state.learned); rebuild(); rescoreAll(); renderPanel(); toast('高評価などからの学習を消しました'); } }, '高評価などの学習を消す'),
          h('button', { onclick: () => { state.bg = emptyCorpus(); state.bgSeen.clear(); store.set('bg', state.bg); state.watch = { ids: {}, corpus: emptyCorpus(), channels: {} }; store.set('watch', state.watch); rebuild(); rescoreAll(); toast('背景統計と視聴記録を消しました'); } }, '背景統計・視聴記録を消す'))),
    );
  }

  // ---- 起動 ----------------------------------------------------------------
  let fab = null;
  function ensureFab() {
    if (fab && fab.isConnected) return;
    fab = h('button', { id: 'ypp-fab', title: 'YouTube Preference Pusher の設定', onclick: () => (panel && !panel.hidden ? closePanel() : openPanel()) }, '🎯');
    document.body.append(fab);
  }

  addStyle(`
    .ypp-card { position: relative; }
    .ypp-card.ypp-hidden { display: none !important; }
    .ypp-card.ypp-dim { opacity: .38; transition: opacity .15s; }
    .ypp-card.ypp-dim:hover { opacity: 1; }
    .ypp-card.ypp-boost { outline: 2px solid rgba(46, 160, 67, .55); outline-offset: 2px; border-radius: 12px; }
    .ypp-flexcol { display: flex !important; flex-direction: column !important; }
    .ypp-ui { position: absolute; top: 6px; left: 6px; z-index: 30; display: flex; gap: 4px; align-items: center; pointer-events: none; font: 600 12px/1 Roboto, system-ui, sans-serif; }
    .ypp-ui > * { pointer-events: auto; }
    .ypp-chip { padding: 4px 7px; border-radius: 6px; background: rgba(0,0,0,.72); color: #fff; }
    .ypp-chip-boost { background: rgba(31, 136, 61, .92); }
    .ypp-chip-dim { background: rgba(90, 90, 90, .85); }
    .ypp-acts { display: none; gap: 3px; }
    .ypp-card:hover .ypp-acts { display: inline-flex; }
    .ypp-act { border: 0; border-radius: 6px; padding: 4px 6px; background: rgba(0,0,0,.72); color: #fff; cursor: pointer; font-size: 13px; line-height: 1; }
    .ypp-act:hover { background: rgba(0,0,0,.92); }

    #ypp-shelf { margin: 8px 8px 20px; padding: 12px 14px 14px; border-radius: 14px; background: var(--yt-spec-badge-chip-background, rgba(0,0,0,.05)); color: var(--yt-spec-text-primary, #0f0f0f); font-family: Roboto, system-ui, sans-serif; width: calc(100% - 16px); box-sizing: border-box; }
    .ypp-shelf-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .ypp-shelf-title { font-size: 16px; font-weight: 700; }
    .ypp-shelf-note { font-size: 12px; opacity: .7; flex: 1; }
    .ypp-shelf-empty { font-size: 13px; opacity: .75; padding: 6px 0; }
    .ypp-shelf-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; }
    .ypp-sc { position: relative; flex: 0 0 220px; min-width: 0; }
    .ypp-sc-thumb { position: relative; display: block; border-radius: 10px; overflow: hidden; aspect-ratio: 16 / 9; background: #0003; }
    .ypp-sc-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ypp-sc-score { position: absolute; left: 6px; top: 6px; padding: 3px 6px; border-radius: 6px; background: rgba(31,136,61,.92); color: #fff; font-size: 11px; font-weight: 700; }
    .ypp-sc-x { position: absolute; right: 6px; top: 6px; border: 0; border-radius: 6px; background: rgba(0,0,0,.7); color: #fff; cursor: pointer; font-size: 11px; padding: 3px 6px; opacity: 0; }
    .ypp-sc:hover .ypp-sc-x { opacity: 1; }
    .ypp-sc-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 6px; font-size: 14px; font-weight: 600; line-height: 1.35; color: inherit; text-decoration: none; }
    .ypp-sc-meta, .ypp-sc-why { font-size: 12px; opacity: .72; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ypp-sc-why { color: #1f883d; opacity: 1; }
    html[dark] .ypp-sc-why { color: #6fdd8b; }

    #ypp-fab { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; width: 36px; height: 36px; border-radius: 50%; border: 1px solid #8884; background: var(--yt-spec-base-background, #fff); font-size: 18px; cursor: pointer; box-shadow: 0 2px 8px #0003; }
    html:has(:fullscreen) #ypp-fab { display: none; }

    #ypp-panel { position: fixed; right: 16px; top: 64px; z-index: 2147483001; width: 440px; max-width: calc(100vw - 32px); max-height: calc(100vh - 88px); display: flex; flex-direction: column; border-radius: 14px; border: 1px solid #8884; background: var(--yt-spec-base-background, #fff); color: var(--yt-spec-text-primary, #0f0f0f); box-shadow: 0 12px 40px #0005; font: 13px/1.5 Roboto, system-ui, sans-serif; }
    #ypp-panel[hidden] { display: none; }
    .ypp-p-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 6px; }
    .ypp-p-head strong { font-size: 15px; flex: 1; }
    .ypp-ver { opacity: .55; font-size: 11px; }
    .ypp-tabs { display: flex; gap: 4px; padding: 0 12px 8px; border-bottom: 1px solid #8883; }
    .ypp-tab { border: 0; background: transparent; color: inherit; padding: 6px 10px; border-radius: 8px; cursor: pointer; font: inherit; }
    .ypp-tab.on { background: #8882; font-weight: 700; }
    .ypp-p-body { overflow-y: auto; padding: 10px 14px 16px; }
    .ypp-p-body textarea, .ypp-p-body input[type=text], .ypp-p-body input[type=number], .ypp-p-body select { width: 100%; box-sizing: border-box; border: 1px solid #8886; border-radius: 8px; padding: 6px 8px; background: transparent; color: inherit; font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .ypp-p-body select option { color: #000; }
    .ypp-p-body input[type=number] { width: 120px; }
    .ypp-field { display: block; margin: 10px 0; }
    .ypp-field small { display: block; opacity: .65; margin-top: 2px; }
    .ypp-label { display: block; font-weight: 700; margin-bottom: 4px; }
    .ypp-check { display: flex; gap: 6px; align-items: flex-start; margin: 5px 0; cursor: pointer; }
    .ypp-check input { margin-top: 3px; }
    .ypp-help { opacity: .75; margin: 4px 0 8px; }
    .ypp-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
    .ypp-row input[type=text] { flex: 1; width: auto; }
    .ypp-box { border: 1px solid #8883; border-radius: 10px; padding: 8px 10px; margin: 10px 0; }
    .ypp-stat { padding: 6px 8px; border-radius: 8px; background: #8881; margin: 6px 0; }
    .ypp-status { opacity: .8; font-size: 12px; }
    .ypp-li { display: flex; gap: 8px; align-items: center; padding: 2px 0; }
    .ypp-li span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ypp-w { font-variant-numeric: tabular-nums; opacity: .8; }
    .ypp-tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .ypp-tag { border: 1px solid #1f883d66; background: #1f883d14; color: inherit; border-radius: 999px; padding: 2px 8px; cursor: pointer; font: inherit; font-size: 12px; }
    .ypp-tag.neg { border-color: #cf222e66; background: #cf222e14; }
    #ypp-panel button:not(.ypp-tab):not(.ypp-tag), #ypp-shelf button { border: 1px solid #8886; background: transparent; color: inherit; border-radius: 8px; padding: 5px 10px; cursor: pointer; font: inherit; font-size: 12px; }
    #ypp-panel button:disabled, #ypp-shelf button:disabled { opacity: .5; cursor: default; }
    #ypp-panel .ypp-primary { background: #1f883d; border-color: #1f883d; color: #fff; }
    #ypp-panel .ypp-danger { background: #cf222e; border-color: #cf222e; color: #fff; }
    #ypp-panel .ypp-x { padding: 0 6px; }

    #ypp-toast { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 20px); z-index: 2147483002; max-width: min(640px, calc(100vw - 32px)); padding: 10px 14px; border-radius: 10px; background: #222; color: #fff; font: 13px/1.45 Roboto, system-ui, sans-serif; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; box-shadow: 0 6px 20px #0006; }
    #ypp-toast.show { opacity: 1; transform: translate(-50%, 0); }
    #ypp-toast[data-kind=ok] { background: #1f6f3a; }
    #ypp-toast[data-kind=warn] { background: #7a5a00; }
    #ypp-toast[data-kind=error] { background: #8e1b23; }
  `);

  rebuild();

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('好みの設定を開く', () => openPanel('prefs'));
    GM_registerMenuCommand('今すぐ学習（高評価・再生リスト・登録）', () => { openPanel('learn'); learnAll(); });
    GM_registerMenuCommand('好み枠を今すぐ更新', () => refreshShelf(true));
    GM_registerMenuCommand('薄い動画に一括「興味なし」', () => { openPanel('ops'); bulkNotInterested(); });
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', () => { state.epoch++; scheduleScan(); trackWatch(); });
  scheduleScan();
  trackWatch();

  // 自動で学び直す（ページを開いて少し落ち着いてから、1日1回まで試す）
  setTimeout(() => {
    const days = state.settings.autoRelearnDays;
    if (!days) return;
    const lastTry = Number(store.get('lastAutoLearn', 0)) || 0;
    if (Date.now() - lastTry < 86400e3) return;
    if (state.learned.at && Date.now() - state.learned.at < days * 86400e3) return;
    store.set('lastAutoLearn', Date.now());
    learnAll();
  }, 15000);
})();
