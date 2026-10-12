// ==UserScript==
// @name         Bilibili Dual Subtitles (EN + JA)
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      0.3.0
// @description  プレイヤー字幕優先・必要最小限の取得・キャッシュ・取得制限時の停止に対応した日英字幕。
// @author       nomuonji
// @match        https://www.bilibili.com/video/*
// @match        https://bilibili.com/video/*
// @run-at       document-idle
// @noframes
// @inject-into  page
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.bilibili.com
// @connect      *.bilibili.com
// @connect      *.hdslb.com
// @updateURL    https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-dual-subtitles.user.js
// @downloadURL  https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-dual-subtitles.user.js
// ==/UserScript==

(() => {
  'use strict';

  // Only subtitles that belong to the current video's signed WBI metadata
  // are trusted. Unsigned /x/player/v2 may return mismatched transcripts.
  const shuffle = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
  const allowed = /(^|\.)(bilibili\.com|hdslb\.com)$/i;
  const allowedModes = ['both','ja','en'];
  const initialMode = GM_getValue('dual-mode', 'both');
  const state = {
    enabled: Boolean(GM_getValue('dual-enabled', true)),
    mode: allowedModes.includes(initialMode) ? initialMode : 'both',
    original: Boolean(GM_getValue('dual-original', false)),
    font: Math.max(16,Math.min(40,Number(GM_getValue('dual-font', 24))||24)),
    bottom: Math.max(2,Math.min(60,Number(GM_getValue('dual-bottom', 11))||11)),
    horizontal: Math.max(10,Math.min(90,Number(GM_getValue('dual-horizontal', 50))||50)),
    page: '', generation: 0, player: null, video: null, root: null, caption: null,
    status: '字幕を確認中…', statusElement: null, button: null,
    source: null, english: null, japanese: null,
    cache: new Map(), pending: new Set(), translators: new Map(), probes: new Set(),
    pairs: new Map(), painted: '', translateEpoch: 0,
    wbiKey: null, nativeHolder: null, nativeOpacity: '', nativeText: '',
  };

  // RFC 1321 MD5, with UTF-8 input. Required for Bilibili WBI signatures.
  function md5(value) {
    const bytes = new TextEncoder().encode(value);
    const length = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(length);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    const bits = BigInt(bytes.length) * 8n;
    view.setUint32(length - 8, Number(bits & 0xffffffffn), true);
    view.setUint32(length - 4, Number((bits >> 32n) & 0xffffffffn), true);
    const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
    const table = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i+1)) * 4294967296) >>> 0);
    let h0=0x67452301,h1=0xefcdab89,h2=0x98badcfe,h3=0x10325476;
    for (let offset=0; offset<length; offset+=64) {
      const words = Array.from({ length:16 }, (_, i) => view.getUint32(offset+i*4, true));
      let a=h0,b=h1,c=h2,d=h3;
      for (let i=0;i<64;i++) {
        let f,g,shift;
        if (i<16) { f=(b&c)|(~b&d);g=i;shift=shifts[i%4]; }
        else if (i<32) { f=(d&b)|(~d&c);g=(5*i+1)%16;shift=shifts[4+i%4]; }
        else if (i<48) { f=b^c^d;g=(3*i+5)%16;shift=shifts[8+i%4]; }
        else { f=c^(b|~d);g=(7*i)%16;shift=shifts[12+i%4]; }
        const sum=(a+f+table[i]+words[g])>>>0;
        const rotated=(sum<<shift)|(sum>>>(32-shift));
        a=d;d=c;c=b;b=(b+rotated)>>>0;
      }
      h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;
    }
    return [h0,h1,h2,h3].map(n=>Array.from({length:4},(_,i)=>(n>>>(i*8)&255).toString(16).padStart(2,'0')).join('')).join('');
  }

  // Short-lived local cache; no cookies, authorization headers, signed URLs or API keys.
  const CACHE_KEY='dual-sub-cache-v1';
  const BLOCK_KEY='dual-remote-block-until';
  const CACHE_TTL=6*60*60*1000;
  const BLOCK_TTL=24*60*60*1000;
  const CACHE_LIMIT=5;
  function cachedTracks(pageKey) {
    try {
      const collection=GM_getValue(CACHE_KEY,{});
      const record=collection?.[pageKey];
      if(!record||Date.now()-record.savedAt>CACHE_TTL||record.savedAt>Date.now()+60000)return null;
      if(!Array.isArray(record.tracks)||!record.tracks.length||record.tracks.length>3)return null;
      const tracks=record.tracks.map(t=>({lang:t.lang,label:t.label,items:cues(t.items)}));
      return tracks.every(t=>t.items.length)?tracks:null;
    } catch {return null;}
  }
  function saveTracks(pageKey,tracks) {
    try {
      if(!tracks.length||tracks.some(t=>!t.items?.length)||JSON.stringify(tracks).length>380000)return;
      const stored=GM_getValue(CACHE_KEY,{});
      const entries=Object.entries(stored||{}).filter(([key,v])=>
        key!==pageKey&&v&&Number.isFinite(v.savedAt)&&Date.now()-v.savedAt<CACHE_TTL
      ).sort((a,b)=>b[1].savedAt-a[1].savedAt).slice(0,CACHE_LIMIT-1);
      const collection=Object.fromEntries(entries);
      collection[pageKey]={savedAt:Date.now(),tracks};
      GM_setValue(CACHE_KEY,collection);
    } catch(err) {console.warn('[Bili Dual] キャッシュ保存不可:',err);}
  }
  function haltRemote(reason) {
    const current=Number(GM_getValue(BLOCK_KEY,0))||0;
    GM_setValue(BLOCK_KEY,Math.max(current,Date.now()+BLOCK_TTL));
    throw new Error('Bilibiliのアクセス制限を検出したため字幕取得を24時間停止しました: '+reason);
  }
  function assertRemoteAllowed() {
    const until=Number(GM_getValue(BLOCK_KEY,0))||0;
    if(Date.now()<until)throw new Error('Bilibiliへの追加取得を停止中です（'+new Date(until).toLocaleString()+'まで）。プレイヤー字幕・キャッシュは利用可能です。');
  }
  function parseResponse(payload) {
    if([-352,-412].includes(payload?.code))haltRemote('API code '+payload.code);
    return payload;
  }
  function json(url) {
    return new Promise((resolve,reject)=>{
      const target=new URL(url, location.origin);
      if (target.protocol!=='https:' || !allowed.test(target.hostname)) {
        reject(new Error('許可されていない字幕URL')); return;
      }
      try {assertRemoteAllowed();}catch(err){reject(err);return;}
      GM_xmlhttpRequest({
        method:'GET',url:target.href,responseType:'json',timeout:15000,anonymous:false,
        headers:{Accept:'application/json'},
        onload:r=>{
          if([412,429].includes(r.status)) {
            try {haltRemote('HTTP '+r.status);}catch(err){reject(err);}return;
          }
          if(r.status<200||r.status>=300) {reject(new Error('字幕API HTTP '+r.status));return;}
          try {resolve(parseResponse(typeof r.response==='string'?JSON.parse(r.response):r.response));}
          catch(err){reject(err);}
        },
        onerror:()=>reject(new Error('字幕APIに接続できません')),
        ontimeout:()=>reject(new Error('字幕APIがタイムアウトしました')),
      });
    });
  }
  function data(payload,description) {
    if (!payload||payload.code!==0||!payload.data) throw new Error(description+' (code '+(payload?.code??'?')+')');
    return payload.data;
  }

  function currentVideo() {
    const match=location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})/i);
    if(!match)return null;
    const p=Number(new URLSearchParams(location.search).get('p')||1);
    return {bvid:match[1],page:Number.isInteger(p)&&p>0?p:1};
  }
  function status(message) {
    state.status=message;
    if(state.statusElement)state.statusElement.textContent=message;
  }
  function imageKey(url) {return String(url||'').split('/').pop().split('.')[0];}
  async function signedQuery(params) {
    if(!state.wbiKey||Date.now()-state.wbiKey.at>30*60*1000) {
      const nav=await json('https://api.bilibili.com/x/web-interface/nav');
      const info=nav?.data?.wbi_img;
      if(!info?.img_url||!info?.sub_url)throw new Error('WBI署名キーの取得に失敗（Bilibiliログインを確認）');
      const original=imageKey(info.img_url)+imageKey(info.sub_url);
      if(original.length<64)throw new Error('WBI署名キーが不正です');
      state.wbiKey={at:Date.now(),key:shuffle.map(i=>original[i]).join('').slice(0,32)};
    }
    const values={...params,wts:Math.floor(Date.now()/1000)};
    const query=Object.keys(values).sort().map(k=>encodeURIComponent(k)+'='+encodeURIComponent(String(values[k]).replace(/[!'()*]/g,''))).join('&');
    return query+'&w_rid='+md5(query+state.wbiKey.key);
  }

  function language(code) {
    const name=String(code||'').toLowerCase();
    if(/^(en)([-_]|$)/.test(name))return 'en';
    if(/^(ja|jp)([-_]|$)/.test(name))return 'ja';
    if(/^(zh|ai-zh|ai_zh)([-_]|$)/.test(name))return 'zh';
    return name.split(/[-_]/)[0];
  }
  function cues(body) {
    if(!Array.isArray(body))return [];
    return body.filter(x=>typeof x.content==='string'&&Number.isFinite(Number(x.from))&&Number.isFinite(Number(x.to))&&Number(x.to)>Number(x.from)).map(x=>({from:Number(x.from),to:Number(x.to),content:x.content.trim()})).filter(x=>x.content).sort((a,b)=>a.from-b.from);
  }
  function pageMetadata(bvid,page) {
    const video=globalThis.__INITIAL_STATE__?.videoData;
    if(String(video?.bvid)!==bvid)return null; // reject stale SPA metadata
    const selected=video.pages?.[page-1];
    const cid=selected?.cid??(page===1?video.cid:null);
    if(!cid||!video.aid)return null;
    return {aid:video.aid,cid,subtitle:video.subtitle};
  }
  function entriesFromMetadata(metadata) {
    const subtitle=metadata?.subtitle;
    const entries=Array.isArray(subtitle?.list)?subtitle.list:
      Array.isArray(subtitle?.subtitles)?subtitle.subtitles:[];
    return entries.filter(e=>e?.subtitle_url);
  }
  function selectEntries(entries) {
    // Fetch only the tracks needed to support the current display mode.
    const valid=entries.filter(e=>e?.subtitle_url);
    const pick=lang=>valid.find(e=>language(e.lan)===lang);
    const source=pick('zh')||pick('ja')||pick('en')||valid[0];
    const wanted=state.mode==='both'?['en','ja']:state.mode==='ja'?['ja']:['en'];
    const native=wanted.map(pick).filter(Boolean);
    const missing=wanted.some(lang=>!pick(lang));
    // If the requested subtitles already exist, don't fetch Chinese as well.
    const chosen=(missing||state.original||!native.length)?[...native,source]:native;
    return [...new Set(chosen.filter(Boolean))].slice(0,3);
  }
  async function downloadTracks(entries,generation) {
    const tracks=[];
    for(const entry of selectEntries(entries)) {
      try {
        const uri=new URL(String(entry.subtitle_url).startsWith('//')?'https:'+entry.subtitle_url:entry.subtitle_url,'https://www.bilibili.com');
        if(uri.protocol!=='https:'||!allowed.test(uri.hostname))continue;
        const payload=await json(uri.href);
        if(generation!==state.generation)return null;
        const items=cues(payload?.body);
        if(items.length)tracks.push({lang:language(entry.lan),label:entry.lan_doc||entry.lan,items});
      } catch(error) {
        // Do not attempt remaining tracks if access has been restricted.
        if(Date.now()<(Number(GM_getValue(BLOCK_KEY,0))||0))throw error;
        console.warn('[Bili Dual] 字幕トラックをスキップ:',error);
      }
    }
    return tracks;
  }
  function releaseNative() {
    if(state.nativeHolder?.isConnected)state.nativeHolder.style.opacity=state.nativeOpacity;
    state.nativeHolder=null;state.nativeText='';
  }
  function nativeCaption() {
    const element=document.querySelector('.bpx-player-subtitle-panel-text');
    if(!element||state.root?.contains(element))return null;
    const holder=element.closest('.bpx-player-subtitle-panel-position')||element;
    if(getComputedStyle(holder).display==='none'||getComputedStyle(holder).visibility==='hidden')return null;
    const content=(element.textContent||'').trim();
    if(!content||content.length>500)return null;
    const lang=/[\u3040-\u30ff]/.test(content)?'ja':/[\u4e00-\u9fff]/.test(content)?'zh':/[a-z]/i.test(content)?'en':null;
    return lang?{content,lang,holder}:null;
  }
  function followNativeCaption() {
    if(!state.source?.native||!state.video)return;
    const found=nativeCaption();
    if(!found) {
      state.caption?.replaceChildren();state.painted='';
      return;
    }
    if(state.nativeHolder!==found.holder) {
      releaseNative();state.nativeHolder=found.holder;state.nativeOpacity=found.holder.style.opacity;
    }
    state.nativeHolder.style.opacity=state.enabled?'0':state.nativeOpacity;
    const time=state.video.currentTime;
    const current=state.source.items[0];
    if(!current||current.content!==found.content) {
      state.source.lang=found.lang;
      state.source.items=[{from:time-.25,to:time+2,content:found.content}];
      state.painted='';
    } else {
      current.from=time-.25;current.to=time+2;
    }
  }
  function setTracks(tracks,origin) {
    state.english=tracks.find(t=>t.lang==='en')||null;
    state.japanese=tracks.find(t=>t.lang==='ja')||null;
    state.source=tracks.find(t=>t.lang==='zh')||state.english||state.japanese||tracks[0];
    state.translateEpoch++;state.cache.clear();state.pending.clear();state.painted='';
    updateTranslationStatus();
    status('字幕: '+origin+' ('+tracks.map(t=>t.label).join(' / ')+')');
    render();
  }
  async function acquire(bvid,page,generation) {
    const pageKey=bvid+'/'+page;
    const cached=cachedTracks(pageKey);
    if(cached) {setTracks(cached,'キャッシュ');return;}
    status('プレイヤー字幕を確認中…');
    const metadata=pageMetadata(bvid,page);
    // Existing subtitle text requires no additional network request.
    // Check briefly while the player finishes mounting, without touching its APIs.
    for(let i=0;i<4;i++) {
      if(generation!==state.generation)return;
      const native=nativeCaption();
      if(native&&state.video) {
        state.source={native:true,lang:native.lang,label:'Bilibili表示字幕',items:[]};
        state.english=null;state.japanese=null;
        state.nativeHolder=native.holder;state.nativeOpacity=native.holder.style.opacity;
        followNativeCaption();
        updateTranslationStatus();status('字幕: プレイヤーの表示字幕（追加API通信なし）');
        render();return;
      }
      if(i<3)await new Promise(resolve=>setTimeout(resolve,350));
    }
    if(generation!==state.generation)return;
    let tracks=[];
    const embedded=entriesFromMetadata(metadata);
    if(embedded.length) {
      status('ページに含まれる字幕情報を再利用中…');
      tracks=await downloadTracks(embedded,generation);
    }
    if(generation!==state.generation)return;
    if(!tracks?.length) {
      status('必要な字幕だけを取得中…');
      let video=metadata;
      if(!video) {
        video=data(await json('https://api.bilibili.com/x/web-interface/view?bvid='+encodeURIComponent(bvid)),'動画情報の取得に失敗');
        video={aid:video.aid,cid:video.pages?.[page-1]?.cid};
      }
      if(!video?.aid||!video?.cid)throw new Error('この分割動画のCIDが見つかりません');
      const query=await signedQuery({aid:video.aid,cid:video.cid});
      const player=data(await json('https://api.bilibili.com/x/player/wbi/v2?'+query),'署名付き字幕APIが利用できません');
      if(generation!==state.generation)return;
      const entries=player.subtitle?.subtitles;
      if(!Array.isArray(entries)||entries.length===0)throw new Error('字幕一覧が空です（字幕なし／ログイン制限の可能性）');
      tracks=await downloadTracks(entries,generation);
    }
    if(generation!==state.generation)return;
    if(!tracks?.length)throw new Error('字幕本文を取得できません（権限や地域を確認）');
    saveTracks(pageKey,tracks);
    setTracks(tracks,'取得済み');
  }

  function matchCue(track,time) {
    if(!track?.items?.length)return null;
    const items=track.items;
    let low=0,high=items.length-1;
    while(low<=high) {
      const mid=(low+high)>>1;
      if(items[mid].from<=time)low=mid+1;
      else high=mid-1;
    }
    for(let i=Math.max(0,high);i>=Math.max(0,high-2);i--) {
      if(items[i].from<=time&&time<items[i].to)return {index:i,cue:items[i]};
    }
    return null;
  }
  const ERROR = Symbol('translation-error');
  const pairId = (from,to) => from+'>'+to;
  const languageName = code => ({zh:'中国語',ja:'日本語',en:'英語'})[code] || code;

  function translationError(error) {
    const message=String(error?.message||error||'不明なエラー');
    if(error?.name==='NotAllowedError')return '初回ダウンロードには「翻訳モデルを準備」をクリックしてください';
    return message;
  }
  function setPair(pair,phase,message) {
    state.pairs.set(pair,{phase,message});
    updateTranslationStatus();
    state.painted='';
    render();
  }
  function requiredPairs() {
    if(!state.source)return [];
    const result=[];
    const targets=state.mode==='both'?['en','ja']:[state.mode];
    for(const target of targets) {
      if((target==='en'?state.english:state.japanese)||state.source.lang===target)continue;
      const key=pairId(state.source.lang,target);
      if(!result.some(x=>x.key===key))result.push({key,from:state.source.lang,to:target});
    }
    return result;
  }
  function updateTranslationStatus() {
    const el=state.root?.querySelector('.vm-dual-translation-status');
    if(!el)return;
    const pairs=requiredPairs();
    if(!state.source) {el.textContent='字幕の取得待ちです。';return;}
    if(!pairs.length) {el.textContent='選択中の言語は既存字幕から表示できます。';return;}
    el.textContent=pairs.map(({key,from,to})=>{
      const current=state.pairs.get(key);
      const label=languageName(from)+' → '+languageName(to);
      if(!current)return label+': 確認中';
      return label+': '+current.message;
    }).join(' / ');
  }
  function probe(from,to) {
    const key=pairId(from,to);
    if(state.probes.has(key)||state.translators.has(key))return;
    state.probes.add(key);
    if(!globalThis.Translator?.availability||!globalThis.Translator?.create) {
      setPair(key,'error','Chrome内蔵翻訳が利用できません（Chrome 138以降のデスクトップ版が必要）');
      return;
    }
    setPair(key,'checking','翻訳モデルを確認中…');
    const options={sourceLanguage:from,targetLanguage:to};
    Promise.resolve().then(()=>globalThis.Translator.availability(options)).then(availability=>{
      if(state.translators.has(key))return;
      if(availability==='available') {
        startModel(from,to,false);
      } else if(availability==='unavailable') {
        setPair(key,'error','この言語ペアは利用できません');
      } else {
        setPair(key,'action','「翻訳モデルを準備」を押してください（初回ダウンロード）');
      }
    }).catch(err=>setPair(key,'error',translationError(err)));
  }
  function startModel(from,to,interactive) {
    const key=pairId(from,to);
    if(state.translators.has(key))return;
    if(!globalThis.Translator?.create) {
      setPair(key,'error','このブラウザにTranslator APIがありません');
      return;
    }
    // Translator.create is deliberately invoked *synchronously* in the click
    // handler when a language pack needs user activation.
    try {
      const options={
        sourceLanguage:from,targetLanguage:to,
        monitor(m) {
          m.addEventListener('downloadprogress',e=>{
            setPair(key,'loading','モデル取得 '+Math.round((e.loaded||0)*100)+'%');
          });
        },
      };
      setPair(key,'loading',interactive?'翻訳モデルの準備中…':'翻訳モデル起動中…');
      const promise=globalThis.Translator.create(options);
      state.translators.set(key,Promise.resolve(promise));
      Promise.resolve(promise).then(()=>{
        setPair(key,'ready','利用可能');
      }).catch(err=>{
        state.translators.delete(key);
        setPair(key,'error',translationError(err));
      });
    } catch(err) {
      state.translators.delete(key);
      setPair(key,'error',translationError(err));
    }
  }
  function prepareModels() {
    const pairs=requiredPairs();
    if(!pairs.length) {updateTranslationStatus();return;}
    state.translateEpoch++;
    state.cache.clear();state.pending.clear();
    // All create() calls happen directly in the user-click call stack.
    for(const {from,to,key} of pairs) {
      if(state.pairs.get(key)?.phase==='ready'&&state.translators.has(key))continue;
      state.translators.delete(key);
      startModel(from,to,true);
    }
    state.painted='';render();
  }
  function translated(track,index,target,generation) {
    const source=track.items[index].content;
    if(track.lang===target)return source;
    const pair=pairId(track.lang,target);
    const key=pair+'#'+index+'#'+source;
    if(state.cache.has(key))return state.cache.get(key)===ERROR?'翻訳に失敗しました（字幕設定で詳細を確認）':state.cache.get(key);
    const model=state.translators.get(pair);
    const phase=state.pairs.get(pair)?.phase;
    if(!model) {
      if(!state.pairs.has(pair))probe(track.lang,target);
      if(phase==='error')return '翻訳できません（字幕設定で詳細を確認）';
      if(phase==='action')return '翻訳モデル未準備（字幕設定 → モデル準備）';
      return '翻訳モデルを確認中…';
    }
    if(phase==='loading'||phase==='checking')return '翻訳モデルの準備中…';
    if(phase==='error')return '翻訳できません（字幕設定で詳細を確認）';
    if(!state.pending.has(key)) {
      state.pending.add(key);
      const epoch=state.translateEpoch;
      Promise.race([
        Promise.resolve(model).then(instance=>instance.translate(source)),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('翻訳が15秒以内に完了しませんでした')),15000)),
      ]).then(result=>{
        if(generation!==state.generation||epoch!==state.translateEpoch)return;
        state.cache.set(key,String(result||'')||ERROR);
        state.pending.delete(key);render();
      }).catch(err=>{
        if(generation!==state.generation||epoch!==state.translateEpoch)return;
        state.cache.set(key,ERROR);state.pending.delete(key);
        setPair(pair,'error',translationError(err));
      });
    }
    return '翻訳中…';
  }
  function line(target,time,sourceCue,generation) {
    const native=target==='en'?state.english:state.japanese;
    const original=matchCue(native,time);
    if(original)return original.cue.content;
    return sourceCue?translated(state.source,sourceCue.index,target,generation):'';
  }
  function render() {
    if(!state.caption||!state.video||!state.source)return;
    if(!state.enabled) {state.caption.replaceChildren();return;}
    const time=state.video.currentTime;
    const found=matchCue(state.source,time);
    if(!found) {
      if(state.painted!=='') {state.painted='';state.caption.replaceChildren();}
      return;
    }
    const targets=state.mode==='both'?['en','ja']:[state.mode];
    const lines=targets.map(target=>({
      target, text:line(target,time,found,state.generation)||'字幕がありません',
    }));
    if(state.original&&state.source.lang!=='en'&&state.source.lang!=='ja') {
      lines.push({target:'original',text:found.cue.content});
    }
    const signature=lines.map(x=>x.target+':'+x.text).join('\n')+'|'+state.font+'|'+state.bottom+'|'+state.horizontal;
    if(signature!==state.painted) {
      state.painted=signature;
      state.caption.replaceChildren(...lines.map(({target,text})=>{
        const el=document.createElement('div');el.className='vm-dual-line vm-dual-'+target;
        el.textContent=text;return el;
      }));
    }
    // Preload at most two captions, only for selected display languages.
    for(let i=found.index+1;i<=Math.min(found.index+2,state.source.items.length-1);i++) {
      for(const target of targets) {
        if(!(target==='en'?state.english:state.japanese))translated(state.source,i,target,state.generation);
      }
    }
  }

  function enable(value) {
    state.enabled=value;GM_setValue('dual-enabled',value);
    if(state.nativeHolder?.isConnected)state.nativeHolder.style.opacity=value?'0':state.nativeOpacity;
    if(state.button) {
      state.button.textContent=value?'字幕 ON':'字幕 OFF';
      state.button.setAttribute('aria-pressed',String(value));
    }
    if(!value)state.caption?.replaceChildren();
    else {state.painted='';render();}
  }
  function openSettings() {
    const options=state.root?.querySelector('.vm-dual-options');
    if(options)options.hidden=false;
  }
  function updatePosition() {
    if(!state.caption)return;
    state.caption.style.bottom=state.bottom+'%';
    state.caption.style.left=state.horizontal+'%';
    state.caption.style.width=Math.min(96,2*Math.min(state.horizontal,100-state.horizontal))+'%';
    state.caption.style.transform='translateX(-50%)';
    state.root.querySelector('.vm-dual-bottom-label').textContent=state.bottom+'%';
    state.root.querySelector('.vm-dual-horizontal-label').textContent=state.horizontal+'%';
  }
  function mount(video) {
    const player=video.closest('.bpx-player-container, #bilibili-player, .bilibili-player')||video.parentElement;
    if(!player)return;
    if(state.player===player&&state.video===video&&state.root?.isConnected)return;
    state.root?.remove();state.player=player;state.video=video;
    if(getComputedStyle(player).position==='static')player.style.position='relative';
    if(!document.getElementById('vm-dual-style')) {
      const style=document.createElement('style');style.id='vm-dual-style';
      style.textContent=`
#vm-dual-root{position:absolute;inset:0;z-index:75;pointer-events:none;color:#fff;font-family:Arial,"Noto Sans JP",sans-serif;--vm-font:24px}
#vm-dual-root .vm-dual-tools{position:absolute;top:12px;right:12px;display:flex;gap:5px;pointer-events:auto}
#vm-dual-root button{border:1px solid #ffffff40;cursor:pointer;border-radius:7px;background:#202632ed;color:#fff;font-size:12px;padding:7px 10px;white-space:nowrap}
#vm-dual-root button:hover{background:#343b52}
#vm-dual-root button:focus-visible,#vm-dual-root select:focus-visible{outline:2px solid #ffe188}
#vm-dual-root .vm-dual-options{position:absolute;z-index:2;top:52px;right:12px;width:300px;max-width:calc(100% - 24px);box-sizing:border-box;padding:15px;border-radius:10px;border:1px solid #ffffff50;background:#141920f7;box-shadow:0 7px 22px #0009;color:#fff;font-size:13px;pointer-events:auto}
#vm-dual-root .vm-dual-options[hidden]{display:none}
#vm-dual-root .vm-dual-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-weight:bold}
#vm-dual-root .vm-dual-heading button{font-size:16px;padding:3px 9px}
#vm-dual-root .vm-dual-options label{display:flex;align-items:center;gap:8px;margin:10px 0}
#vm-dual-root .vm-dual-options input[type=range]{flex:1;min-width:40px}
#vm-dual-root .vm-dual-options select{flex:1;border-radius:5px;border:1px solid #ffffff50;background:#242b35;color:#fff;padding:6px}
#vm-dual-root .vm-dual-options .vm-dual-setting-label{width:66px;flex-shrink:0}
#vm-dual-root .vm-dual-status,#vm-dual-root .vm-dual-translation-status{line-height:1.45;overflow-wrap:anywhere;margin-top:8px;font-size:12px;color:#d9dee6}
#vm-dual-root .vm-dual-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
#vm-dual-root .vm-dual-caption{position:absolute;left:50%;width:96%;max-width:96%;bottom:11%;transform:translateX(-50%);text-align:center;font-weight:700;font-size:var(--vm-font);line-height:1.35;text-shadow:0 2px 5px #000,0 0 2px #000;white-space:pre-wrap;overflow-wrap:anywhere}
#vm-dual-root .vm-dual-line{display:table;max-width:98%;margin:2px auto;padding:1px 8px;border-radius:4px;background:#000a}
#vm-dual-root .vm-dual-ja{color:#ffe494}
#vm-dual-root .vm-dual-original{color:#ddd;font-size:.72em}
@media(max-width:600px){#vm-dual-root .vm-dual-caption{font-size:clamp(14px,4vw,var(--vm-font))}#vm-dual-root .vm-dual-tools{top:4px;right:4px}#vm-dual-root button{padding:5px 7px}}
`;
      (document.head||document.documentElement).appendChild(style);
    }
    const root=document.createElement('div');root.id='vm-dual-root';
    root.innerHTML=`
<div class="vm-dual-tools">
  <button class="vm-dual-toggle" type="button"></button>
  <button class="vm-dual-config" type="button" aria-label="字幕設定">字幕設定 ⚙</button>
</div>
<div class="vm-dual-options" hidden>
  <div class="vm-dual-heading"><span>字幕設定</span><button class="vm-dual-close" type="button" aria-label="閉じる">×</button></div>
  <label><span class="vm-dual-setting-label">表示</span><select class="vm-dual-mode">
    <option value="both">英語＋日本語</option><option value="ja">日本語のみ</option><option value="en">英語のみ</option>
  </select></label>
  <label><span class="vm-dual-setting-label">上下位置</span><input type="range" class="vm-dual-bottom" min="2" max="60" step="1"><span class="vm-dual-bottom-label"></span></label>
  <label><span class="vm-dual-setting-label">左右位置</span><input type="range" class="vm-dual-horizontal" min="10" max="90" step="1"><span class="vm-dual-horizontal-label"></span></label>
  <label><span class="vm-dual-setting-label">文字サイズ</span><input type="range" class="vm-dual-font-setting" min="16" max="40" step="2"></label>
  <label><input type="checkbox" class="vm-dual-original-setting">中国語原文も表示</label>
  <div class="vm-dual-actions"><button class="vm-dual-prepare" type="button">翻訳モデルを準備</button><button class="vm-dual-retry" type="button">字幕を再取得</button></div>
  <div class="vm-dual-translation-status" role="status"></div>
  <div class="vm-dual-status" role="status"></div>
</div>
<div class="vm-dual-caption"></div>`;
    player.appendChild(root);
    state.root=root;state.caption=root.querySelector('.vm-dual-caption');state.button=root.querySelector('.vm-dual-toggle');state.statusElement=root.querySelector('.vm-dual-status');
    state.button.addEventListener('click',()=>enable(!state.enabled));
    root.querySelector('.vm-dual-config').addEventListener('click',()=>{const panel=root.querySelector('.vm-dual-options');panel.hidden=!panel.hidden;});
    root.querySelector('.vm-dual-close').addEventListener('click',()=>{root.querySelector('.vm-dual-options').hidden=true;});
    const mode=root.querySelector('.vm-dual-mode');mode.value=state.mode;
    mode.addEventListener('change',()=>{
      if(!allowedModes.includes(mode.value))return;
      state.mode=mode.value;GM_setValue('dual-mode',state.mode);
      state.painted='';updateTranslationStatus();render();
    });
    const original=root.querySelector('.vm-dual-original-setting');original.checked=state.original;
    original.addEventListener('change',()=>{state.original=original.checked;GM_setValue('dual-original',state.original);state.painted='';render();});
    const font=root.querySelector('.vm-dual-font-setting');font.value=String(state.font);
    font.addEventListener('input',()=>{state.font=Number(font.value);GM_setValue('dual-font',state.font);root.style.setProperty('--vm-font',state.font+'px');state.painted='';render();});
    const bottom=root.querySelector('.vm-dual-bottom');bottom.value=String(state.bottom);
    bottom.addEventListener('input',()=>{state.bottom=Number(bottom.value);GM_setValue('dual-bottom',state.bottom);updatePosition();});
    const horizontal=root.querySelector('.vm-dual-horizontal');horizontal.value=String(state.horizontal);
    horizontal.addEventListener('input',()=>{state.horizontal=Number(horizontal.value);GM_setValue('dual-horizontal',state.horizontal);updatePosition();});
    root.querySelector('.vm-dual-prepare').addEventListener('click',prepareModels);
    root.querySelector('.vm-dual-retry').addEventListener('click',()=>refresh(true));
    root.style.setProperty('--vm-font',state.font+'px');updatePosition();
    status(state.status);updateTranslationStatus();enable(state.enabled);
  }

  async function refresh(force=false) {
    const video=currentVideo();if(!video)return;
    const pageKey=video.bvid+'/'+video.page;
    if(!force&&pageKey===state.page)return;
    state.page=pageKey;state.generation++;
    releaseNative();
    const generation=state.generation;
    state.source=null;state.english=null;state.japanese=null;
    state.translateEpoch++;state.cache.clear();state.pending.clear();state.painted='';
    state.caption?.replaceChildren();
    try {await acquire(video.bvid,video.page,generation);}
    catch(error) {
      if(generation===state.generation){status(error?.message||String(error));console.warn('[Bili Dual]',error);}
    }
  }
  function tick() {
    const video=currentVideo();if(!video)return;
    const element=document.querySelector('.bpx-player-video-wrap video, #bilibili-player video, video');
    if(element)mount(element);
    if(state.source?.native)followNativeCaption();
    if(state.source&&state.root?.isConnected)render();
    if(state.page!==video.bvid+'/'+video.page&&!state.loading) {
      state.loading=true;
      refresh().finally(()=>{state.loading=false;});
    }
  }
  if(typeof GM_registerMenuCommand==='function')GM_registerMenuCommand('Bilibili 字幕設定を開く',()=>{tick();openSettings();});
  tick();setInterval(tick,750);
})();