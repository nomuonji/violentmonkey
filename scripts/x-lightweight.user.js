// ==UserScript==
// @name         X Lightweight
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.0.0
// @description  Xの不要UI・画面効果を減らし、動画クリックだけでポスト詳細へ遷移する挙動を防止します。
// @author       nomuonji
// @match        https://x.com/*
// @match        https://twitter.com/*
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/x-lightweight.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/x-lightweight.user.js
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  /* ────────────────────────────
     CSS
     ──────────────────────────── */

  const css = String.raw`

  /* ────────────────────────────
     軽量版の目印
     ──────────────────────────── */

  body::after {
    content: "⚡ 軽量版";
    position: fixed;
    left: 12px;
    bottom: 12px;
    z-index: 2147483647;

    padding: 5px 9px;
    border: 1px solid rgba(29, 155, 240, 0.45);
    border-radius: 6px;

    color: rgb(15, 105, 165);
    background: rgba(240, 250, 255, 0.94);

    font-family:
      TwitterChirp,
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

  /* Xのダークモード */
  body[style*="background-color: rgb(0, 0, 0)"]::after,
  body[style*="background-color: rgb(21, 32, 43)"]::after {
    color: rgb(116, 200, 255);
    background: rgba(10, 25, 35, 0.94);
    border-color: rgba(116, 200, 255, 0.4);
  }

  /* 写真・動画の全画面表示中は目印を隠す */
  html:has(:fullscreen) body::after {
    display: none !important;
  }

  /* ────────────────────────────
     右側カラムを削除
     ──────────────────────────── */

  [data-testid="sidebarColumn"] {
    display: none !important;
  }

  main[role="main"] {
    justify-content: flex-start !important;
  }

  /* ────────────────────────────
     Grok・チャットドロワー
     ──────────────────────────── */

  [data-testid="GrokDrawer"],
  [data-testid="GrokDrawerHeader"],
  [data-testid="chat-drawer-root"],
  [data-testid="chat-drawer-main"] {
    display: none !important;
  }

  nav[aria-label="メインメニュー"] a[href="/i/grok"],
  nav[aria-label="Primary"] a[href="/i/grok"] {
    display: none !important;
  }

  article[data-testid="tweet"] button[aria-label*="Grok"],
  article[data-testid="tweet"] button[aria-label*="grok"] {
    display: none !important;
  }

  /* ────────────────────────────
     プレミアム・収益化関連の誘導
     ──────────────────────────── */

  [data-testid="premium-signup-tab"],
  aside[aria-label="プレミアムにサブスクライブ"],
  aside[aria-label="Subscribe to Premium"],
  a[href="/i/premium_sign_up"],
  a[href^="/i/jf/creators"] {
    display: none !important;
  }

  nav[aria-label="メインメニュー"] a[href="/i/history"],
  nav[aria-label="Primary"] a[href="/i/history"] {
    display: none !important;
  }

  /* ────────────────────────────
     タイムライン内の追加提案
     ──────────────────────────── */

  [data-testid="inlinePrompt"] {
    display: none !important;
  }

  [data-testid="cellInnerDiv"]:has(
    [data-testid="UserCell"]
  ) {
    display: none !important;
  }

  [data-testid="news_sidebar"] {
    display: none !important;
  }

  /* ────────────────────────────
     アニメーション・画面効果
     ──────────────────────────── */

  html {
    scroll-behavior: auto !important;
  }

  [data-testid="primaryColumn"],
  [data-testid="cellInnerDiv"],
  [data-testid="tweet"],
  header[role="banner"],
  nav[role="navigation"] {
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
  }

  [role="dialog"] [class*="r-1p0dtai"],
  [class*="backdrop"],
  [style*="backdrop-filter"] {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }

  [role="dialog"],
  [role="menu"],
  [data-testid="Dropdown"] {
    box-shadow: none !important;
  }

  /* ────────────────────────────
     タイムラインの描画負荷を軽減
     ──────────────────────────── */

  [data-testid="cellInnerDiv"] {
    content-visibility: auto;
    contain-intrinsic-size: auto 420px;
  }

  [data-testid="tweetPhoto"],
  [data-testid="videoPlayer"],
  [data-testid="card.wrapper"] {
    box-shadow: none !important;
    filter: none !important;
  }

  /* ────────────────────────────
     スクロールバー
     ──────────────────────────── */

  * {
    scrollbar-width: thin;
  }

  /* ────────────────────────────
     任意設定
     コメントを外すと有効
     ──────────────────────────── */

  /* 「おすすめ」タブを隠してフォロー中を使いやすくする */
  /*
  [role="tab"][aria-selected="true"]:first-of-type,
  [role="tablist"] > div:first-child {
    display: none !important;
  }
  */

  /* ホーム上部の投稿入力欄を隠す */
  /*
  [data-testid="tweetTextarea_0RichTextInputContainer"]
    :is(textarea, [contenteditable="true"]) {
    display: none !important;
  }

  [data-testid="toolBar"],
  [data-testid="tweetButtonInline"] {
    display: none !important;
  }
  */

  /* ポストの表示回数を隠す */
  /*
  article[data-testid="tweet"] a[href$="/analytics"] {
    display: none !important;
  }
  */

  /* ブックマークと共有ボタンを隠す */
  /*
  article[data-testid="tweet"] [data-testid="bookmark"],
  article[data-testid="tweet"] button[aria-label*="共有"],
  article[data-testid="tweet"] button[aria-label*="Share"] {
    display: none !important;
  }
  */

  /* 左メニューをアイコン中心にする */
  /*
  header[role="banner"] nav a span span,
  [data-testid="SideNav_NewTweet_Button"] span {
    display: none !important;
  }
  */
  `;

  const style = document.createElement('style');
  style.id = 'x-lightweight-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  /* ────────────────────────────
     動画クリック → URL遷移を防止
     ──────────────────────────── */

  const VIDEO_PLAYER_SELECTOR = [
    '[data-testid="videoPlayer"]',
    '[data-testid="videoComponent"]'
  ].join(',');

  /*
    動画プレイヤー上の明示的な操作UI。
    これらはX本来のイベント処理を残す。
  */
  const VIDEO_CONTROL_SELECTOR = [
    'button',
    '[role="slider"]',
    'input',
    'select',
    'textarea'
  ].join(',');

  function getVideoContext(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    const player = target.closest(VIDEO_PLAYER_SELECTOR);

    if (player) {
      const explicitControl = target.closest(VIDEO_CONTROL_SELECTOR);

      if (explicitControl && player.contains(explicitControl)) {
        return null;
      }

      const video = player.querySelector('video');

      if (video) {
        return { player, video };
      }
    }

    if (target.matches('video')) {
      return {
        player: target.closest(VIDEO_PLAYER_SELECTOR) || target,
        video: target
      };
    }

    return null;
  }

  function isPlainLeftClick(event) {
    return (
      event.button === 0 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey
    );
  }

  function handleVideoClick(event) {
    if (!isPlainLeftClick(event)) {
      return;
    }

    const context = getVideoContext(event.target);

    if (!context) {
      return;
    }

    /*
      React/X側のポストクリック処理より先に止める。
      これにより /status/.../video/1 等への遷移を抑止する。
    */
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const { video } = context;

    /*
      X側のclick handlerも止めるため、
      動画本体クリック時の再生/一時停止はここで行う。
    */
    if (video.paused || video.ended) {
      const playPromise = video.play();

      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } else {
      video.pause();
    }
  }

  document.addEventListener('click', handleVideoClick, true);

  /*
    中央クリック等による動画領域からのリンク遷移も抑止する。
  */
  document.addEventListener(
    'auxclick',
    event => {
      const context = getVideoContext(event.target);

      if (!context) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    },
    true
  );
})();
