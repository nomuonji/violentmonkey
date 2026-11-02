/**
 * SNS Post Stock receiver for sns-post-stock.user.js (X / Threads).
 *
 * Setup:
 *   1. Create a Google Spreadsheet, then open 拡張機能 > Apps Script.
 *   2. Replace Code.gs with this file and save.
 *   3. (Optional, for agents) プロジェクトの設定 > スクリプト プロパティ に
 *        READ_TOKEN = <long random string>
 *      を追加すると、GET ?action=list&token=… で保存済み投稿をJSONで読めます。
 *      READ_TOKEN が無い間は読み出しAPIは無効です。
 *   4. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *        実行するユーザー: 自分 / アクセスできるユーザー: 全員
 *   5. Copy the Web app URL (…/exec) and paste it into the userscript menu
 *      「投稿ストック: 保存先URLを設定」.
 *
 * One row per post (platform + post ID). Saving the same post again updates
 * the metrics, count and last-saved time, and appends a metrics snapshot to
 * the JSON column so engagement growth can be analysed later.
 *
 * Tags live in the タグ column as "tag1, tag2" (editable by hand). POST bodies:
 *   { ...post, addTags?: [], removeTags?: [] }          save / re-save (+ tags)
 *   { action: 'tag', platform, postId, addTags, removeTags }  change tags only
 *   { action: 'tags' }                                   list every tag in use
 */

const SHEET_NAME = '投稿';
const HEADERS = [
  'キー', '保存日時', 'SNS', '投稿者', 'ハンドル', '本文', '投稿日時',
  'いいね', 'リポスト', '返信', '引用', 'ブックマーク', '表示', 'シェア',
  'メディア数', 'リンク', '回数', '最終保存', 'タグ', 'メモ', 'JSON'
];
const COL = {};
HEADERS.forEach((name, i) => { COL[name] = i + 1; });
const MAX_SNAPSHOTS = 30;
const MAX_CELL = 49000; // Sheets cell limit is 50,000 characters.

function getSheet_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = book.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setColumnWidth(COL['本文'], 420);
    sheet.setColumnWidth(COL['JSON'], 200);
    sheet.hideColumns(COL['キー']);
  }
  return sheet;
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

// Keep user text from being interpreted as a formula.
function safe_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;
  let text = String(value);
  if (text.length > MAX_CELL) text = text.slice(0, MAX_CELL) + '…';
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function num_(value) {
  return typeof value === 'number' && isFinite(value) ? value : '';
}

function parseTags_(value) {
  return String(value || '').split(/\s*[,、，]\s*/).map(t => t.trim()).filter(Boolean);
}

