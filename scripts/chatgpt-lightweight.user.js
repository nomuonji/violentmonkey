// ==UserScript==
// @name         ChatGPT Lightweight
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.0.0
// @description  ChatGPTのアニメーションや装飾を抑え、会話画面の描画負荷を軽減します。
// @author       nomuonji
// @match        *://chatgpt.com/*
// @match        *://*.chatgpt.com/*
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/chatgpt-lightweight.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/chatgpt-lightweight.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const css = String.raw`
/* ────────────────────────────
     軽量版の目印
     ──────────────────────────── */

  body::after {
    content: "⚡ 軽量版";
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 2147483647;

    padding: 5px 9px;
    border: 1px solid rgba(16, 163, 127, 0.45);
    border-radius: 6px;

    color: #0a7d63;
    background: rgba(238, 255, 250, 0.92);

    font-family:
      system-ui,
      -apple-system,
      "Segoe UI",
      sans-serif;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.04em;

    box-shadow: none;
    pointer-events: none;
    user-select: none;
  }

  /* ダークモード用 */
  html.dark body::after {
    color: #74e8ca;
    background: rgba(10, 35, 30, 0.92);
    border-color: rgba(116, 232, 202, 0.4);
  }

  /* ────────────────────────────
     アニメーション・画面効果を軽量化
     ──────────────────────────── */

  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
  }

  /* ポップアップ背景などのぼかしを無効化 */
  [class*="backdrop-blur"],
  [class*="backdrop-filter"] {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }

  /* 大きな影を簡略化 */
  [class*="shadow-xl"],
  [class*="shadow-2xl"],
  [class*="drop-shadow"] {
    box-shadow: none !important;
    filter: none !important;
  }

  /* ────────────────────────────
     ホーム画面を整理
     ──────────────────────────── */

  /* 「画像を作成」「文章を書く」などの提案カード */
  [data-testid="use-case-prompt-chips"] {
    display: none !important;
  }

  /* モバイル用スプラッシュ画面 */
  [data-testid="mobile-splash-screen"] {
    display: none !important;
  }

  /* フッター調整用の空白 */
  [data-testid="thread-footer-overflow-spacer"] {
    display: none !important;
  }

  /* アプリダウンロードボタン */
  button[aria-label="Download apps"] {
    display: none !important;
  }

  /* ────────────────────────────
     会話画面の描画を軽量化
     ──────────────────────────── */

  /* 画面外の過去メッセージ描画を省略 */
  main [data-message-author-role] {
    content-visibility: auto;
    contain-intrinsic-size: auto 500px;
  }

  main img,
  main video,
  main canvas {
    content-visibility: auto;
  }

  main pre {
    box-shadow: none !important;
    filter: none !important;
  }

  /* ────────────────────────────
     サイドバー
     ──────────────────────────── */

  nav[aria-label="Chat history"] {
    scrollbar-width: thin !important;
  }

  /* 会話の「…」ボタンはフォーカス時だけ表示 */
  [data-testid^="history-item-"][data-testid$="-options"] {
    opacity: 0 !important;
  }

  [data-testid^="history-item-"][data-testid$="-options"]:hover,
  [data-testid^="history-item-"][data-testid$="-options"]:focus-visible {
    opacity: 1 !important;
  }

  /* ────────────────────────────
     入力欄などの主要機能を保護
     ──────────────────────────── */

  [data-testid="composer-plus-btn"],
  #composer-submit-button,
  [aria-label="Chat with ChatGPT"],
  [data-message-author-role] {
    visibility: visible !important;
  }

  /* ────────────────────────────
     任意設定
     コメントを外すと有効になる
     ──────────────────────────── */

  /*
  [data-testid="sidebar-item-library"],
  [data-testid="sidebar-item-recall"],
  [data-testid="sidebar-item-tasks"],
  [data-testid="plugins-button"] {
    display: none !important;
  }
  */

  /*
  #page-header {
    display: none !important;
  }
  */
`;

  const style = document.createElement('style');
  style.id = 'vm-chatgpt-lightweight-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
})();
