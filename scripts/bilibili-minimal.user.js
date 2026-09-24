// ==UserScript==
// @name         Bilibili Minimal Viewing
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      1.1.0
// @description  広告・大型バナー・コメント等を隠しつつ、動画ページの関連動画は残す
// @author       nomuonji
// @match        *://www.bilibili.com/*
// @match        *://bilibili.com/*
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-minimal.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-minimal.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const css = String.raw`
/* ── 共通：広告・販促・大型バナーを隠す ── */
.ad-report,
[class*="ad-floor"],
[class*="video-card-ad"],
#slide_ad,
.bili-header__banner,
.bili-header__channel,
.bili-header__channel-fixed,
.download-entry,
.download-client-trigger,
.right-entry-item--upload {
  display: none !important;
}

/* ── ホーム：大型背景・バナーをなくして一覧を上へ ── */
body:has(.feed2),
body:has(.feed4) {
  background-image: none !important;
}

body:has(.feed2) .bili-header,
body:has(.feed4) .bili-header {
  min-height: 64px !important;
}

body:has(.feed2) .bili-header__menu,
body:has(.feed4) .bili-header__menu {
  background: var(--bg1, #fff) !important;
}

/* ── 動画ページ：関連動画は残す ── */

/* 上部ナビを隠す */
body:has(#mirror-vdcon) #biliMainHeader {
  display: none !important;
}

/* 動画ページ内の広告 */
body:has(#mirror-vdcon) .ad-report,
body:has(#mirror-vdcon) [class*="video-card-ad"],
body:has(#mirror-vdcon) #slide_ad,
body:has(#mirror-vdcon) .bpx-player-adv-dm-wrap {
  display: none !important;
}

/* コメント欄・ダンマクリスト・ノートパネルを隠す */
body:has(#mirror-vdcon) #commentapp,
body:has(#mirror-vdcon) .video-note-sidebar-panel,
body:has(#mirror-vdcon) .video-note-sidebar-chapter-layer,
body:has(#mirror-vdcon) .video-note-sidebar-chapter-portal,
body:has(#mirror-vdcon) .video-pod-above-modules {
  display: none !important;
}

/* 動画下の補足情報をコンパクト化 */
body:has(#mirror-vdcon) .video-resource-list,
body:has(#mirror-vdcon) .video-tag-container,
body:has(#mirror-vdcon) .bpx-player-video-inputbar {
  display: none !important;
}

/*
  関連動画は .right-container / .recommend-list-v1 に入っているため、
  ここでは非表示にしない。
*/

/* 任意：タイトル下の説明文と操作ボタンも不要ならコメントを外す */
/*
body:has(#mirror-vdcon) #v_desc,
body:has(#mirror-vdcon) .video-toolbar-container {
  display: none !important;
}
*/
`;

  const style = document.createElement('style');
  style.id = 'vm-bilibili-minimal-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
})();