function cleanTag_(tag) {
  return String(tag || '').replace(/[,、，\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

// Existing tags + addTags − removeTags (case-insensitive, keeps first spelling).
function mergeTags_(current, add, remove) {
  const out = parseTags_(current);
  const has = t => out.some(x => x.toLowerCase() === t.toLowerCase());
  (add || []).map(cleanTag_).filter(Boolean).forEach(t => { if (!has(t)) out.push(t); });
  const drop = (remove || []).map(t => cleanTag_(t).toLowerCase());
  return out.filter(t => drop.indexOf(t.toLowerCase()) === -1);
}

function allTags_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const counts = {};
  const names = {};
  sheet.getRange(2, COL['タグ'], lastRow - 1, 1).getValues().forEach(r => {
    parseTags_(r[0]).forEach(t => {
      const k = t.toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
      if (!names[k]) names[k] = t;
    });
  });
  return Object.keys(counts)
    .map(k => ({ name: names[k], count: counts[k] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function findRow_(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const hit = sheet.getRange(2, COL['キー'], lastRow - 1, 1)
    .createTextFinder(key).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function rowValues_(post, record, key, added, count, now, tags, memo) {
  const m = post.metrics || {};
  const link = String(post.url || '');
  return [
    key, added, post.platform, safe_(post.author && post.author.name),
    safe_(post.author && post.author.handle), safe_(post.text),
    post.createdAt ? new Date(post.createdAt) : '',
    num_(m.likes), num_(m.reposts), num_(m.replies), num_(m.quotes),
    num_(m.bookmarks), num_(m.views), num_(m.shares),
    (post.media || []).length,
    link ? '=HYPERLINK("' + link.replace(/"/g, '""') + '","開く")' : '',
    count, now, safe_(tags), safe_(memo), safe_(JSON.stringify(record))
  ];
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const post = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (post.action === 'tags') return json_({ ok: true, tags: allTags_(getSheet_()) });
    const addTags = post.addTags || [];
    const removeTags = post.removeTags || [];
    delete post.addTags;
    delete post.removeTags;
    const platform = String(post.platform || '').trim();
    const id = String(post.postId || '').trim();
    if (!platform || !id) return json_({ ok: false, error: 'platform / postId is empty' });

    const sheet = getSheet_();
    const key = platform + ':' + id;
    const now = new Date();
    const snapshot = { at: now.toISOString(), metrics: post.metrics || {} };
    const row = findRow_(sheet, key);

    if (post.action === 'tag') {
      if (!row) return json_({ ok: false, error: 'post is not saved yet' });
      const cell = sheet.getRange(row, COL['タグ']);
      const tags = mergeTags_(cell.getValue(), addTags, removeTags);
      cell.setValue(safe_(tags.join(', ')));
      return json_({ ok: true, tags: tags });
    }

    if (row) {
      const current = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
      let previous = {};
      try { previous = JSON.parse(String(current[COL['JSON'] - 1] || '{}')); } catch (err) {}
      const snapshots = (previous.snapshots || []).concat([snapshot]).slice(-MAX_SNAPSHOTS);
      const count = (Number(current[COL['回数'] - 1]) || 1) + 1;
      const record = Object.assign({}, post, {
        firstSavedAt: previous.firstSavedAt || snapshot.at,
        lastSavedAt: snapshot.at,
        saveCount: count,
        snapshots: snapshots
      });
      // Keep the earlier text if this save only saw a truncated version.
      if (post.truncated && previous.text && String(previous.text).length > String(post.text || '').length) {
        record.text = previous.text;
        record.truncated = previous.truncated;
      }
      const tags = mergeTags_(current[COL['タグ'] - 1], addTags, removeTags);
      const values = rowValues_(record, record, key, current[COL['保存日時'] - 1], count, now,
        tags.join(', '), current[COL['メモ'] - 1]);
      sheet.getRange(row, 1, 1, HEADERS.length).setValues([values]);
      return json_({ ok: true, duplicate: true, count: count, tags: tags });
    }

    const record = Object.assign({}, post, {
      firstSavedAt: snapshot.at, lastSavedAt: snapshot.at, saveCount: 1, snapshots: [snapshot]
    });
    const tags = mergeTags_('', addTags, removeTags);
    sheet.appendRow(rowValues_(record, record, key, now, 1, now, tags.join(', '), ''));
    return json_({ ok: true, duplicate: false, count: 1, tags: tags });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * GET (no params)                 → health check.
 * GET ?action=list&token=…        → saved posts as JSON (newest first).
 *     &platform=x|threads  &since=ISO date (last saved)  &limit=N (default 200, max 2000)
 * GET ?action=get&token=…&key=x:123 → one post.
 * GET ?action=tags&token=…         → every tag with its post count.
 *     list also accepts &tag=name (posts carrying that tag).
 * Each item is the stored JSON record plus the sheet's タグ / メモ columns.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const sheet = getSheet_();
  if (!p.action) return json_({ ok: true, message: 'SNS Post Stock is ready' });

  const expected = PropertiesService.getScriptProperties().getProperty('READ_TOKEN');
  if (!expected) return json_({ ok: false, error: 'READ_TOKEN is not set (reading is disabled)' });
  if (p.token !== expected) return json_({ ok: false, error: 'invalid token' });

  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues() : [];
  const toItem = r => {
    let record = {};
    try { record = JSON.parse(String(r[COL['JSON'] - 1] || '{}')); } catch (err) {}
    record.key = r[COL['キー'] - 1];
    record.tags = parseTags_(r[COL['タグ'] - 1]);
    record.memo = String(r[COL['メモ'] - 1] || '');
    return record;
  };

  if (p.action === 'tags') return json_({ ok: true, tags: allTags_(sheet) });
  if (p.action === 'get') {
    const hit = rows.find(r => r[COL['キー'] - 1] === p.key);
    return hit ? json_({ ok: true, item: toItem(hit) }) : json_({ ok: false, error: 'not found' });
  }
  if (p.action !== 'list') return json_({ ok: false, error: 'unknown action' });

  const since = p.since ? new Date(p.since) : null;
  const limit = Math.min(Math.max(Number(p.limit) || 200, 1), 2000);
  const items = rows
    .filter(r => !p.platform || r[COL['SNS'] - 1] === p.platform)
    .filter(r => !since || new Date(r[COL['最終保存'] - 1]) >= since)
    .filter(r => !p.tag || parseTags_(r[COL['タグ'] - 1]).some(t => t.toLowerCase() === String(p.tag).toLowerCase()))
    .sort((a, b) => new Date(b[COL['最終保存'] - 1]) - new Date(a[COL['最終保存'] - 1]))
    .slice(0, limit)
    .map(toItem);
  return json_({ ok: true, total: rows.length, count: items.length, items: items });
}
