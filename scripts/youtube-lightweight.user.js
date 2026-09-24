// ==UserScript==
// @name         YouTube Lightweight
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.0.0
// @description  YouTubeの装飾・販促・Shorts等を整理し、画面外描画を抑えて軽量化します。
// @author       nomuonji
// @match        *://youtube.com/*
// @match        *://*.youtube.com/*
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/youtube-lightweight.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/youtube-lightweight.user.js
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
    border: 1px solid rgba(255, 0, 0, 0.4);
    border-radius: 6px;

    color: #b50000;
    background: rgba(255, 245, 245, 0.94);

    font-family:
      Roboto,
      system-ui,
      -apple-system,
      "Segoe UI",
      sans-serif;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.04em;

    pointer-events: none;
    user-select: none;
  }

  html[dark] body::after {
    color: #ff8a8a;
    background: rgba(45, 10, 10, 0.94);
    border-color: rgba(255, 90, 90, 0.45);
  }

  /* 全画面再生中は目印を隠す */
  html:has(:fullscreen) body::after {
    display: none !important;
  }

  /* ────────────────────────────
     プレイヤー周辺を軽量化
     ──────────────────────────── */

  /* アンビエントモードの背景発光 */
  #cinematics,
  .ytp-ambient-mode,
  .ytp-ambient-mode-projector {
    display: none !important;
  }

  #player-container-outer,
  #player-container-inner,
  ytd-watch-flexy #player {
    box-shadow: none !important;
    filter: none !important;
  }

  html {
    scroll-behavior: auto !important;
  }

  ytd-masthead,
  ytd-mini-guide-renderer,
  ytd-guide-renderer,
  ytd-rich-grid-renderer {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }

  /* ────────────────────────────
     広告・販促枠
     ──────────────────────────── */

  #masthead-ad,
  #player-ads,
  ytd-ad-slot-renderer,
  ytd-in-feed-ad-layout-renderer,
  ytd-display-ad-renderer,
  ytd-promoted-sparkles-web-renderer,
  ytd-promoted-video-renderer,
  ytd-action-companion-ad-renderer,
  ytd-companion-slot-renderer,
  ytd-banner-promo-renderer,
  ytd-mealbar-promo-renderer,
  ytd-statement-banner-renderer,
  ytd-brand-video-singleton-renderer {
    display: none !important;
  }

  /* 商品や販促用の棚 */
  ytd-merch-shelf-renderer,
  ytd-product-list-renderer,
  ytd-donation-shelf-renderer,
  ytd-offer-module-renderer {
    display: none !important;
  }

  /* ────────────────────────────
     Shortsを非表示
     ──────────────────────────── */

  /* ホーム画面のShorts棚 */
  ytd-rich-section-renderer:has(
    a[href^="/shorts"]
  ),
  ytd-reel-shelf-renderer {
    display: none !important;
  }

  /* 左サイドバーのShorts */
  ytd-guide-entry-renderer:has(
    a[href^="/shorts"]
  ),
  ytd-mini-guide-entry-renderer:has(
    a[href^="/shorts"]
  ) {
    display: none !important;
  }

  /* ────────────────────────────
     動画ページ
     ──────────────────────────── */

  /*
    関連動画とコメントにはdisplay指定を加えない。
    YouTube本来のレイアウトと遅延読み込みに任せる。
  */

  /* 関連動画内の広告だけ隠す */
  #related ytd-ad-slot-renderer,
  #related ytd-display-ad-renderer,
  #secondary ytd-ad-slot-renderer,
  #secondary ytd-promoted-sparkles-web-renderer {
    display: none !important;
  }

  /* コメント欄の販促・購入案内だけ隠す */
  #comments ytd-sponsorships-comment-preview-renderer,
  #comments ytd-purchased-product-comment-renderer {
    display: none !important;
  }

  /* ────────────────────────────
     ホーム・検索結果の画面外描画を省略
     ──────────────────────────── */

  /*
    関連動画とコメントにはcontent-visibilityを使わない。
    遅延読み込みが止まる環境があるため。
  */

  ytd-browse ytd-rich-item-renderer,
  ytd-search ytd-video-renderer,
  ytd-search ytd-grid-video-renderer,
  ytd-search ytd-playlist-renderer,
  ytd-search ytd-channel-renderer {
    content-visibility: auto;
    contain-intrinsic-size: auto 320px;
  }

  ytd-thumbnail,
  yt-image,
  #thumbnail {
    box-shadow: none !important;
    filter: none !important;
  }

  /* ────────────────────────────
     サイドバーを整理
     ──────────────────────────── */

  ytd-guide-renderer {
    scrollbar-width: thin !important;
  }

  /* サイドバー下部の規約表示 */
  #guide-links-primary,
  #guide-links-secondary,
  #footer {
    display: none !important;
  }

  /* ────────────────────────────
     任意設定
     コメントを外すと有効
     ──────────────────────────── */

  /* ホーム上部のジャンルタブを隠す */
  /*
  ytd-feed-filter-chip-bar-renderer {
    display: none !important;
  }
  */

  /* 左サイドバーを完全に隠す */
  /*
  ytd-guide-renderer,
  ytd-mini-guide-renderer {
    display: none !important;
  }

  ytd-page-manager {
    margin-left: 0 !important;
  }
  */
`;

  const style = document.createElement('style');
  style.id = 'vm-youtube-lightweight-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
})();
