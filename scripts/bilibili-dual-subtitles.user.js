// ==UserScript==
// @name         Bilibili Dual Subtitles (EN + JA)
// @namespace    https://github.com/nomuonji/violentmonkey
// @version      0.1.0
// @description  Bilibili の既存字幕を英語・日本語の2段で表示。Chrome内蔵翻訳を利用。
// @author       nomuonji
// @match        https://www.bilibili.com/video/*
// @match        https://bilibili.com/video/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
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
  const state = {
    enabled: Boolean(GM_getValue('dual-enabled', true)),
    original: Boolean(GM_getValue('dual-original', false)),
    font: Number(GM_getValue('dual-font', 24)),
    page: '', generation: 0, player: null, video: null, root: null, caption: null,
    status: '字幕を確認中…', statusElement: null, button: null,
    source: null, english: null, japanese: null,
    cache: new Map(), pending: new Set(), translators: new Map(), painted: '',
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

  function json(url) {
    return new Promise((resolve,reject)=>{
      const target=new URL(url, location.origin);
      if (target.protocol!=='https:' || !allowed.test(target.hostname)) {
        reject(new Error('許可されていない字幕URL')); return;
      }
      GM_xmlhttpRequest({
        method:'GET',url:target.href,responseType:'json',timeout:15000,anonymous:false,
        headers:{Accept:'application/json'},
        onload:r=>{
          if (r.status<200||r.status>=300) {reject(new Error('字幕API HTTP '+r.status));return;}
          try {resolve(typeof r.response==='string'?JSON.parse(r.response):r.response);}
          catch {reject(new Error('字幕JSONを解析できません'));}
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
    const nav=await json('https://api.bilibili.com/x/web-interface/nav');
    const info=nav?.data?.wbi_img;
    if(!info?.img_url||!info?.sub_url)throw new Error('WBI署名キーの取得に失敗（Bilibiliログインを確認）');
    const original=imageKey(info.img_url)+imageKey(info.sub_url);
    if(original.length<64)throw new Error('WBI署名キーが不正です');
    const mixin=shuffle.map(i=>original[i]).join('').slice(0,32);
    const values={...params,wts:Math.floor(Date.now()/1000)};
    const query=Object.keys(values).sort().map(k=>encodeURIComponent(k)+'='+encodeURIComponent(String(values[k]).replace(/[!'()*]/g,''))).join('&');
    return query+'&w_rid='+md5(query+mixin);
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
  async function acquire(bvid,page,generation) {
    status('字幕一覧を取得中…');
    const video=data(await json('https://api.bilibili.com/x/web-interface/view?bvid='+encodeURIComponent(bvid)),'動画情報の取得に失敗');
    if(generation!==state.generation)return;
    const selected=video.pages?.[page-1];
    if(!selected?.cid||!video.aid)throw new Error('この分割動画のCIDが見つかりません');
    const query=await signedQuery({aid:video.aid,cid:selected.cid});
    const player=data(await json('https://api.bilibili.com/x/player/wbi/v2?'+query),'署名付き字幕APIが利用できません');
    if(generation!==state.generation)return;
    const entries=player.subtitle?.subtitles;
    if(!Array.isArray(entries)||entries.length===0)throw new Error('字幕一覧が空です（字幕なし／ログイン制限の可能性）');
    const tracks=[];
    for(const entry of entries.slice(0,10)) {
      try {
        if(!entry.subtitle_url)continue;
        const uri=new URL(String(entry.subtitle_url).startsWith('//')?'https:'+entry.subtitle_url:entry.subtitle_url,'https://www.bilibili.com');
        if(uri.protocol!=='https:'||!allowed.test(uri.hostname))continue;
        const payload=await json(uri.href);
        if(generation!==state.generation)return;
        const items=cues(payload?.body);
        if(items.length)tracks.push({lang:language(entry.lan),label:entry.lan_doc||entry.lan,items});
      } catch(error) {console.warn('[Bili Dual] 字幕トラックをスキップ:',error);}
    }
    if(!tracks.length)throw new Error('字幕本文を取得できません（権限や地域を確認）');
    state.english=tracks.find(t=>t.lang==='en')||null;
    state.japanese=tracks.find(t=>t.lang==='ja')||null;
    state.source=state.english||state.japanese||tracks.find(t=>t.lang==='zh')||tracks[0];
    state.cache.clear();state.pending.clear();state.painted='';
    status('字幕: '+tracks.map(t=>t.label).join(' / '));
    render();
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
  async function translator(from,to) {
    const key=from+'>'+to;
    if(!state.translators.has(key)) {
      state.translators.set(key,(async()=>{
        if(!globalThis.Translator?.availability||!globalThis.Translator?.create)throw new Error('ChromeのTranslator APIを利用できません');
        const available=await globalThis.Translator.availability({sourceLanguage:from,targetLanguage:to});
        if(available==='unavailable')throw new Error(from+'→'+to+'の翻訳モデルは利用できません');
        return globalThis.Translator.create({sourceLanguage:from,targetLanguage:to});
      })());
    }
    return state.translators.get(key);
  }
  function translated(track,index,target,generation) {
    const source=track.items[index].content;
    if(track.lang===target)return source;
    const key=track.lang+'>'+target+'#'+index+'#'+source;
    if(state.cache.has(key))return state.cache.get(key);
    if(!state.pending.has(key)) {
      state.pending.add(key);
      translator(track.lang,target).then(model=>model.translate(source)).then(result=>{
        if(generation!==state.generation)return;
        state.cache.set(key,String(result||''));
        state.pending.delete(key);render();
      }).catch(err=>{
        if(generation!==state.generation)return;
        state.cache.set(key,'');state.pending.delete(key);
        status('翻訳不可: '+(err?.message||String(err)));
        render();
      });
    }
    return null;
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
    const en=line('en',time,found,state.generation);
    const ja=line('ja',time,found,state.generation);
    const lines=[en||'English: 翻訳中…',ja||'日本語: 翻訳中…'];
    if(state.original&&state.source.lang!=='en'&&state.source.lang!=='ja')lines.push(found.cue.content);
    const signature=lines.join('\n')+'|'+state.font;
    if(signature===state.painted)return;
    state.painted=signature;
    state.caption.replaceChildren(...lines.map((value,i)=>{
      const el=document.createElement('div');el.className='vm-dual-line vm-dual-'+(i===0?'en':i===1?'ja':'original');el.textContent=value;return el;
    }));
    // Look ahead only two segments to avoid sending a full transcript to the model.
    for(let i=found.index+1;i<=Math.min(found.index+2,state.source.items.length-1);i++) {
      if(!state.english)translated(state.source,i,'en',state.generation);
      if(!state.japanese)translated(state.source,i,'ja',state.generation);
    }
  }
  function enable(value) {
    state.enabled=value;GM_setValue('dual-enabled',value);
    if(state.button) {state.button.textContent=value?'日英字幕 ON':'日英字幕 OFF';state.button.setAttribute('aria-pressed',String(value));}
    if(!value)state.caption?.replaceChildren();
    else {state.painted='';render();}
  }
  function mount(video) {
    const player=video.closest('.bpx-player-container, #bilibili-player, .bilibili-player')||video.parentElement;
    if(!player)return;
    if(state.player===player&&state.video===video&&state.root?.isConnected)return;
    state.root?.remove();state.player=player;state.video=video;
    if(getComputedStyle(player).position==='static')player.style.position='relative';
    if(!document.getElementById('vm-dual-style')) {
      const style=document.createElement('style');style.id='vm-dual-style';
      style.textContent='#vm-dual-root{position:absolute;inset:0;z-index:75;pointer-events:none;color:#fff;font-family:Arial,"Noto Sans JP",sans-serif;--vm-font:24px}#vm-dual-root .vm-dual-tools{position:absolute;top:12px;right:12px;display:flex;gap:5px;opacity:.8;pointer-events:auto}#vm-dual-root .vm-dual-tools:hover{opacity:1}#vm-dual-root button{border:0;cursor:pointer;border-radius:7px;background:#202632ec;color:#fff;font-size:12px;padding:7px 10px}#vm-dual-root button:focus-visible{outline:2px solid #ffe188}#vm-dual-root .vm-dual-options{position:absolute;top:48px;right:12px;width:240px;max-width:calc(100% - 24px);box-sizing:border-box;padding:12px;border-radius:9px;border:1px solid #fff4;background:#141920f0;font-size:12px;pointer-events:auto}#vm-dual-root .vm-dual-options[hidden]{display:none}#vm-dual-root .vm-dual-options label{display:flex;align-items:center;gap:8px;margin-bottom:10px}#vm-dual-root .vm-dual-options input[type=range]{min-width:50px;flex:1}#vm-dual-root .vm-dual-status{opacity:.85;overflow-wrap:anywhere;margin-top:10px}#vm-dual-root .vm-dual-caption{position:absolute;left:2%;right:2%;bottom:11%;text-align:center;font-weight:700;font-size:var(--vm-font);line-height:1.35;text-shadow:0 2px 5px #000,0 0 2px #000;white-space:pre-wrap;overflow-wrap:anywhere}#vm-dual-root .vm-dual-line{display:table;max-width:98%;margin:2px auto;padding:1px 8px;border-radius:4px;background:#000a}#vm-dual-root .vm-dual-ja{color:#ffe494}#vm-dual-root .vm-dual-original{color:#ddd;font-size:.72em}@media(max-width:600px){#vm-dual-root .vm-dual-caption{font-size:clamp(14px,4vw,var(--vm-font))}}';
      (document.head||document.documentElement).appendChild(style);
    }
    const root=document.createElement('div');root.id='vm-dual-root';
    root.innerHTML='<div class="vm-dual-tools"><button class="vm-dual-toggle" type="button"></button><button class="vm-dual-config" type="button" aria-label="字幕設定">⚙</button></div><div class="vm-dual-options" hidden><label><input type="checkbox" class="vm-dual-original-setting">原文も表示</label><label>文字サイズ <input type="range" class="vm-dual-font-setting" min="16" max="40" step="2"></label><button class="vm-dual-retry" type="button">字幕を再取得</button><div class="vm-dual-status" role="status"></div></div><div class="vm-dual-caption"></div>';
    player.appendChild(root);
    state.root=root;state.caption=root.querySelector('.vm-dual-caption');state.button=root.querySelector('.vm-dual-toggle');state.statusElement=root.querySelector('.vm-dual-status');
    state.button.addEventListener('click',()=>enable(!state.enabled));
    root.querySelector('.vm-dual-config').addEventListener('click',()=>{const panel=root.querySelector('.vm-dual-options');panel.hidden=!panel.hidden;});
    const original=root.querySelector('.vm-dual-original-setting');
    original.checked=state.original;
    original.addEventListener('change',()=>{state.original=original.checked;GM_setValue('dual-original',state.original);state.painted='';render();});
    const slider=root.querySelector('.vm-dual-font-setting');slider.value=String(state.font);
    slider.addEventListener('input',()=>{state.font=Number(slider.value);GM_setValue('dual-font',state.font);root.style.setProperty('--vm-font',state.font+'px');state.painted='';render();});
    root.querySelector('.vm-dual-retry').addEventListener('click',()=>refresh(true));
    root.style.setProperty('--vm-font',state.font+'px');status(state.status);enable(state.enabled);
  }
  async function refresh(force=false) {
    const video=currentVideo();if(!video)return;
    const pageKey=video.bvid+'/'+video.page;
    if(!force&&pageKey===state.page)return;
    state.page=pageKey;state.generation++;
    const generation=state.generation;
    state.source=null;state.english=null;state.japanese=null;
    state.cache.clear();state.pending.clear();state.translators.clear();state.painted='';
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
    if(state.source&&state.root?.isConnected)render();
    if(state.page!==video.bvid+'/'+video.page&&!state.loading) {
      state.loading=true;
      refresh().finally(()=>{state.loading=false;});
    }
  }
  tick();setInterval(tick,750);
})();