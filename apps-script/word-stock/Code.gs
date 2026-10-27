/**
 * Word Stock receiver for language-reactor-word-stock.user.js
 *
 * Setup:
 *   1. Create a Google Spreadsheet, then open 拡張機能 > Apps Script.
 *   2. Replace Code.gs with this file and save.
 *   3. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *        実行するユーザー: 自分 / アクセスできるユーザー: 全員
 *   4. Copy the Web app URL (…/exec) and paste it into the userscript menu
 *      「単語ストック: 保存先URLを設定」.
 *
 * The same word (case-insensitive) is not added twice: its count and
 * last-saved time are updated, and a new example sentence is appended.
 */

const SHEET_NAME = '単語';
const HEADERS = ['単語', '意味', '例文', '動画', 'リンク', '追加日時', '回数', '最終保存', 'メモ'];
const COL = { word: 1, meaning: 2, example: 3, title: 4, link: 5, added: 6, count: 7, last: 8 };
const MAX_EXAMPLES = 3;

function getSheet_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setColumnWidth(COL.example, 360);
  }
  return sheet;
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const word = String(data.word || '').trim();
    if (!word) return json_({ ok: false, error: 'word is empty' });

    const sheet = getSheet_();
    const now = new Date();
    const example = String(data.example || '').trim();
    const link = String(data.url || '');
    const linkCell = link
      ? '=HYPERLINK("' + link.replace(/"/g, '""') + '","▶")'
      : '';

    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const words = sheet.getRange(2, COL.word, lastRow - 1, 1).getValues();
      const key = word.toLowerCase();
      for (let i = 0; i < words.length; i++) {
        if (String(words[i][0]).trim().toLowerCase() !== key) continue;
        const row = i + 2;
        const count = Number(sheet.getRange(row, COL.count).getValue()) || 1;
        sheet.getRange(row, COL.count).setValue(count + 1);
        sheet.getRange(row, COL.last).setValue(now);
        if (example) {
          const cell = sheet.getRange(row, COL.example);
          const examples = String(cell.getValue() || '').split('\n').filter(String);
          if (examples.indexOf(example) === -1) {
            examples.push(example);
            cell.setValue(examples.slice(-MAX_EXAMPLES).join('\n'));
          }
        }
        if (data.meaning && !sheet.getRange(row, COL.meaning).getValue()) {
          sheet.getRange(row, COL.meaning).setValue(data.meaning);
        }
        return json_({ ok: true, duplicate: true, count: count + 1 });
      }
    }

    sheet.appendRow([
      word, String(data.meaning || ''), example, String(data.title || ''),
      linkCell, now, 1, now, ''
    ]);
    return json_({ ok: true, duplicate: false, count: 1 });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

// Opening the URL in a browser confirms the deployment works.
function doGet() {
  getSheet_();
  return json_({ ok: true, message: 'Word Stock is ready' });
}
