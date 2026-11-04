'use strict';

const state = {
  interval: '5m', pollMs: 10000, limit: 200, engDef: 'both',
  candles: [], tick: null, tickUpdatedAt: 0, candleUpdatedAt: 0, trendUpdatedAt: 0, tickLatencyMs: null, candleLatencyMs: null, trendLatencyMs: null, running: false, timer: null,
  candleError: null, tickError: null, patterns: [], zones: [], trendH1: null, trendM15: null, trendH4: null, trendM5: null, trendError: null
};
let pollingRunId = 0;
let trendLastAttempt = 0;
let trendRequest = null;
const TREND_REFRESH_MS = 60000;
const view = { barSpacing: 7, scrollOffset: -5, minBar: 2, maxBar: 40 };
const PERFORMANCE_KEY = 'genji_pure_engulfing_performance_v1';
const SIGNAL_LOG_KEY = 'genji_pure_engulfing_signal_log_v1';
let signalLog = readSignalLog();
let selectedLogId = null;
function readSignalLog() {
  try { const rows=JSON.parse(localStorage.getItem(SIGNAL_LOG_KEY)||'[]'); return Array.isArray(rows)?rows:[]; }
  catch (_) { return []; }
}
function saveSignalLog() {
  signalLog=signalLog.slice(-1000);
  try { localStorage.setItem(SIGNAL_LOG_KEY,JSON.stringify(signalLog)); }
  catch (error) { console.warn('GENJI: signal log tidak dapat disimpan',error); }
}
function recordSignalLog(signal,candle,pattern,score,grade,detail) {
  if(!candle) return;
  const id=[state.interval,candle.t,signal].join('_');
  if(signalLog.some(row=>row.id===id)) return;
  signalLog.push({
    id,interval:state.interval,time:candle.t,signal,
    pattern:pattern?.name||'Tiada engulfing',
    patternType:pattern?.type||'—',
    score,grade,detail,
    o:candle.o,h:candle.h,l:candle.l,c:candle.c
  });
  saveSignalLog();
  renderSignalLog();
}
function renderSignalLog() {
  const filter=$('log-filter')?.value||'ALL';
  const rows=signalLog.filter(row=>row.interval===state.interval&&(filter==='ALL'||row.signal===filter)).slice().sort((a,b)=>b.time-a.time);
  $('log-count').textContent=rows.length+' rekod · '+state.interval;
  $('log-history').innerHTML=rows.length?rows.slice(0,100).map(row=>
    '<div class="log-row"><div><strong class="'+row.signal.toLowerCase()+'">'+row.signal+' · '+row.pattern+'</strong><small>'+new Date(row.time*1000).toLocaleString('ms-MY')+' · Skor '+row.score+'/100 · '+row.grade+'</small><small>'+row.detail+'</small></div><button class="ghost log-replay-btn" type="button" data-log-id="'+encodeURIComponent(row.id)+'">Lihat candle</button></div>'
  ).join(''):'<p>Tiada rekod untuk pilihan ini.</p>';
  const selected=signalLog.find(row=>row.id===selectedLogId);
  if(selected) showLogSnapshot(selected);
}
function showLogSnapshot(row) {
  selectedLogId=row.id;
  $('log-replay').innerHTML='<strong>Snapshot candle · '+row.signal+' · '+row.interval+'</strong><p>'+new Date(row.time*1000).toLocaleString('ms-MY')+'</p><div class="log-ohlc"><span>OPEN <b>'+row.o.toFixed(2)+'</b></span><span>HIGH <b>'+row.h.toFixed(2)+'</b></span><span>LOW <b>'+row.l.toFixed(2)+'</b></span><span>CLOSE <b>'+row.c.toFixed(2)+'</b></span></div><p>Pattern: '+row.pattern+' · Confirmation: '+row.score+'/100 ('+row.grade+')</p><p>'+row.detail+'</p>';
}
function exportSignalLog() {
  const filter=$('log-filter').value;
  const rows=signalLog.filter(row=>row.interval===state.interval&&(filter==='ALL'||row.signal===filter));
  const fields=['time','interval','signal','pattern','patternType','score','grade','detail','o','h','l','c'];
  const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  const csv=[fields.join(','),...rows.map(row=>fields.map(field=>quote(row[field])).join(','))].join('\r\n');
  const blob=new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download='genji-signal-log-'+state.interval+'.csv';
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}

function readPerformanceRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(PERFORMANCE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch (_) { return []; }
}
let performanceRecords = readPerformanceRecords();
const alertState = { soundEnabled:false, notifyEnabled:false, lastSignalKey:'', lastScoreKey:'', history:[], audioContext:null };
function savePerformanceRecords() {
  try { localStorage.setItem(PERFORMANCE_KEY, JSON.stringify(performanceRecords.slice(-500))); }
  catch (error) { console.warn('GENJI: rekod performance tidak dapat disimpan', error); }
}
function alertReasonText(signal, detail, scoreGrade) {
  return signal + ' · ' + detail + ' · Skor ' + scoreGrade;
}
function playSignalTone(signal) {
  if (!alertState.soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!alertState.audioContext) alertState.audioContext = new AudioCtx();
    const ctx = alertState.audioContext;
    if (ctx.state === 'suspended') ctx.resume();
    const notes = signal === 'BUY' ? [880,1175] : [440,330];
    notes.forEach((frequency,index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001,ctx.currentTime + index*0.16);
      gain.gain.exponentialRampToValueAtTime(0.16,ctx.currentTime + index*0.16 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime + index*0.16 + 0.18);
      oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.start(ctx.currentTime + index*0.16);
      oscillator.stop(ctx.currentTime + index*0.16 + 0.2);
    });
  } catch (error) { console.warn('GENJI: audio alert tidak tersedia',error); }
}
function pushSignalAlert(signal, candle, detail, scoreGrade) {
  if (!candle) return;
  const key=[state.interval,candle.t,signal].join('_');
  if (alertState.lastSignalKey !== key) {
    alertState.lastSignalKey=key;
    const message=alertReasonText(signal,detail,scoreGrade);
    const item={signal,time:candle.t,message};
    alertState.history.unshift(item);
    alertState.history=alertState.history.slice(0,5);
    $('alert-latest').textContent=message;
    $('alert-state').textContent=signal==='WAIT'?'MENUNGGU / WAIT':'SIGNAL '+signal;
    $('alert-history').innerHTML=alertState.history.map(entry=>
      '<div class="alert-row"><strong class="'+entry.signal.toLowerCase()+'">'+entry.signal+'</strong><span>'+new Date(entry.time*1000).toLocaleString('ms-MY')+'</span><small>'+entry.message+'</small></div>'
    ).join('');
    if (signal==='BUY'||signal==='SELL') {
      playSignalTone(signal);
      if (alertState.notifyEnabled && 'Notification' in window && Notification.permission==='granted') {
        try { new Notification('GENJI XAUUSD · '+signal,{body:message,tag:'genji-'+key}); } catch (_) {}
      }
    }
  }
  const scoreKey=[state.interval,candle.t,scoreGrade].join('_');
  if (alertState.lastScoreKey && alertState.lastScoreKey.split('_').slice(0,2).join('_')===[state.interval,String(candle.t)].join('_') && alertState.lastScoreKey!==scoreKey) {
    $('alert-state').textContent='SKOR BERUBAH · '+scoreGrade;
  }
  alertState.lastScoreKey=scoreKey;
}
function registerPerformanceSignal(signal, candle, pattern, features) {
  if (!candle || !pattern || !['BUY','SELL'].includes(signal)) return;
  const id = [state.interval, candle.t, signal, pattern.type].join('_');
  if (performanceRecords.some(record => record.id === id)) return;
  const entry = candle.c;
  const stop = signal === 'BUY' ? candle.l : candle.h;
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= 0) return;
  const target = signal === 'BUY' ? entry + risk : entry - risk;
  performanceRecords.push({
    id, symbol:'XAUUSD', interval:state.interval, side:signal,
    pattern:pattern.name, patternType:pattern.type, signalTime:candle.t,
    entry, stop, target, risk, outcome:'PENDING', barsChecked:0,
    memoryFeatures:features, createdAt:Date.now()
  });
  performanceRecords = performanceRecords.slice(-500);
  savePerformanceRecords();
}
function compareMemoryFeatures(a, b) {
  if (!a || !b) return 0;
  let score=0, weight=0;
  const checks=[
    ['side',25],['patternType',15],['h1',10],['m15',10],
    ['nearZone',10],['rejection',10]
  ];
  for (const [key,w] of checks) { weight+=w; if (a[key]===b[key]) score+=w; }
  weight+=20;
  score+=Math.max(0,20-Math.round(Math.abs((a.bodyRatio||0)-(b.bodyRatio||0))*100));
  return score/weight;
}
function renderPatternMemory(currentFeatures) {
  const candidates=performanceRecords.filter(record =>
    record.interval===state.interval &&
    record.memoryFeatures &&
    record.outcome!=='PENDING' &&
    ['WIN','LOSS'].includes(record.outcome)
  ).map(record=>({record,similarity:compareMemoryFeatures(currentFeatures,record.memoryFeatures)}))
   .filter(item=>item.similarity>=0.65)
   .sort((a,b)=>b.similarity-a.similarity || b.record.signalTime-a.record.signalTime);
  const wins=candidates.filter(item=>item.record.outcome==='WIN').length;
  const losses=candidates.filter(item=>item.record.outcome==='LOSS').length;
  const total=wins+losses;
  $('memory-count').textContent=String(performanceRecords.filter(r=>r.interval===state.interval&&r.memoryFeatures).length)+' rekod';
  $('memory-matches').textContent=String(total);
  $('memory-wins').textContent=String(wins);
  $('memory-losses').textContent=String(losses);
  $('memory-rate').textContent=total?(wins/total*100).toFixed(1)+'%':'—';
  $('memory-verdict').textContent=!currentFeatures?'Menunggu setup BUY/SELL untuk dibandingkan.':total<3?'Belum cukup sampel serupa. Perlukan sekurang-kurangnya 3 rekod selesai; jangan tafsir kadar ini sebagai ramalan.': 'Ditemui '+total+' setup hampir serupa. Statistik ini hanya ringkasan rekod simulasi lepas, bukan ramalan.';
  const recent=candidates.slice(0,5);
  $('memory-history').innerHTML=recent.length?recent.map(item=>{
    const r=item.record;
    return '<div class="performance-row"><div><strong>'+r.side+' · '+r.pattern+'</strong><small>'+new Date(r.signalTime*1000).toLocaleString('ms-MY')+' · Persamaan '+Math.round(item.similarity*100)+'% · '+r.interval+'</small></div><span class="perf-status '+r.outcome+'">'+r.outcome+'</span></div>';
  }).join(''):'<p>Belum ada setup lama yang serupa dan selesai dinilai. Memori akan terkumpul apabila rekod baharu disimpan.</p>';
}
function updatePerformanceOutcomes() {
  let changed = false;
  for (const record of performanceRecords) {
    if (record.interval !== state.interval || record.outcome !== 'PENDING') continue;
    const future = state.candles.filter(c =>
      c.t > record.signalTime && isClosedCandle(c, record.interval)
    ).sort((a,b)=>a.t-b.t).slice(0,5);
    for (let i=0;i<future.length;i++) {
      const candle = future[i];
      const hitTarget = record.side === 'BUY' ? candle.h >= record.target : candle.l <= record.target;
      const hitStop = record.side === 'BUY' ? candle.l <= record.stop : candle.h >= record.stop;
      record.barsChecked = i + 1;
      if (hitTarget && hitStop) {
        record.outcome = 'AMBIGUOUS';
        record.resolvedAt = candle.t;
        changed = true;
        break;
      }
      if (hitTarget) {
        record.outcome = 'WIN';
        record.resolvedAt = candle.t;
        changed = true;
        break;
      }
      if (hitStop) {
        record.outcome = 'LOSS';
        record.resolvedAt = candle.t;
        changed = true;
        break;
      }
    }
    if (record.outcome === 'PENDING' && future.length >= 5) {
      record.outcome = 'EXPIRED';
      record.resolvedAt = future[4].t;
      record.barsChecked = 5;
      changed = true;
    }
  }
  if (changed) savePerformanceRecords();
}
function renderPatternStatistics() {
  const records=performanceRecords.filter(record=>record.interval===state.interval);
  const groups=new Map();
  for(const record of records){
    const key=(record.patternType||record.pattern||'Pattern tidak diketahui')+' · '+record.side;
    if(!groups.has(key)) groups.set(key,{name:record.pattern||record.patternType||'Pattern',type:record.patternType||'—',side:record.side,total:0,wins:0,losses:0,pending:0,other:0});
    const group=groups.get(key);group.total++;
    if(record.outcome==='WIN')group.wins++;
    else if(record.outcome==='LOSS')group.losses++;
    else if(record.outcome==='PENDING')group.pending++;
    else group.other++;
  }
  const sorted=[...groups.values()].sort((a,b)=>(b.wins+b.losses)-(a.wins+a.losses)||b.total-a.total);
  $('pattern-stats-scope').textContent=state.interval+' · '+records.length+' signal';
  $('pattern-stats').innerHTML=sorted.length?sorted.map(group=>{
    const resolved=group.wins+group.losses;
    const rate=resolved?(group.wins/resolved*100).toFixed(1)+'%':'—';
    return '<div class="pattern-stat-row"><div class="pattern-stat-title"><strong>'+group.name+'</strong><span class="'+group.side.toLowerCase()+'">'+group.side+'</span></div><div class="pattern-stat-metrics"><span>WIN <b class="perf-win">'+group.wins+'</b></span><span>LOSS <b class="perf-loss">'+group.losses+'</b></span><span>PENDING <b>'+group.pending+'</b></span><span>LAIN <b>'+group.other+'</b></span><span>WIN RATE <b>'+rate+'</b></span></div><div class="pattern-stat-track"><i style="width:'+(resolved?group.wins/resolved*100:0)+'%"></i></div><small>'+group.total+' rekod · '+resolved+' keputusan selesai</small></div>';
  }).join(''):'<p>Belum ada rekod simulasi BUY/SELL untuk timeframe ini. Statistik akan muncul selepas setup direkod dan dinilai.</p>';
}
function renderPerformanceInsight() {
  const records=performanceRecords.filter(record=>
    record.interval===state.interval && ['WIN','LOSS'].includes(record.outcome) && record.memoryFeatures
  );
  const makeGroups=(keyFn)=> {
    const groups=new Map();
    for(const record of records){
      const key=keyFn(record);
      if(!key) continue;
      if(!groups.has(key)) groups.set(key,{key,wins:0,losses:0});
      const group=groups.get(key);
      if(record.outcome==='WIN') group.wins++; else group.losses++;
    }
    return [...groups.values()].map(group=>({...group,total:group.wins+group.losses,rate:group.wins/(group.wins+group.losses)}))
      .filter(group=>group.total>=5)
      .sort((a,b)=>b.rate-a.rate || b.total-a.total);
  };
  const patterns=makeGroups(record=>(record.pattern||record.patternType||'Pattern')+' · '+record.side);
  const conditions=makeGroups(record=>{
    const f=record.memoryFeatures;
    return 'H1 '+(f.h1||'unknown')+' / M15 '+(f.m15||'unknown')+
      ' · '+(f.nearZone?'Dekat zon':'Jauh zon')+
      ' · '+(f.rejection?'Ada rejection':'Tiada rejection');
  });
  const sample=records.length;
  $('insight-sample').textContent=sample+' sampel selesai';
  if(sample<5){
    $('insight-verdict').textContent='Belum cukup data. Ada '+sample+' keputusan WIN/LOSS; perlukan sekurang-kurangnya 5 rekod selesai untuk mula memaparkan insight.';
  } else {
    const best=patterns[0];
    const bestCondition=conditions[0];
    $('insight-verdict').textContent=best
      ? 'Kumpulan pattern tertinggi dalam sampel: '+best.key+' — '+(best.rate*100).toFixed(1)+'% ('+best.wins+' WIN / '+best.losses+' LOSS).'
      : 'Belum ada kumpulan pattern dengan 5 sampel selesai. Kumpulkan lebih banyak rekod sebelum membuat perbandingan.';
  }
  const rows=[];
  if(patterns.length){
    const best=patterns[0];
    rows.push('<div class="insight-row"><strong>Pattern tertinggi · '+best.key+'</strong><span>'+(best.rate*100).toFixed(1)+'% WIN RATE</span><small>'+best.total+' sampel selesai · '+best.wins+' WIN · '+best.losses+' LOSS</small></div>');
  } else rows.push('<p>Belum ada pattern yang mencapai minimum 5 sampel.</p>');
  if(conditions.length){
    const best=conditions[0];
    rows.push('<div class="insight-row"><strong>Keadaan pasaran paling tinggi dalam rekod</strong><span>'+(best.rate*100).toFixed(1)+'% WIN RATE</span><small>'+best.key+' · '+best.total+' sampel · '+best.wins+' WIN / '+best.losses+' LOSS</small></div>');
  } else rows.push('<p>Belum ada gabungan keadaan pasaran dengan minimum 5 sampel.</p>');
  const lowSample=records.length<20;
  rows.push('<div class="insight-note">'+(lowSample?'Amaran: jumlah keseluruhan masih kecil ('+sample+' sampel). Perbandingan boleh berubah apabila rekod bertambah.':'Semak juga jumlah sampel setiap kumpulan; kadar tinggi dengan sampel kecil mudah berubah.')+'</div>');
  $('insight-details').innerHTML=rows.join('');
}
function renderPerformance() {
  const records = performanceRecords.filter(record => record.interval === state.interval);
  const wins = records.filter(record => record.outcome === 'WIN').length;
  const losses = records.filter(record => record.outcome === 'LOSS').length;
  const pending = records.filter(record => record.outcome === 'PENDING').length;
  const other = records.filter(record => ['EXPIRED','AMBIGUOUS'].includes(record.outcome)).length;
  const resolved = wins + losses;
  $('perf-scope').textContent = 'XAUUSD · ' + state.interval + ' · Rekod peranti ini';
  $('perf-total').textContent = String(records.length);
  $('perf-winrate').textContent = resolved ? (wins / resolved * 100).toFixed(1) + '%' : '—';
  $('perf-wins').textContent = String(wins);
  $('perf-losses').textContent = String(losses);
  $('perf-pending').textContent = String(pending);
  $('perf-other').textContent = String(other);
  const recent = records.slice().sort((a,b)=>b.signalTime-a.signalTime).slice(0,10);
  $('perf-history').innerHTML = recent.length ? recent.map(record => {
    const date = new Date(record.signalTime * 1000).toLocaleString('ms-MY');
    const price = Number(record.entry).toFixed(2);
    return '<div class="performance-row"><div><strong>' + record.side + ' · ' + record.pattern + '</strong><small>' + date + ' · Entry ' + price + ' · ' + record.interval + '</small></div><span class="perf-status ' + record.outcome + '">' + record.outcome + '</span></div>';
  }).join('') : '<p>Belum ada rekod signal untuk timeframe ini. Dashboard mula merekod selepas signal BUY/SELL baharu disahkan.</p>';
  renderPatternStatistics();
  renderPerformanceInsight();
}
const chart = {
  axisW: 74, timeH: 26, volPct: 0.18, hover: null,
  dragging: false, dragStartX: 0, dragStartOffset: 0
};
let rafId = null;

function $(id) { return document.getElementById(id); }
function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = null; renderChart(); });
}
function unixTime(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const n = Number(value);
    return Math.floor(n > 1e12 ? n / 1000 : n);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : NaN;
}
async function getJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) {
      let detail = '';
      try { const body = await response.json(); detail = body.message || body.error || ''; } catch (_) {}
      throw new Error('HTTP ' + response.status + (detail ? ' · ' + detail : ''));
    }
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new Error('Respons API bukan JSON yang sah');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('API lambat melebihi 15 saat');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function parseCandleBars(bars) {
  if(!Array.isArray(bars))throw new Error('Format OHLC tidak dikenali');
  const parsed=bars.map(bar=>({
    t:unixTime(bar.openTime??bar.time??bar.t??bar.timestamp),
    o:Number(bar.open??bar.o),h:Number(bar.high??bar.h),l:Number(bar.low??bar.l),c:Number(bar.close??bar.c),
    v:Number(bar.tickVolume??bar.volume??0),
    isOpen:bar.isOpen===true,isClosed:bar.isClosed===true,
    hasOpenFlag:typeof bar.isOpen==='boolean',hasClosedFlag:typeof bar.isClosed==='boolean'
  })).filter(c=>Number.isFinite(c.t)&&[c.o,c.h,c.l,c.c].every(Number.isFinite)&&c.h>=Math.max(c.o,c.c,c.l)&&c.l<=Math.min(c.o,c.c,c.h)).sort((a,b)=>a.t-b.t);
  const unique=[];
  for(const c of parsed){if(!unique.length||c.t>unique[unique.length-1].t)unique.push(c);else if(c.t===unique[unique.length-1].t)unique[unique.length-1]=c;}
  return unique;
}
const CANDLE_CACHE_PREFIX='genji_pure_engulfing_candles_v1_';
function loadCachedCandles(interval){
  try{
    const rows=JSON.parse(localStorage.getItem(CANDLE_CACHE_PREFIX+interval)||'[]');
    if(!Array.isArray(rows))return[];
    // Cache candles are historical snapshots: strip API open/closed flags so
    // isClosedCandle derives closure from each candle timestamp and timeframe.
    const clean=rows.map(c=>({t:c.t??c.time??c.timestamp,o:c.o??c.open,h:c.h??c.high,l:c.l??c.low,c:c.c??c.close,v:c.v??c.volume??0}));
    return parseCandleBars(clean).slice(-10000);
  }catch(_){return[];}
}
function saveCachedCandles(){
  try{localStorage.setItem(CANDLE_CACHE_PREFIX+state.interval,JSON.stringify(state.candles.slice(-10000)));}catch(error){console.warn('GENJI: cache candle tidak dapat disimpan',error);}
}
function restoreCachedCandles(){
  state.candles=loadCachedCandles(state.interval);
  if(state.candles.length){detectPatterns();calculateSupportResistance();updatePerformanceOutcomes();renderAll();}
}
function mergeCandles(existing,incoming,max=10000){
  const map=new Map();existing.forEach(c=>map.set(c.t,c));incoming.forEach(c=>map.set(c.t,c));
  return [...map.values()].sort((a,b)=>a.t-b.t).slice(-max);
}
async function fetchCandles(){
  const requestStarted=Date.now();
  const url='https://biquote.io/api/XAUUSD/ohlc?interval='+encodeURIComponent(state.interval)+'&limit='+state.limit;
  const data=await getJson(url);
  const parsed=parseCandleBars(Array.isArray(data)?data:data.bars);
  if(!parsed.length)throw new Error('API tiada candle sah');
  state.candles=mergeCandles(state.candles,parsed);
  state.candleUpdatedAt=Date.now();
  state.candleLatencyMs=state.candleUpdatedAt-requestStarted;
  saveCachedCandles();
  detectPatterns();calculateSupportResistance();
}
function renderHistoryLoader(){
  if(!$('history-loaded-count'))return;
  const candles=state.candles;
  $('history-loaded-count').textContent=candles.length.toLocaleString('en-US');
  $('history-loaded-tf').textContent=state.interval;
  if(candles.length>1){
    const days=(candles[candles.length-1].t-candles[0].t)/86400;
    $('history-loaded-span').textContent=days>=1?days.toFixed(1)+' hari':(days*24).toFixed(1)+' jam';
  }else $('history-loaded-span').textContent='—';
}
async function loadHistoricalCandles(){
  const button=$('btn-load-history'),status=$('history-load-status'),note=$('history-load-note');
  // BiQuote documents a maximum of 1,000 OHLC bars per request.
  const requested=Math.min(1000,Math.max(100,Number($('history-load-limit').value)||1000));
  button.disabled=true;button.textContent='Sedang memuat…';status.textContent='MEMUAT';
  note.textContent='Meminta sehingga '+requested.toLocaleString('en-US')+' candle '+state.interval+' daripada BiQuote API (had 1,000 setiap permintaan)…';
  try{
    const tf=state.interval;
    const data=await getJson('https://biquote.io/api/XAUUSD/ohlc?interval='+encodeURIComponent(tf)+'&limit='+requested);
    if(tf!==state.interval)throw new Error('Timeframe berubah semasa pemuatan. Cuba semula.');
    const bars=parseCandleBars(Array.isArray(data)?data:data.bars);
    if(!bars.length)throw new Error('Tiada candle sejarah sah diterima.');
    state.candles=mergeCandles(state.candles,bars,10000);
    saveCachedCandles();
    detectPatterns();calculateSupportResistance();renderAll();renderHistoryLoader();
    updatePerformanceOutcomes();runAiBacktest();scanHistoricalSignals();
    const days=(state.candles.at(-1).t-state.candles[0].t)/86400;
    status.textContent='SELESAI';
    note.textContent='API memulangkan '+bars.length.toLocaleString('en-US')+' candle. Jumlah unik disimpan: '+state.candles.length.toLocaleString('en-US')+'. Liputan kira-kira '+(days>=1?days.toFixed(1)+' hari':(days*24).toFixed(1)+' jam')+'.';
  }catch(error){status.textContent='RALAT';note.textContent='Gagal memuat sejarah: '+error.message+'. Data sedia ada tidak dipadamkan.';}
  finally{button.disabled=false;button.textContent='Muat sejarah';renderHistoryLoader();}
}
async function fetchTrendTimeframe(interval) {
  const url = 'https://biquote.io/api/XAUUSD/ohlc?interval=' + encodeURIComponent(interval) + '&limit=80';
  const data = await getJson(url);
  const bars = Array.isArray(data) ? data : data.bars;
  if (!Array.isArray(bars)) throw new Error('Format trend ' + interval + ' tidak dikenali');
  return bars.map(b => ({
    t: unixTime(b.openTime ?? b.time ?? b.t ?? b.timestamp),
    c: Number(b.close ?? b.c),
    isOpen: b.isOpen === true,
    isClosed: b.isClosed === true,
    hasOpenFlag: typeof b.isOpen === 'boolean',
    hasClosedFlag: typeof b.isClosed === 'boolean'
  })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.c)).sort((a,b)=>a.t-b.t);
}
function candleDurationMs(interval) {
  const map = {'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};
  return map[interval] || 300000;
}
function isClosedCandle(candle, interval) {
  if (candle.hasClosedFlag) return candle.isClosed;
  if (candle.hasOpenFlag) return !candle.isOpen;
  return candle.t * 1000 + candleDurationMs(interval) <= Date.now();
}
function emaLast(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i=period;i<values.length;i++) ema = values[i] * k + ema * (1-k);
  return ema;
}
function getTrend(bars, interval) {
  const closes = bars.filter(b => isClosedCandle(b, interval)).map(b => b.c);
  if (closes.length < 25) return {label:'DATA TAK CUKUP', direction:'unknown'};
  const fast = emaLast(closes, 9), slow = emaLast(closes, 21);
  if (fast === null || slow === null) return {label:'DATA TAK CUKUP', direction:'unknown'};
  if (fast > slow) return {label:'BULLISH', direction:'bull'};
  if (fast < slow) return {label:'BEARISH', direction:'bear'};
  return {label:'NEUTRAL', direction:'neutral'};
}
async function fetchTrend() {
  const requestStarted=Date.now();
  try {
    const [h4,h1,m15,m5] = await Promise.all([
      fetchTrendTimeframe('4h'),fetchTrendTimeframe('1h'),
      fetchTrendTimeframe('15m'),fetchTrendTimeframe('5m')
    ]);
    state.trendH4=getTrend(h4,'4h');
    state.trendH1=getTrend(h1,'1h');
    state.trendM15=getTrend(m15,'15m');
    state.trendM5=getTrend(m5,'5m');
    state.trendError=null;
    state.trendUpdatedAt=Date.now();
    state.trendLatencyMs=state.trendUpdatedAt-requestStarted;
    return true;
  } catch(error) {
    const missing={label:'DATA TAK ADA',direction:'unknown'};
    state.trendH4=state.trendH1=state.trendM15=state.trendM5=missing;
    state.trendError=error.message;
    return false;
  }
}
async function refreshTrendIfNeeded(force=false) {
  if (trendRequest) return trendRequest;
  const hasTrend=Boolean(state.trendH4&&state.trendH1&&state.trendM15&&state.trendM5);
  if (!force && hasTrend && Date.now()-trendLastAttempt<TREND_REFRESH_MS) return true;
  trendLastAttempt=Date.now();
  trendRequest=fetchTrend();
  try { return await trendRequest; }
  finally { trendRequest=null; }
}
async function fetchTick() {
  const requestStarted=Date.now();
  const data = await getJson('https://biquote.io/api/XAUUSD');
  const price = Number(data.mid ?? data.bid ?? data.last);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Harga live tidak sah');
  state.tick = {
    mid: price,
    dayDiffPercent: Number(data.dayDiffPercent),
    source: data.source,
    marketState: data.marketState,
    stale: Boolean(data.stale)
  };
  state.tickUpdatedAt = Date.now();
  state.tickLatencyMs = state.tickUpdatedAt-requestStarted;
}
function calculateSupportResistance() {
  const closed = state.candles.filter(c => isClosedCandle(c, state.interval));
  if (closed.length < 12) { state.zones = []; return; }
  const sample = closed.slice(-60).map(c => Math.max(c.h - c.l, 0));
  const sortedRanges = sample.slice().sort((a,b)=>a-b);
  const medianRange = sortedRanges[Math.floor(sortedRanges.length / 2)] || 1;
  const tolerance = Math.max(medianRange * 0.35, 0.25);
  const candidates = [];
  for (let i=2; i<closed.length-2; i++) {
    const candle = closed[i];
    const left = closed.slice(i-2,i);
    const right = closed.slice(i+1,i+3);
    if (left.every(c=>c.h < candle.h) && right.every(c=>c.h <= candle.h)) {
      candidates.push({type:'resistance',price:candle.h,index:i,time:candle.t});
    }
    if (left.every(c=>c.l > candle.l) && right.every(c=>c.l >= candle.l)) {
      candidates.push({type:'support',price:candle.l,index:i,time:candle.t});
    }
  }
  const zones = [];
  for (const point of candidates) {
    let zone = zones.find(z=>z.type===point.type && Math.abs(z.mid-point.price)<=tolerance);
    if (!zone) {
      zone={type:point.type,prices:[point.price],mid:point.price,touches:1,lastIndex:point.index,lastTime:point.time};
      zones.push(zone);
    } else {
      zone.prices.push(point.price);
      zone.mid=zone.prices.reduce((sum,value)=>sum+value,0)/zone.prices.length;
      zone.touches=zone.prices.length;
      zone.lastIndex=point.index;
      zone.lastTime=point.time;
    }
  }
  state.zones=zones.filter(z=>z.touches>=2).map(z=>({
    ...z,low:z.mid-tolerance*0.35,high:z.mid+tolerance*0.35,
    tolerance
  })).sort((a,b)=>b.touches-a.touches || b.lastIndex-a.lastIndex).slice(0,12);
}
function getNearestZones(price) {
  if (!Number.isFinite(price)) return {support:null,resistance:null};
  const supports=state.zones.filter(z=>z.type==='support' && z.mid<=price).sort((a,b)=>b.mid-a.mid);
  const resistances=state.zones.filter(z=>z.type==='resistance' && z.mid>=price).sort((a,b)=>a.mid-b.mid);
  return {support:supports[0]||null,resistance:resistances[0]||null};
}
function renderZones() {
  const price=state.tick?.mid ?? state.candles[state.candles.length-1]?.c;
  const nearest=getNearestZones(price);
  const fmt=z=>z?z.mid.toFixed(2):'—';
  $('zone-near-support').textContent=fmt(nearest.support);
  $('zone-near-resistance').textContent=fmt(nearest.resistance);
  $('zone-support-distance').textContent=nearest.support?Math.abs(price-nearest.support.mid).toFixed(2)+' jarak harga · '+nearest.support.touches+' sentuhan':'Tiada zon support dikenal pasti';
  $('zone-resistance-distance').textContent=nearest.resistance?Math.abs(nearest.resistance.mid-price).toFixed(2)+' jarak harga · '+nearest.resistance.touches+' sentuhan':'Tiada zon resistance dikenal pasti';
  $('a-support').textContent=fmt(nearest.support);
  $('a-resistance').textContent=fmt(nearest.resistance);
  const renderList=(type,id)=>{
    const list=state.zones.filter(z=>z.type===type).sort((a,b)=>type==='support'?b.mid-a.mid:a.mid-b.mid).slice(0,6);
    $(id).innerHTML=list.length?list.map(z=>'<div class="zone-row"><strong>'+z.low.toFixed(2)+' – '+z.high.toFixed(2)+'</strong><small>'+z.touches+' sentuhan · tengah '+z.mid.toFixed(2)+'</small></div>').join(''):'<p>Belum ada zon kukuh (perlukan sekurang-kurangnya 2 pivot).</p>';
  };
  renderList('support','zone-support-list');
  renderList('resistance','zone-resistance-list');
}
function detectPatterns() {
  const found = [];
  const candles = state.candles;
  for (let i = 1; i < candles.length; i++) {
    const previous = candles[i - 1], current = candles[i];
    const body = Math.abs(current.c - current.o);
    const range = Math.max(current.h - current.l, 1e-8);
    const upper = current.h - Math.max(current.o, current.c);
    const lower = Math.min(current.o, current.c) - current.l;
    let name = '';

    const bodyBull = previous.c < previous.o && current.c > current.o &&
      current.o <= previous.c && current.c >= previous.o;
    const bodyBear = previous.c > previous.o && current.c < current.o &&
      current.o >= previous.c && current.c <= previous.o;
    const fullBull = previous.c < previous.o && current.c > current.o &&
      current.h >= previous.h && current.l <= previous.l;
    const fullBear = previous.c > previous.o && current.c < current.o &&
      current.h >= previous.h && current.l <= previous.l;
    const bullMatch = state.engDef === 'full' ? fullBull :
      state.engDef === 'body' ? bodyBull : (bodyBull || fullBull);
    const bearMatch = state.engDef === 'full' ? fullBear :
      state.engDef === 'body' ? bodyBear : (bodyBear || fullBear);
    if (bullMatch) {
      name = 'Bullish Engulfing';
    } else if (bearMatch) {
      name = 'Bearish Engulfing';
    } else if (body / range <= 0.1) {
      name = 'Doji';
    } else if (lower >= body * 2 && upper <= body * 0.7) {
      name = 'Bullish Pin Bar';
    } else if (upper >= body * 2 && lower <= body * 0.7) {
      name = 'Bearish Pin Bar';
    }
    if (name) found.push({ index: i, name, type: (fullBull || fullBear) ? 'FULL CANDLE' : (bodyBull || bodyBear) ? 'PURE BODY' : '—' });
  }
  state.patterns = found;
}
async function tickOnce(runId) {
  if (!state.running || runId !== pollingRunId) return;
  const results = await Promise.allSettled([fetchCandles(), fetchTick(), refreshTrendIfNeeded()]);
  // Ignore responses from an older Start/Stop cycle or a previous timeframe.
  if (!state.running || runId !== pollingRunId) return;
  if(results[0].status==='fulfilled'){updatePerformanceOutcomes();runAiBacktest();}
  state.candleError = results[0].status === 'rejected' ? results[0].reason.message : null;
  state.tickError = results[1].status === 'rejected' ? results[1].reason.message : null;
  renderAll();
  if (state.running && runId === pollingRunId) state.timer = setTimeout(()=>tickOnce(runId), state.pollMs);
}
function start() {
  if (state.running) return;
  pollingRunId++;
  const runId=pollingRunId;
  state.running = true;
  $('btn-start').disabled = true;
  $('btn-stop').disabled = false;
  tickOnce(runId);
}
function stop() {
  state.running = false;
  pollingRunId++;
  clearTimeout(state.timer);
  state.timer = null;
  $('btn-start').disabled = false;
  $('btn-stop').disabled = true;
  renderTopbar();
  renderApiHealth();
}
function renderTopbar() {
  const dot = $('conn-dot');
  dot.className = 'live-dot' + (state.candleError ? ' err' : state.running ? ' on' : '');
  const tickAgeMs=state.tickUpdatedAt?Date.now()-state.tickUpdatedAt:Infinity;
  const tickIsOld=Boolean(state.tickError || state.tick?.stale || tickAgeMs>30000);
  let message = state.candleError
    ? 'RALAT DATA: ' + state.candleError
    : state.running ? 'LIVE · ' + state.interval + ' · ' + state.pollMs / 1000 + 's'
    : 'Berhenti';
  if (tickIsOld && state.tick) message += ' · HARGA LAMA';
  else if (state.tickError && !state.candleError) message += ' · Harga live tidak tersedia';
  $('conn-text').textContent = message;

  if (state.tick) {
    $('live-price').textContent = state.tick.mid.toFixed(2);
    const change = state.tick.dayDiffPercent;
    $('live-change').textContent = Number.isFinite(change)
      ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '—';
    $('live-change').className = 'chg ' +
      (Number.isFinite(change) && change < 0 ? 'red' : 'green');
  } else {
    $('live-price').textContent = '—';
    $('live-change').textContent = '—';
  }
}
function renderApiHealth(){
  const el=id=>document.getElementById(id);
  if(!el('api-health-status'))return;
  const now=Date.now(),age=stamp=>stamp?Math.max(0,Math.round((now-stamp)/1000)):Infinity;
  const tickAge=age(state.tickUpdatedAt),candleAge=age(state.candleUpdatedAt),trendAge=age(state.trendUpdatedAt);
  const tickOk=Boolean(state.tick&&tickAge<=30&&!state.tick.stale&&!state.tickError);
  const candleOk=Boolean(state.candles.length&&candleAge<=45&&!state.candleError);
  const trends=[state.trendH4,state.trendH1,state.trendM15,state.trendM5];
  const mtfReady=trends.every(x=>x&&x.direction&&x.direction!=='unknown'&&x.direction!=='DATA TAK ADA');
  const mtfOk=Boolean(mtfReady&&trendAge<=120&&!state.trendError);
  const failures=[state.tickError,state.candleError,state.trendError].filter(Boolean);
  const allOk=tickOk&&candleOk&&mtfOk,anyData=Boolean(state.tick||state.candles.length||trends.some(Boolean));
  el('api-health-status').textContent=allOk?'SEMUA ONLINE':anyData?'SEMAK DATA':'MENUNGGU';
  el('api-health-status').className='api-health-pill '+(allOk?'ok':anyData?'warn':'');
  el('api-health-tick').textContent=tickOk?'ONLINE':state.tickError?'RALAT API':state.tick?'DATA LAMA':'MENUNGGU';
  el('api-health-tick').className=tickOk?'ok-text':'bad-text';
  el('api-health-tick-time').textContent=state.tickUpdatedAt?'Kemas kini '+tickAge+'s lalu'+(state.tickLatencyMs!==null?' · '+state.tickLatencyMs+'ms':''):'Belum ada respons harga';
  el('api-health-tf-label').textContent=state.interval.toUpperCase();
  el('api-health-candles').textContent=candleOk?'ONLINE':state.candleError?'RALAT API':state.candles.length?'CACHE / LAMA':'MENUNGGU';
  el('api-health-candles').className=candleOk?'ok-text':'bad-text';
  el('api-health-candle-detail').textContent=state.candles.length+' candle tersedia · '+(state.candleUpdatedAt?candleAge+'s sejak API berjaya':'belum ada respons API');
  el('api-health-mtf').textContent=mtfOk?'4/4 ONLINE':state.trendError?'RALAT / DATA KURANG':trends.filter(x=>x&&x.direction&&x.direction!=='unknown').length+'/4 DATA';
  el('api-health-mtf').className=mtfOk?'ok-text':'bad-text';
  el('api-health-mtf-detail').textContent=state.trendUpdatedAt?'Kemas kini '+trendAge+'s lalu'+(state.trendLatencyMs!==null?' · '+state.trendLatencyMs+'ms':''):(state.trendError||'Menunggu empat timeframe');
  el('api-health-latency').textContent=[state.tickLatencyMs,state.candleLatencyMs,state.trendLatencyMs].map(v=>v===null?'—':v+'ms').join(' / ');
  el('api-health-latency-detail').textContent='Tick / Candle / MTF';
  el('api-health-last-check').textContent='Semakan UI: '+new Date().toLocaleTimeString('ms-MY');
  el('api-health-errors').textContent=failures.length?'Ralat: '+failures.join(' · '):allOk?'Tiada ralat aktif.':'Status belum lengkap atau data sudah luput.';
}

function renderAll() {
  renderHistoryLoader();
  renderTopbar();
  renderApiHealth();
  renderChart();
  updateHud();
}
function updateHud() {
  $('hud-tf').textContent = state.interval;
  const index = chart.hover?.index;
  const candle = state.candles[index ?? state.candles.length - 1];
  if (candle) {
    $('hud-ohlc').innerHTML = ['o', 'h', 'l', 'c'].map(key =>
      '<span><span class="lbl">' + key.toUpperCase() + '</span>' +
      candle[key].toFixed(2) + '</span>').join('');
  } else {
    $('hud-ohlc').textContent = 'Menunggu data candle…';
  }
  const pattern = state.patterns.find(item =>
    item.index === (index ?? state.candles.length - 1)) ||
    state.patterns[state.patterns.length - 1];
  $('hud-eng').textContent = pattern
    ? 'Corak: ' + pattern.name : 'Corak: belum dikesan';
  renderAnalysis();
}
function calculateMarketRegime(candles, interval) {
  const closed=candles.filter(c=>isClosedCandle(c,interval));
  if(closed.length<30) return {label:'MENUNGGU DATA',trend:'—',volatility:'—',ratio:null,allowSignal:false,reason:'Perlukan sekurang-kurangnya 30 candle tertutup untuk klasifikasi.'};
  const bars=closed.slice(-30);
  const ema=(values,period)=>{const k=2/(period+1);let value=values[0];for(let i=1;i<values.length;i++)value=values[i]*k+value*(1-k);return value;};
  const closes=bars.map(c=>c.c);
  const fast=ema(closes.slice(-20),9),slow=ema(closes,21);
  const spread=Math.abs(fast-slow)/Math.max(Math.abs(closes[closes.length-1]),1);
  const shortRange=bars.slice(-10).reduce((sum,c)=>sum+c.h-c.l,0)/10;
  const longRange=bars.reduce((sum,c)=>sum+c.h-c.l,0)/bars.length;
  const ratio=longRange>0?shortRange/longRange:1;
  let volatility='NORMAL',label='RANGING',trend='SIDEWAYS',reason='';
  if(ratio>=1.6){volatility='TINGGI';label='HIGH VOLATILITY';reason='Range 10 candle terlalu besar berbanding purata 30 candle. Signal ditahan sementara untuk elak keadaan luar biasa.';}
  else if(ratio<=0.65){volatility='RENDAH';label='LOW VOLATILITY';reason='Pergerakan perlahan; status ini dipaparkan sebagai konteks dan bukan sekatan signal.';}
  else if(spread>=0.0002&&fast>slow){label='TRENDING';trend='BULLISH';reason='EMA 9 di atas EMA 21; trend diklasifikasikan bullish.';}
  else if(spread>=0.0002&&fast<slow){label='TRENDING';trend='BEARISH';reason='EMA 9 di bawah EMA 21; trend diklasifikasikan bearish.';}
  else reason='EMA 9 dan EMA 21 hampir; pasaran ranging. Pengesahan utama tetap H1/M15 dan engulfing.';
  const allowSignal=ratio<1.6;
  return {label,trend,volatility,ratio,spread,allowSignal,reason};
}
function renderMarketRegime(regime) {
  $('regime-label').textContent=regime.label;
  $('regime-label').className='regime-pill '+(regime.label==='TRENDING'?'trend':regime.label==='RANGING'?'range':regime.label==='HIGH VOLATILITY'?'high':'low');
  $('regime-trend').textContent=regime.trend;
  $('regime-volatility').textContent=regime.volatility;
  $('regime-ratio').textContent=Number.isFinite(regime.ratio)?regime.ratio.toFixed(2)+'×':'—';
  $('regime-reason').textContent=regime.reason;
  $('regime-filter-status').textContent=regime.label==='TRENDING'?'LULUS · TRENDING SAHAJA':'BLOCK · WAIT';
}
function renderMtfAlignment() {
  const rows=[['H4',state.trendH4],['H1',state.trendH1],['M15',state.trendM15],['M5',state.trendM5]];
  rows.forEach(([tf,value])=>{
    const el=$('mtf-'+tf.toLowerCase());
    el.textContent=value?.label||'MENUNGGU';
    el.className=value?.direction==='bull'?'bull':value?.direction==='bear'?'bear':'unknown';
  });
  // H1 + M15 are the required confirmation pair. H4/M5 are context only.
  const h1=state.trendH1,m15=state.trendM15;
  const known=!!(h1&&m15&&['bull','bear'].includes(h1.direction)&&['bull','bear'].includes(m15.direction));
  const same=known&&h1.direction===m15.direction;
  const status=!known?'DATA H1/M15 TAK CUKUP':same?'H1 + M15 SELARI':'H1 / M15 BERCANGGAH';
  const extras=[['H4',state.trendH4],['M5',state.trendM5]].map(([tf,v])=>tf+' '+(v?.label||'MENUNGGU')).join(' · ');
  $('mtf-status').textContent=status;
  $('mtf-status').className='mtf-pill '+(same?'aligned':known?'conflict':'unknown');
  $('mtf-reason').textContent=!known?'H1 dan M15 perlu sekurang-kurangnya 25 candle tertutup yang sah.':same?'H1 dan M15 selari '+(h1.direction==='bull'?'BULLISH':'BEARISH')+'. H4/M5 ialah maklumat tambahan: '+extras+'.':'H1 dan M15 bercanggah. H4/M5 maklumat tambahan: '+extras+'.';
  $('mtf-filter-status').textContent=same?'LULUS · '+(h1.direction==='bull'?'BUY BIAS':'SELL BIAS'):'BLOCK · WAIT';
  return {aligned:same,side:same?h1.direction:null,status};
}
function renderAnalysis() {
  const candles = state.candles;
  const closedIndex = candles.map((c,i)=>isClosedCandle(c,state.interval)?i:-1).filter(i=>i>=0).pop();
  const candle = closedIndex == null ? null : candles[closedIndex];
  const pattern = closedIndex == null ? null : state.patterns.find(p=>p.index===closedIndex);
  const closedEngulfings=state.patterns.filter(p=>p.name.includes('Engulfing')&&candles[p.index]&&isClosedCandle(candles[p.index],state.interval));
  const latestEngulfing=closedEngulfings.length?closedEngulfings[closedEngulfings.length-1]:null;
  const h1 = state.trendH1, m15 = state.trendM15;
  const mtf=renderMtfAlignment();
  const patternSide = pattern?.name.includes('Bullish') ? 'bull' : pattern?.name.includes('Bearish') ? 'bear' : null;
  const body = candle ? Math.abs(candle.c-candle.o) : 0;
  const range = candle ? Math.max(candle.h-candle.l,1e-8) : 1;
  const bodyRatio = body/range;
  const bodyStrong = bodyRatio >= 0.5;
  const marketRegime=calculateMarketRegime(candles,state.interval);
  const trendOK = patternSide && h1 && m15 && h1.direction===patternSide && m15.direction===patternSide;
  const currentPrice=candle?.c;
  const nearestZones=getNearestZones(currentPrice);
  const zoneTolerance=state.zones[0]?.tolerance || 1;
  const nearSupport=nearestZones.support && Math.abs(currentPrice-nearestZones.support.mid)<=zoneTolerance*2;
  const nearResistance=nearestZones.resistance && Math.abs(nearestZones.resistance.mid-currentPrice)<=zoneTolerance*2;
  const supportRejection=!!(candle && nearestZones.support && candle.l<=nearestZones.support.high && candle.c>nearestZones.support.mid);
  const resistanceRejection=!!(candle && nearestZones.resistance && candle.h>=nearestZones.resistance.low && candle.c<nearestZones.resistance.mid);
  const zoneContext=patternSide==='bull'?(nearSupport?'Harga berhampiran support. ':'')+(supportRejection?'Candle menunjukkan rejection ke atas di support.':''):patternSide==='bear'?(nearResistance?'Harga berhampiran resistance. ':'')+(resistanceRejection?'Candle menunjukkan rejection ke bawah di resistance.':''):'';

  // Confirmation Score: weighted technical-rule checklist, not a win probability.
  const scoreParts=[
    {label:'Engulfing',score:pattern && pattern.name.includes('Engulfing')?25:0,max:25},
    {label:'Trend H1 + M15',score:patternSide?((h1?.direction===patternSide?10:0)+(m15?.direction===patternSide?10:0)):0,max:20},
    {label:'Support / Resistance',score:patternSide==='bull'?(nearSupport?20:nearestZones.support?10:0):patternSide==='bear'?(nearResistance?20:nearestZones.resistance?10:0):0,max:20},
    {label:'Rejection',score:patternSide==='bull'?(supportRejection?15:0):patternSide==='bear'?(resistanceRejection?15:0):0,max:15},
    {label:'Kekuatan body',score:candle?Math.min(10,Math.round(bodyRatio/0.5*10)):0,max:10},
    {label:'Candle tertutup',score:candle?10:0,max:10}
  ];
  const confirmationScore=scoreParts.reduce((sum,part)=>sum+part.score,0);
  const scoreGrade=!candle?'MENUNGGU DATA':!pattern?'TIADA SETUP ENGULFING':confirmationScore>=75?'KUAT':confirmationScore>=55?'SEDERHANA':'LEMAH';
  const reasons=[];
  let signal='WAIT', detail='Menunggu pattern engulfing yang lengkap dan pengesahan trend H1/M15.';
  if (!candle) reasons.push({ok:false,text:'Belum ada candle tertutup yang sah untuk dianalisis.'});
  else if (!pattern) {
    const lastText=latestEngulfing
      ? ' Engulfing terakhir: '+latestEngulfing.name+' pada '+new Date(candles[latestEngulfing.index].t*1000).toLocaleString('ms-MY')+'.'
      : ' Tiada engulfing sah ditemui dalam candle tertutup yang dimuatkan.';
    reasons.push({ok:false,text:'Candle tertutup terkini tiada engulfing. '+closedEngulfings.length+' engulfing ditemui dalam '+candles.filter(c=>isClosedCandle(c,state.interval)).length+' candle tertutup.'+lastText});
  }
  else {
    reasons.push({ok:true,text:pattern.name+' ('+pattern.type+') dikesan pada candle tertutup terakhir.'});
    reasons.push({ok:bodyStrong,text:'Kekuatan body '+(bodyRatio*100).toFixed(0)+'% daripada range candle ('+(bodyStrong?'memadai':'agak kecil')+').' });
    reasons.push({ok:!!h1 && h1.direction===patternSide,text:'Trend H1: '+(h1?.label||'BELUM ADA')+'.'});
    reasons.push({ok:!!m15 && m15.direction===patternSide,text:'Trend M15: '+(m15?.label||'BELUM ADA')+'.'});
    if (patternSide==='bull') reasons.push({ok:!!supportRejection,text:zoneContext||'Tiada rejection support yang jelas; semak kedudukan zon support.'});
    if (patternSide==='bear') reasons.push({ok:!!resistanceRejection,text:zoneContext||'Tiada rejection resistance yang jelas; semak kedudukan zon resistance.'});
    reasons.push({ok:marketRegime.allowSignal,text:'Market regime: '+marketRegime.label+' · '+marketRegime.reason});
    reasons.push({ok:mtf.aligned&&mtf.side===patternSide,text:'Multi-timeframe: '+mtf.status+(mtf.side?' · '+mtf.side.toUpperCase():'')+'.'});
    if (trendOK && bodyStrong && marketRegime.allowSignal && mtf.aligned && mtf.side===patternSide) {
      signal=patternSide==='bull'?'BUY':'SELL';
      detail='Engulfing, candle tertutup, body dan trend H1/M15 searah. Signal teknikal disahkan.';
    } else {
      detail=!marketRegime.allowSignal?'Filter market regime: '+marketRegime.label+'. Signal ditahan; kekalkan WAIT.':(!mtf.aligned||mtf.side!==patternSide?'MTF '+mtf.status+' atau tidak searah dengan pattern. Signal ditahan; kekalkan WAIT.':'Pattern dikesan tetapi syarat confirmation belum lengkap. Kekalkan WAIT.');
    }
  }
  $('a-pattern').textContent=pattern?pattern.name:'TIADA';
  $('a-pattern-history').textContent=closedEngulfings.length+' ditemui · '+(latestEngulfing?latestEngulfing.name+' · '+new Date(candles[latestEngulfing.index].t*1000).toLocaleString('ms-MY'):'Belum ada engulfing tertutup dalam data dimuatkan');
  // Similarity sejarah: arah, jenis engulfing dan kekuatan body.
  const patternMemoryRows=latestEngulfing?closedEngulfings.filter(p=>p.index!==latestEngulfing.index).map(p=>{
    const c=candles[p.index],refC=candles[latestEngulfing.index];
    const side=p.name.includes('Bullish')?'bull':'bear';
    const refSide=latestEngulfing.name.includes('Bullish')?'bull':'bear';
    const ratio=Math.abs(c.c-c.o)/Math.max(c.h-c.l,1e-8);
    const refRatio=Math.abs(refC.c-refC.o)/Math.max(refC.h-refC.l,1e-8);
    const similarity=(side===refSide?40:0)+(p.type===latestEngulfing.type?25:0)+Math.max(0,35-Math.round(Math.abs(ratio-refRatio)*100));
    return {p,c,ratio,similarity};
  }).filter(x=>x.similarity>=65).sort((a,b)=>b.similarity-a.similarity||b.c.t-a.c.t):[];
  $('memory-pattern-total').textContent=String(closedEngulfings.length);
  $('memory-pattern-matches').textContent=String(patternMemoryRows.length);
  $('memory-pattern-verdict').textContent=latestEngulfing
    ? 'Rujukan: '+latestEngulfing.name+'. '+patternMemoryRows.length+' pattern sejarah mempunyai persamaan sekurang-kurangnya 65%. Ini perbandingan bentuk, bukan ramalan.'
    : 'Menunggu engulfing tertutup untuk dijadikan rujukan.';
  $('memory-pattern-history').innerHTML=patternMemoryRows.length
    ? patternMemoryRows.slice(0,5).map(x=>'<div class="performance-row"><div><strong>'+x.p.name+'</strong><small>'+new Date(x.c.t*1000).toLocaleString('ms-MY')+' · Body '+(x.ratio*100).toFixed(0)+'% · Persamaan '+x.similarity+'%</small></div><span class="perf-status PENDING">'+x.p.type+'</span></div>').join('')
    : '<p>Belum ada pattern sejarah yang cukup serupa.</p>';
  // Historical outcome study: compare the close after 3/5/10 closed candles
  // with the engulfing close, oriented by the pattern's own direction.
  const outcomeHorizons=[3,5,10];
  const outcomeRows=closedEngulfings.map(p=>{
    const base=candles[p.index];
    const side=p.name.includes('Bullish')?'bull':'bear';
    const future=outcomeHorizons.map(horizon=>{
      const later=candles.slice(p.index+1).filter(x=>isClosedCandle(x,state.interval));
      if(later.length<horizon)return {horizon,ready:false,move:null,classification:'BELUM CUKUP DATA'};
      const target=later[horizon-1];
      const raw=side==='bull'?target.c-base.c:base.c-target.c;
      const move=Number(raw.toFixed(2));
      const classification=move>0.05?'POSITIF':move< -0.05?'NEGATIF':'MENDATAR';
      return {horizon,ready:true,move,classification,time:target.t};
    });
    return {pattern:p,base,side,future};
  });
  const outcomeStats=outcomeHorizons.map(horizon=>{
    const rows=outcomeRows.map(r=>r.future.find(x=>x.horizon===horizon)).filter(x=>x?.ready);
    return {horizon,total:rows.length,positive:rows.filter(x=>x.classification==='POSITIF').length,negative:rows.filter(x=>x.classification==='NEGATIF').length,flat:rows.filter(x=>x.classification==='MENDATAR').length,average:rows.length?rows.reduce((sum,x)=>sum+x.move,0)/rows.length:null};
  });
  $('memory-outcome-stats').innerHTML=outcomeStats.map(x=>'<div class="memory-stat-row"><strong>+'+x.horizon+' candle</strong><span>'+x.total+' sampel</span><span class="perf-win">Positif '+x.positive+'</span><span class="perf-loss">Negatif '+x.negative+'</span><span>Mendatar '+x.flat+'</span><span>Purata arah '+(x.average===null?'—':(x.average>0?'+':'')+x.average.toFixed(2))+'</span></div>').join('');
  $('memory-outcome-history').innerHTML=outcomeRows.length
    ? outcomeRows.slice(-12).reverse().map(r=>{
      const result=r.future.map(x=>'<span class="outcome-chip '+(x.classification==='POSITIF'?'positive':x.classification==='NEGATIF'?'negative':'neutral')+'">'+x.horizon+': '+(x.ready?x.classification+' ('+(x.move>0?'+':'')+x.move.toFixed(2)+')':'belum cukup')+'</span>').join(' ');
      return '<div class="performance-row"><div><strong>'+r.pattern.name+'</strong><small>'+new Date(r.base.t*1000).toLocaleString('ms-MY')+' · Close '+r.base.c.toFixed(2)+'</small></div><div class="outcome-chip-list">'+result+'</div></div>';
    }).join('')
    : '<p>Belum ada engulfing tertutup untuk kajian outcome.</p>';
  const latestCandle=latestEngulfing?candles[latestEngulfing.index]:null;
  const liveReference=state.tick?.mid??candles.at(-1)?.c;
  const barsSinceEngulfing=latestEngulfing&&closedIndex!=null
    ? candles.slice(latestEngulfing.index+1,closedIndex+1).filter(c=>isClosedCandle(c,state.interval)).length
    : null;
  $('a-latest-engulfing').textContent=latestEngulfing?latestEngulfing.name:'TIADA REKOD';
  $('a-latest-time').textContent=latestCandle?new Date(latestCandle.t*1000).toLocaleString('ms-MY'):'—';
  $('a-latest-price').textContent=latestCandle?latestCandle.c.toFixed(2):'—';
  $('a-latest-distance').textContent=latestCandle&&Number.isFinite(liveReference)?Math.abs(liveReference-latestCandle.c).toFixed(2)+' mata':'—';
  $('a-latest-status').textContent=latestEngulfing
    ? (barsSinceEngulfing<=3?'TERKINI':'LAMA')+' · '+barsSinceEngulfing+' candle selepasnya'
    : 'BELUM ADA DATA';
  $('a-type').textContent=pattern?.type || (state.engDef==='both'?'BODY + FULL':state.engDef==='body'?'PURE BODY':'FULL CANDLE');
  $('a-h1').textContent=h1?.label||'MENUNGGU';
  $('a-m15').textContent=m15?.label||'MENUNGGU';
  $('a-candle').textContent=candle?'CLOSED':'MENUNGGU';
  $('a-body').textContent=candle?(bodyRatio*100).toFixed(0)+'%':'—';
  renderZones();
  renderMarketRegime(marketRegime);
  $('score-total').textContent=String(confirmationScore);
  $('score-bar').style.width=confirmationScore+'%';
  $('score-grade').textContent=scoreGrade;
  $('score-grade').className='score-grade '+(confirmationScore>=75&&pattern?'strong':confirmationScore>=55&&pattern?'medium':'weak');
  $('score-breakdown').innerHTML=scoreParts.map(part=>'<div class="score-line"><span>'+part.label+'</span><b>'+part.score+'/'+part.max+'</b></div>').join('');
  $('a-reason').innerHTML=reasons.map(r=>'<div class="reason-item '+(r.ok?'pass':'fail')+'">'+(r.ok?'✓ ':'! ')+r.text+'</div>').join('');
  const signalEl=$('a-signal'); signalEl.textContent=signal; signalEl.className='signal-result '+signal.toLowerCase();
  $('a-signal-detail').textContent=detail;
  $('a-signal-tf').textContent=state.interval;
  pushSignalAlert(signal,candle,detail,scoreGrade);
  recordSignalLog(signal,candle,pattern,confirmationScore,scoreGrade,detail);
  const memoryFeatures=pattern&&candle&&signal!=='WAIT'?{
    side:signal, patternType:pattern.type,
    h1:h1?.direction||'unknown', m15:m15?.direction||'unknown',
    bodyRatio:Number(bodyRatio.toFixed(3)),
    nearZone:!!(patternSide==='bull'?nearSupport:nearResistance),
    rejection:patternSide==='bull'?supportRejection:patternSide==='bear'?resistanceRejection:false,
    score:confirmationScore
  }:null;
  if (signal !== 'WAIT' && candle && pattern) registerPerformanceSignal(signal, candle, pattern, memoryFeatures);
  updatePerformanceOutcomes();
  renderPerformance();
  renderPatternMemory(memoryFeatures);
  const qualityChecks=[
    {label:'Engulfing candle tertutup',ok:!!(pattern&&pattern.name.includes('Engulfing')&&candle)},
    {label:'Body strength sekurang-kurangnya 50%',ok:bodyStrong},
    {label:'Trend H1 + M15 searah',ok:!!trendOK},
    {label:'Market regime TRENDING',ok:!!marketRegime.allowSignal},
    {label:'H4/H1/M15/M5 selari',ok:!!(mtf.aligned&&mtf.side===patternSide)}
  ];
  lastAiContext={signal,detail,score:confirmationScore,pattern,candle,regime:marketRegime,mtf,checks:qualityChecks};
  renderAiLab(lastAiContext);
}

const AI_LEARNING_KEY='genji_ai_learning_v1';
let aiLearningRecords=readAiLearning();
let lastAiContext=null;
function readAiLearning(){
  try{const rows=JSON.parse(localStorage.getItem(AI_LEARNING_KEY)||'[]');return Array.isArray(rows)?rows:[];}
  catch(_){return[];}
}
function saveAiLearning(){
  aiLearningRecords=aiLearningRecords.slice(-3000);
  try{localStorage.setItem(AI_LEARNING_KEY,JSON.stringify(aiLearningRecords));}
  catch(error){console.warn('GENJI: AI learning tidak dapat disimpan',error);}
}
function evaluateHistoricalPattern(candles,index,side,interval){
  const signal=candles[index];
  const entry=signal.c;
  const stop=side==='BUY'?signal.l:signal.h;
  const risk=Math.abs(entry-stop);
  if(!Number.isFinite(risk)||risk<=0)return{outcome:'INVALID',entry,stop,target:null,bars:0};
  const target=side==='BUY'?entry+risk:entry-risk;
  const future=candles.slice(index+1).filter(c=>isClosedCandle(c,interval)).slice(0,5);
  let outcome='PENDING',bars=0,resolvedAt=null;
  for(let i=0;i<future.length;i++){
    const c=future[i];
    const hitTarget=side==='BUY'?c.h>=target:c.l<=target;
    const hitStop=side==='BUY'?c.l<=stop:c.h>=stop;
    bars=i+1;
    if(hitTarget&&hitStop){outcome='AMBIGUOUS';resolvedAt=c.t;break;}
    if(hitTarget){outcome='WIN';resolvedAt=c.t;break;}
    if(hitStop){outcome='LOSS';resolvedAt=c.t;break;}
  }
  if(outcome==='PENDING'&&future.length>=5){outcome='EXPIRED';resolvedAt=future[4].t;}
  return{outcome,entry,stop,target,bars,resolvedAt};
}
function buildAiLearning(){
  const current=[];
  const candles=state.candles;
  for(const pattern of state.patterns){
    const i=pattern.index,c=candles[i];
    if(!c||!isClosedCandle(c,state.interval))continue;
    const side=pattern.name.includes('Bullish')?'BUY':pattern.name.includes('Bearish')?'SELL':null;
    if(!side)continue;
    const bodyRatio=Math.abs(c.c-c.o)/Math.max(c.h-c.l,1e-8);
    const result=evaluateHistoricalPattern(candles,i,side,state.interval);
    const id=[state.interval,c.t,pattern.name].join('_');
    const replayContext=candles.slice(Math.max(0,i-8),Math.min(candles.length,i+9)).map((bar,index)=>({t:Number(bar.t),o:Number(bar.o),h:Number(bar.h),l:Number(bar.l),c:Number(bar.c),isSetup:Math.max(0,i-8)+index===i}));
    current.push({id,interval:state.interval,time:c.t,side,pattern:pattern.name,patternType:pattern.type,open:c.o,high:c.h,low:c.l,close:c.c,bodyRatio:Number(bodyRatio.toFixed(3)),range:Number((c.h-c.l).toFixed(4)),h1:state.trendH1?.direction||'unknown',m15:state.trendM15?.direction||'unknown',outcome:result.outcome,entry:result.entry,stop:result.stop,target:result.target,bars:result.bars,resolvedAt:result.resolvedAt,replayContext});
  }
  const merged=new Map(aiLearningRecords.map(record=>[record.id,record]));
  current.forEach(record=>merged.set(record.id,record));
  aiLearningRecords=[...merged.values()].slice(-3000);
  saveAiLearning();
  renderBackupStats();
  return current;
}

function renderPatternLearningPro(context){
  if(!$('plp-status'))return;
  const pattern=context?.pattern,candle=context?.candle;
  const side=pattern?.name.includes('Bullish')?'BUY':pattern?.name.includes('Bearish')?'SELL':null;
  const bodyRatio=candle?Math.abs(candle.c-candle.o)/Math.max(candle.h-candle.l,1e-8):null;
  const signal=context?.signal||'WAIT';
  const all=aiLearningRecords.filter(r=>r.interval===state.interval);
  const matches=side&&pattern?all.filter(r=>r.side===side&&r.pattern===pattern.name&&Number.isFinite(r.bodyRatio)&&Math.abs(r.bodyRatio-bodyRatio)<=0.15):[];
  const resolved=matches.filter(r=>['WIN','LOSS'].includes(r.outcome));
  const wins=resolved.filter(r=>r.outcome==='WIN').length,losses=resolved.filter(r=>r.outcome==='LOSS').length,other=matches.length-resolved.length;
  $('plp-samples').textContent=String(matches.length);$('plp-wins').textContent=String(wins);$('plp-losses').textContent=String(losses);$('plp-other').textContent=String(other);
  $('plp-signal').textContent=signal;$('plp-signal').className=signal==='BUY'?'plp-buy':signal==='SELL'?'plp-sell':'plp-wait';
  $('plp-status').textContent=!candle?'MENUNGGU DATA':!pattern?'TIADA ENGULFING':matches.length>=3?'PADANAN DIJUMPAI':'KUMPUL SAMPEL';
  let summary='Belum ada setup engulfing tertutup untuk dibandingkan.';
  if(pattern&&candle)summary=pattern.name+' · '+state.interval+' · Body '+(bodyRatio*100).toFixed(0)+'%. '+matches.length+' rekod sejarah yang hampir serupa ditemui.';
  $('plp-reason').textContent=summary;
  const reasons=(context?.checks||[]).map(x=>'<div class="plp-reason-row '+(x.ok?'pass':'fail')+'"><b>'+(x.ok?'✓':'!')+'</b><span>'+x.label+'</span><small>'+(x.ok?'LULUS':'BELUM LULUS')+'</small></div>');
  if(signal==='WAIT'&&context?.detail)reasons.unshift('<div class="plp-reason-row fail"><b>!</b><span>'+context.detail+'</span><small>WAIT</small></div>');
  $('plp-reasons').innerHTML=reasons.length?reasons.join(''):'<p>Menunggu data confirmation.</p>';
  $('plp-history').innerHTML=matches.length?matches.slice().sort((a,b)=>b.time-a.time).slice(0,8).map(r=>'<div class="plp-history-row"><div><strong>'+r.pattern+' · '+r.side+'</strong><small>'+new Date(r.time*1000).toLocaleString('ms-MY')+' · Body '+(r.bodyRatio*100).toFixed(0)+'% · '+r.interval+'</small></div><span class="perf-status '+r.outcome+'">'+r.outcome+'</span></div>').join(''):'<p>Tiada rekod sepadan. Muat lebih banyak candle sejarah untuk menambah sampel.</p>';
  if(matches.length>0&&matches.length<3)$('plp-reason').textContent+=' Sampel belum cukup untuk ringkasan (perlukan sekurang-kurangnya 3).';
  if(matches.length>=3)$('plp-reason').textContent+=' Ringkasan sejarah: '+wins+' WIN, '+losses+' LOSS dan '+other+' keputusan lain/belum selesai. Ini rekod lampau, bukan ramalan.';
  renderAiAutoCompare({pattern,candle,side,bodyRatio,signal});
}
let lastAiAutoCompareContext=null;
function renderAiAutoCompare(current){
  if(!$('ac-results'))return;
  lastAiAutoCompareContext=current;
  const {pattern,candle,side,bodyRatio}=current;
  if(!pattern||!candle||!side){
    $('ac-best').textContent='—';$('ac-body-diff').textContent='—';$('ac-trend').textContent='—';
    $('ac-results').innerHTML='<p>Tiada setup engulfing BUY/SELL yang boleh dibandingkan sekarang.</p>';return;
  }
  const trendH1=state.trendH1?.direction||'unknown',trendM15=state.trendM15?.direction||'unknown';
  const candidates=aiLearningRecords.filter(r=>r.interval===state.interval&&r.id!==[state.interval,candle.t,pattern.name].join('_')&&r.side===side&&r.pattern===pattern.name&&Number.isFinite(Number(r.bodyRatio))&&Number.isFinite(Number(r.range))&&Number(r.range)>0)
    .map(r=>{
      const bodyDiff=Math.abs(Number(r.bodyRatio)-bodyRatio);
      const rangeDiff=Math.abs(Math.log(Number(r.range)/Math.max(candle.h-candle.l,1e-8)));
      const trendMatches=(r.h1===trendH1?1:0)+(r.m15===trendM15?1:0);
      const score=Math.max(0,Math.min(100,100-(bodyDiff*180)-(rangeDiff*12)+trendMatches*5));
      return{r,bodyDiff,trendMatches,score};
    }).sort((a,b)=>b.score-a.score||b.r.time-a.r.time);
  const threshold=Number($('ac-threshold')?.value||65);
  const filtered=candidates.filter(item=>item.score>=threshold);
  const best=filtered[0];
  $('ac-best').textContent=best?best.score.toFixed(0)+'%':'—';
  $('ac-body-diff').textContent=best?(best.bodyDiff*100).toFixed(1)+'%':'—';
  $('ac-trend').textContent=best?best.trendMatches+'/2':'—';
  $('ac-results').innerHTML=filtered.length?'<p class="ac-note">'+filtered.length+' daripada '+candidates.length+' rekod melepasi ambang '+threshold+'%. Ini ukuran persamaan, bukan skor kebarangkalian.</p>'+filtered.slice(0,5).map(({r,bodyDiff,trendMatches,score})=>'<div class="ac-row"><div><strong>'+r.pattern+' · '+r.side+' · '+score.toFixed(0)+'% serupa</strong><small>'+new Date(r.time*1000).toLocaleString('ms-MY')+' · Body '+(Number(r.bodyRatio)*100).toFixed(0)+'% · beza '+(bodyDiff*100).toFixed(1)+'% · trend '+trendMatches+'/2</small></div><span class="perf-status '+r.outcome+'">'+r.outcome+'</span></div>').join(''):'<p>Tiada rekod melepasi ambang '+threshold+'%. Cuba ambang lebih rendah atau kumpul lebih banyak sejarah.</p>';
}

function renderAiLab(context){
  if(!document.getElementById('tab-ailab'))return;
  const current=state.candles.filter(c=>isClosedCandle(c,state.interval));
  const learning=buildAiLearning();
  const resolved=aiLearningRecords.filter(r=>r.interval===state.interval&&['WIN','LOSS'].includes(r.outcome));
  const wins=resolved.filter(r=>r.outcome==='WIN').length;
  const losses=resolved.filter(r=>r.outcome==='LOSS').length;
  const latest=learning.slice(-1)[0];
  const matches=latest?resolved.filter(r=>r.side===latest.side&&r.pattern===latest.pattern&&Math.abs(r.bodyRatio-latest.bodyRatio)<=0.15):[];
  $('ai-samples').textContent=String(resolved.length);
  $('ai-wins').textContent=String(wins);
  $('ai-losses').textContent=String(losses);
  $('ai-matches').textContent=String(matches.length);
  $('ai-learning-status').textContent=resolved.length>=10?'BELAJAR · '+resolved.length:'KUMPUL DATA';
  $('ai-learning-note').textContent=latest?'Pattern terakhir: '+latest.pattern+' · '+latest.side+' · '+latest.outcome+'. '+matches.length+' rekod hampir serupa untuk perbandingan.':'Belum ada engulfing tertutup untuk dipelajari.';
  const recent=learning.slice().reverse().slice(0,6);
  $('ai-learning-history').innerHTML=recent.length?recent.map(r=>'<div class="ai-learning-row"><div><strong>'+r.pattern+' · '+r.side+'</strong><small>'+new Date(r.time*1000).toLocaleString('ms-MY')+' · Body '+(r.bodyRatio*100).toFixed(0)+'%</small></div><span class="perf-status '+r.outcome+'">'+r.outcome+'</span></div>').join(''):'<p>Belum ada pattern yang boleh direkodkan.</p>';

  const checks=context?.checks||[];
  $('ai-quality-state').textContent=context?.signal||'WAIT';
  $('ai-quality-checks').innerHTML=checks.length?checks.map(c=>'<div class="ai-check '+(c.ok?'pass':'fail')+'"><b>'+(c.ok?'✓':'!')+'</b><span>'+c.label+'</span><small>'+(c.ok?'LULUS':'BELUM LULUS')+'</small></div>').join(''):'<p>Menunggu data analisis.</p>';

  const p=context?.pattern,c=context?.candle;
  if(p&&c&&p.name.includes('Engulfing')){
    const side=p.name.includes('Bullish')?'BUY':'SELL';
    const stop=side==='BUY'?c.l:c.h;
    const risk=Math.abs(c.c-stop);
    const one=side==='BUY'?c.c+risk:c.c-risk;
    const two=side==='BUY'?c.c+risk*2:c.c-risk*2;
    const nearest=getNearestZones(c.c);
    const zone=side==='BUY'?nearest.support:nearest.resistance;
    $('ai-entry-side').textContent=side+' · SIMULASI';
    $('ai-entry-price').textContent=c.c.toFixed(2);
    $('ai-entry-stop').textContent=stop.toFixed(2);
    $('ai-entry-risk').textContent=risk.toFixed(2);
    $('ai-entry-1r').textContent=one.toFixed(2);
    $('ai-entry-2r').textContent=two.toFixed(2);
    $('ai-entry-retest').textContent=zone?zone.low.toFixed(2)+'–'+zone.high.toFixed(2):'Tiada zon';
    $('ai-entry-reason').textContent='Paras dikira daripada close dan high/low candle pattern tertutup. Ia hanya contoh pengiraan sejarah; tunggu data dan semak risiko secara berasingan.';
  }else{
    $('ai-entry-side').textContent='TIADA SETUP';
    ['ai-entry-price','ai-entry-stop','ai-entry-risk','ai-entry-1r','ai-entry-2r','ai-entry-retest'].forEach(id=>$(id).textContent='—');
    $('ai-entry-reason').textContent='Tiada engulfing tertutup terakhir untuk pengiraan simulasi.';
  }
  $('ai-dashboard-signal').textContent=context?.signal||'WAIT';
  $('ai-dash-regime').textContent=context?.regime?.label||'—';
  $('ai-dash-mtf').textContent=context?.mtf?.status||'—';
  $('ai-dash-score').textContent=Number.isFinite(context?.score)?context.score+'/100':'—';
  $('ai-dash-bars').textContent=current.length+' candle tertutup';
  $('ai-dashboard-reason').textContent=context?.detail||'Menunggu analisis terkini.';
  renderPatternLearningPro(context);
}
let lastBacktestResults=[];

let lastHistoricalScan=[];
function scanHistoricalSignals(){
 if(!$('scan-results'))return;
 const candles=state.candles.filter(c=>isClosedCandle(c,state.interval)),rows=[];
 const ema=(values,period)=>{const k=2/(period+1);let v=values[0];for(let n=1;n<values.length;n++)v=values[n]*k+v*(1-k);return v;};
 for(let i=1;i<candles.length;i++){
  const p=candles[i-1],c=candles[i],body=Math.abs(c.c-c.o),range=Math.max(c.h-c.l,1e-8),ratio=body/range;
  const bull=p.c<p.o&&c.c>c.o&&c.o<=p.c&&c.c>=p.o,bear=p.c>p.o&&c.c<p.o&&c.o>=p.c&&c.c<=p.o;
  const fb=bull&&c.h>=p.h&&c.l<=p.l,fs=bear&&c.h>=p.h&&c.l<=p.l;
  const mb=state.engDef==='full'?fb:state.engDef==='body'?bull:(bull||fb),ms=state.engDef==='full'?fs:state.engDef==='body'?bear:(bear||fs);
  if(!mb&&!ms)continue;
  const side=mb?'BUY':'SELL',dir=side==='BUY'?'bull':'bear',win=candles.slice(Math.max(0,i-29),i+1),closes=win.map(x=>x.c);
  const fast=ema(closes.slice(-Math.min(9,closes.length)),9),slow=ema(closes,Math.min(21,closes.length)),trend=fast>slow?'bull':fast<slow?'bear':'flat';
  const regime=calculateMarketRegime(win,state.interval),reasons=[];
  if(ratio<.5)reasons.push('Body '+(ratio*100).toFixed(0)+'% < 50%');
  if(trend!==dir)reasons.push('EMA timeframe tidak searah ('+trend.toUpperCase()+')');
  if(!regime.allowSignal)reasons.push('Regime '+regime.label);
  rows.push({time:c.t,side,result:reasons.length?'WAIT':side,body:ratio,price:c.c,pattern:side==='BUY'?'Bullish Engulfing':'Bearish Engulfing',reasons:reasons.length?reasons:['Syarat setempat lulus; MTF sejarah belum disahkan']});
 }
 lastHistoricalScan=rows;
 const count=x=>rows.filter(r=>r.result===x).length;
 $('scan-total').textContent=String(rows.length);$('scan-buy').textContent=String(count('BUY'));$('scan-sell').textContent=String(count('SELL'));$('scan-wait').textContent=String(count('WAIT'));
 $('scan-status').textContent=rows.length?'SELESAI':'TIADA SETUP';
 const first=candles[0]?.t,last=candles[candles.length-1]?.t;
 $('scan-coverage').textContent='Imbas '+candles.length+' candle tertutup · '+(first&&last?new Date(first*1000).toLocaleString('ms-MY')+' hingga '+new Date(last*1000).toLocaleString('ms-MY'):'liputan masa tidak tersedia')+' · '+rows.length+' engulfing ditemui.';
 renderHistoricalScan();
}
function renderHistoricalScan(){
 if(!$('scan-results'))return;
 const f=$('scan-filter').value,rows=lastHistoricalScan.filter(r=>f==='all'||r.result===f).slice().reverse().slice(0,60);
 $('scan-results').innerHTML=rows.length?rows.map(r=>'<article class="scan-row"><div class="scan-row-top"><strong>'+r.result+' · '+r.pattern+'</strong><span class="perf-status '+(r.result==='WAIT'?'PENDING':r.result)+'">'+r.result+'</span></div><small>'+new Date(r.time*1000).toLocaleString('ms-MY')+' · '+state.interval+' · Close '+r.price.toFixed(2)+' · Body '+(r.body*100).toFixed(0)+'%</small><p>'+r.reasons.join(' · ')+'</p></article>').join(''):'<p>Tiada rekod untuk penapis ini.</p>';
}

function runAiBacktest(){
  const candles=state.candles.filter(c=>isClosedCandle(c,state.interval));
  const range=$('ai-backtest-range').value,cutoff=range==='all'?0:Date.now()/1000-Number(range)*86400;
  const patterns=state.patterns.filter(p=>{const c=state.candles[p.index];return c&&c.t>=cutoff&&isClosedCandle(c,state.interval)&&p.name.includes('Engulfing');});
  const results=[];
  for(const p of patterns){const c=state.candles[p.index],side=p.name.includes('Bullish')?'BUY':'SELL';const x=evaluateHistoricalPattern(state.candles,p.index,side,state.interval);results.push({side,pattern:p.name,time:c.t,entry:x.entry,stop:x.stop,target:x.target,outcome:x.outcome,bars:x.bars});}
  lastBacktestResults=results;
  const count=o=>results.filter(r=>r.outcome===o).length,wins=count('WIN'),losses=count('LOSS'),total=wins+losses;
  $('bt-total').textContent=String(total);$('bt-wins').textContent=String(wins);$('bt-losses').textContent=String(losses);$('bt-rate').textContent=total?(wins/total*100).toFixed(1)+'%':'—';
  const sideSummary=side=>{const rows=results.filter(r=>r.side===side),w=rows.filter(r=>r.outcome==='WIN').length,l=rows.filter(r=>r.outcome==='LOSS').length,n=w+l;return rows.length+' pattern · '+w+'W/'+l+'L · '+(n?(w/n*100).toFixed(1)+'%':'tiada keputusan');};
  $('bt-buy-summary').textContent=sideSummary('BUY');$('bt-sell-summary').textContent=sideSummary('SELL');$('bt-ambiguous').textContent=String(count('AMBIGUOUS'));$('bt-expired').textContent=String(count('EXPIRED')+count('PENDING')+count('INVALID'));
  $('bt-results-list').innerHTML=results.length?results.slice().reverse().slice(0,30).map(r=>'<div class="bt-result-row"><div><strong>'+r.side+' · '+r.pattern+'</strong><small>'+new Date(r.time*1000).toLocaleString('ms-MY')+' · Entry '+(Number.isFinite(r.entry)?r.entry.toFixed(2):'—')+' · Stop '+(Number.isFinite(r.stop)?r.stop.toFixed(2):'—')+'</small></div><span class="perf-status '+r.outcome+'">'+r.outcome+'</span></div>').join(''):'<p>Tiada pattern engulfing ditemui dalam data yang dipilih.</p>';
  $('ai-backtest-status').textContent=results.length?'SELESAI':'DATA TERHAD';
  const first=candles[0]?.t,last=candles[candles.length-1]?.t,days=first&&last?(last-first)/86400:0,requested=range==='all'?'semua data tersedia':range+' hari terakhir';
  $('ai-backtest-note').textContent='Ujian '+requested+': '+patterns.length+' pattern ditemui. '+wins+' WIN, '+losses+' LOSS, '+count('AMBIGUOUS')+' AMBIGUOUS dan '+(count('EXPIRED')+count('PENDING')+count('INVALID'))+' belum selesai/luput. Liputan candle: '+(days>0?days.toFixed(1)+' hari':'tidak diketahui')+'. '+(range!=='all'&&days<Number(range)?'AMARAN: data tidak meliputi keseluruhan tempoh yang dipilih; keputusan hanya berdasarkan candle yang dimuatkan.':'Keputusan hanya berdasarkan data yang dimuatkan.');
}
function exportBacktestCsv(){
  if(!lastBacktestResults.length){$('ai-backtest-note').textContent='Tiada keputusan untuk dieksport. Jalankan backtest dahulu.';return;}
  const fields=['time','side','pattern','entry','stop','target','outcome','bars'],q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv=[fields.join(','),...lastBacktestResults.map(r=>fields.map(k=>q(r[k])).join(','))].join('\r\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='genji-backtest-'+state.interval+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}


function renderPatternReview(){
  if(!$('pr-list'))return;
  const tf=$('pr-filter-tf').value,outcome=$('pr-filter-outcome').value,side=$('pr-filter-side').value;
  const rows=aiLearningRecords.filter(r=>(tf==='all'||r.interval===tf)&&(outcome==='all'||r.outcome===outcome)&&(side==='all'||r.side===side)).slice().sort((a,b)=>b.time-a.time);
  const wins=rows.filter(r=>r.outcome==='WIN').length,losses=rows.filter(r=>r.outcome==='LOSS').length,done=wins+losses;
  $('pr-count').textContent=rows.length+' REKOD';$('pr-total').textContent=String(rows.length);$('pr-wins').textContent=String(wins);$('pr-losses').textContent=String(losses);$('pr-rate').textContent=done?(wins/done*100).toFixed(1)+'%':'—';
  $('pr-list').innerHTML=rows.length?rows.slice(0,40).map(r=>{
    const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';
    return '<article class="pr-record"><div class="pr-record-head"><div><strong>'+r.pattern+' · '+r.side+'</strong><small>'+new Date(r.time*1000).toLocaleString('ms-MY')+' · '+r.interval+'</small></div><span class="perf-status '+r.outcome+'">'+r.outcome+'</span></div><div class="pr-candle-grid"><div><small>OPEN</small><b>'+fmt(r.open)+'</b></div><div><small>HIGH</small><b>'+fmt(r.high)+'</b></div><div><small>LOW</small><b>'+fmt(r.low)+'</b></div><div><small>CLOSE</small><b>'+fmt(r.close)+'</b></div></div><div class="pr-meta">Body '+(Number.isFinite(Number(r.bodyRatio))?(r.bodyRatio*100).toFixed(0)+'%':'—')+' · H1 '+(r.h1||'—')+' · M15 '+(r.m15||'—')+' · Bars '+(r.bars??'—')+'</div><div class="pr-meta">Entry '+fmt(r.entry)+' · Stop '+fmt(r.stop)+' · Sasaran simulasi '+fmt(r.target)+'</div><button type="button" class="pr-replay-btn green" data-replay-id="'+encodeURIComponent(r.id)+'">▶ Replay candle ini</button></article>';
  }).join(''):'<p>Tiada rekod untuk pilihan tapisan ini. Muat sejarah candle dan jalankan analisis AI dahulu.</p>';
}
let activePatternReplayId=null;
let activeReplayContext=[];
let activeReplayStep=0;
let replayTimer=null;
function replayContextFor(record){
  if(Array.isArray(record.replayContext)&&record.replayContext.length){
    const saved=record.replayContext.filter(c=>c&&[c.t,c.o,c.h,c.l,c.c].every(v=>Number.isFinite(Number(v)))&&Number(c.h)>Number(c.l)).map(c=>({...c,isSetup:!!c.isSetup}));
    if(saved.length)return saved;
  }
  if(record.interval!==state.interval||!Array.isArray(state.candles)||!state.candles.length)return [];
  const seconds=({ '1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1d':86400 })[record.interval]||300;
  let best=-1,distance=Infinity;
  state.candles.forEach((c,i)=>{const d=Math.abs(Number(c.t)-Number(record.time));if(d<distance){distance=d;best=i;}});
  if(best<0||distance>seconds*0.6)return [];
  return state.candles.slice(Math.max(0,best-8),Math.min(state.candles.length,best+9)).map((c,i)=>({...c,isSetup:Math.max(0,best-8)+i===best}));
}
function openPatternReplay(id){
  const record=aiLearningRecords.find(r=>r.id===id);
  if(!record)return;
  activePatternReplayId=id;
  activeReplayContext=replayContextFor(record);
  stopAutoReplay();
  activeReplayStep=0;
  const panel=$('pr-replay');
  panel.hidden=false;
  $('pr-replay-title').textContent=(record.pattern||'PATTERN')+' · '+(record.side||'—');
  $('pr-replay-subtitle').textContent=new Date(Number(record.time)*1000).toLocaleString('ms-MY')+' · '+(record.interval||'—')+' · '+(record.outcome||'PENDING')+' · '+(activeReplayContext.length?activeReplayContext.length+' candle konteks':'snapshot sahaja');
  const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';
  $('pr-replay-values').innerHTML=[['OPEN',record.open],['HIGH',record.high],['LOW',record.low],['CLOSE',record.close]].map(([k,v])=>'<div><small>'+k+'</small><b>'+fmt(v)+'</b></div>').join('');
  $('pr-replay-meta').textContent='Body '+(Number.isFinite(Number(record.bodyRatio))?(Number(record.bodyRatio)*100).toFixed(0)+'%':'—')+' · H1 '+(record.h1||'—')+' · M15 '+(record.m15||'—')+' · Entry '+fmt(record.entry)+' · Stop '+fmt(record.stop)+' · Sasaran '+fmt(record.target)+' · Bars '+(record.bars??'—');
  drawPatternReplay(record,activeReplayContext);
  updateReplayStepLabel();
  updateReplayEventLabel(record);
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function replayEventFor(record,context){
  if(!Array.isArray(context)||context.length<2)return null;
  const setupIndex=context.findIndex(c=>c.isSetup);
  if(setupIndex<0)return null;
  const side=String(record.side||'').toUpperCase();
  const buy=side==='BUY',sell=side==='SELL';
  if(!buy&&!sell)return null;
  const stop=Number(record.stop),target=Number(record.target);
  if(!Number.isFinite(stop)||!Number.isFinite(target))return null;
  for(let i=setupIndex+1;i<context.length;i++){
    const candle=context[i],hitStop=buy?Number(candle.l)<=stop:Number(candle.h)>=stop;
    const hitTarget=buy?Number(candle.h)>=target:Number(candle.l)<=target;
    if(hitStop||hitTarget)return {index:i,ambiguous:hitStop&&hitTarget,label:hitStop&&hitTarget?'AMBIGUOUS · STOP & TARGET':hitStop?'STOP disentuh':'TARGET disentuh',kind:hitStop&&hitTarget?'ambiguous':hitStop?'stop':'target',time:candle.t};
  }
  return {index:-1,label:'Belum disentuh dalam konteks replay',kind:'pending'};
}
function updateReplayEventLabel(record){
  const node=$('pr-replay-event');if(!node)return;
  const event=replayEventFor(record,activeReplayContext);
  if(!event){node.textContent='Event: konteks candle tidak mencukupi untuk semakan';node.dataset.kind='pending';return;}
  const visible=event.index>=0&&event.index<=activeReplayStep;
  node.textContent=event.index<0?'Event: '+event.label:visible?'Event: '+event.label+' · Candle '+(event.index+1):'Event: menunggu candle seterusnya';
  node.dataset.kind=visible?event.kind:'pending';
}
function drawPatternReplay(record,context=[]){
  const canvas=$('pr-replay-canvas'),ctx=canvas.getContext('2d');
  if(!ctx)return;
  const w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#071009';ctx.fillRect(0,0,w,h);
  const valid=c=>[c.o,c.h,c.l,c.c].every(v=>Number.isFinite(Number(v)))&&Number(c.h)>Number(c.l);
  let bars=context.filter(valid);
  if(!bars.length&&valid({o:record.open,h:record.high,l:record.low,c:record.close}))bars=[{o:Number(record.open),h:Number(record.high),l:Number(record.low),c:Number(record.close),isSetup:true}];
  if(!bars.length){ctx.fillStyle='#f2cf36';ctx.font='16px system-ui';ctx.textAlign='center';ctx.fillText('OHLC tidak lengkap untuk replay',w/2,h/2);return;}
  bars=bars.slice(0,Math.max(1,Math.min(bars.length,activeReplayStep+1)));
  const levels=[{key:'entry',label:'ENTRY',value:Number(record.entry),color:'#f2cf36'},{key:'stop',label:'STOP',value:Number(record.stop),color:'#e06b61'},{key:'target',label:'TARGET',value:Number(record.target),color:'#19c463'}].filter(level=>Number.isFinite(level.value));
  const rawMax=Math.max(...bars.map(c=>Number(c.h))),rawMin=Math.min(...bars.map(c=>Number(c.l)));
  const max=Math.max(rawMax,...levels.map(level=>level.value)),min=Math.min(rawMin,...levels.map(level=>level.value)),range=max-min||1;
  const left=54,right=w-54,top=20,bottom=h-34,y=v=>top+(max-v)/range*(bottom-top);
  ctx.strokeStyle='#29452d';ctx.lineWidth=1;ctx.font='11px system-ui';ctx.fillStyle='#a8b8a4';ctx.textAlign='left';
  for(let i=0;i<=4;i++){const yy=top+(bottom-top)*i/4;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.fillText((max-range*i/4).toFixed(2),right+5,yy+4);}
  const slot=(right-left)/bars.length,candleW=Math.max(4,Math.min(18,slot*.58));
  bars.forEach((c,i)=>{
    const x=left+slot*(i+.5),bull=Number(c.c)>=Number(c.o),color=c.isSetup?'#f2cf36':(bull?'#19c463':'#d95b52');
    ctx.strokeStyle=color;ctx.lineWidth=c.isSetup?3:2;ctx.beginPath();ctx.moveTo(x,y(Number(c.h)));ctx.lineTo(x,y(Number(c.l)));ctx.stroke();
    const bodyTop=Math.min(y(Number(c.o)),y(Number(c.c))),bodyHeight=Math.max(2,Math.abs(y(Number(c.o))-y(Number(c.c))));
    ctx.fillStyle=color;ctx.fillRect(x-candleW/2,bodyTop,candleW,bodyHeight);
    if(c.isSetup){ctx.fillStyle='#f2cf36';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText('SETUP',x,13);}
  });
  const replayEvent=replayEventFor(record,context);
  if(replayEvent&&replayEvent.index>=0&&replayEvent.index<bars.length){
    const eventBar=bars[replayEvent.index],slotX=left+slot*(replayEvent.index+.5),eventY=y(Number(eventBar.c));
    ctx.save();ctx.fillStyle=replayEvent.kind==='target'?'#19c463':replayEvent.kind==='stop'?'#e06b61':'#f2cf36';ctx.strokeStyle='#071009';ctx.lineWidth=2;ctx.beginPath();ctx.arc(slotX,eventY,7,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font='bold 9px system-ui';ctx.textAlign='center';ctx.fillText(replayEvent.kind==='target'?'TARGET':replayEvent.kind==='stop'?'STOP':'BOTH',slotX,Math.max(top+10,eventY-12));ctx.restore();
  }
  levels.forEach(level=>{
    const yy=y(level.value);ctx.save();ctx.strokeStyle=level.color;ctx.fillStyle=level.color;ctx.lineWidth=1.5;ctx.setLineDash([7,5]);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.setLineDash([]);ctx.font='bold 9px system-ui';ctx.textAlign='left';ctx.fillText(level.label+' '+level.value.toFixed(2),left+4,Math.max(top+10,Math.min(bottom-3,yy-4)));ctx.restore();
  });
  ctx.fillStyle='#a8b8a4';ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText(bars.length>1?'Kuning = setup · Garis = paras simulasi · Hijau = bullish · Merah = bearish':'SNAPSHOT CANDLE · Garis = paras simulasi',w/2,h-8);
}
function updateReplayStepLabel(){
  const label=$('pr-replay-step');
  if(!label)return;
  const total=Math.max(1,activeReplayContext.length);
  label.textContent='Candle '+Math.min(activeReplayStep+1,total)+' / '+total+(activeReplayContext.length?' · Replay berperingkat':' · Snapshot sahaja');
  $('btn-replay-prev').disabled=activeReplayStep<=0;
  $('btn-replay-next').disabled=activeReplayStep>=total-1;
  const scrub=$('replay-scrubber');
  if(scrub){scrub.max=String(total-1);scrub.value=String(activeReplayStep);scrub.disabled=activeReplayContext.length<2;}
  const timeLabel=$('pr-replay-time');
  const candle=activeReplayContext[activeReplayStep];
  if(timeLabel)timeLabel.textContent=candle&&Number.isFinite(Number(candle.t))?new Date(Number(candle.t)*1000).toLocaleString('ms-MY'):'Masa candle tidak tersedia';
}
function stepPatternReplay(delta){
  if(!activePatternReplayId)return;
  const record=aiLearningRecords.find(r=>r.id===activePatternReplayId);
  if(!record)return;
  const total=Math.max(1,activeReplayContext.length);
  activeReplayStep=Math.max(0,Math.min(total-1,activeReplayStep+delta));
  drawPatternReplay(record,activeReplayContext);
  updateReplayStepLabel();
  updateReplayEventLabel(record);
  const current=activeReplayContext[activeReplayStep];
  if(current){const fmt=v=>Number(v).toFixed(2);$('pr-replay-values').innerHTML=[['OPEN',current.o],['HIGH',current.h],['LOW',current.l],['CLOSE',current.c]].map(([k,v])=>'<div><small>'+k+'</small><b>'+fmt(v)+'</b></div>').join('');}
}
function stopAutoReplay(){
  if(replayTimer!==null){clearInterval(replayTimer);replayTimer=null;}
  const button=$('btn-replay-auto');
  if(button){button.textContent='▶ Auto replay';button.classList.remove('replay-playing');}
}
function toggleAutoReplay(){
  if(replayTimer!==null){stopAutoReplay();return;}
  if(!activePatternReplayId||activeReplayContext.length<2)return;
  if(activeReplayStep>=activeReplayContext.length-1){activeReplayStep=0;stepPatternReplay(0);}
  const speed=Number($('replay-speed').value)||1000;
  const button=$('btn-replay-auto');
  button.textContent='Ⅱ Hentikan';button.classList.add('replay-playing');
  replayTimer=setInterval(()=>{
    if(activeReplayStep>=activeReplayContext.length-1){stopAutoReplay();return;}
    stepPatternReplay(1);
    if(activeReplayStep>=activeReplayContext.length-1)stopAutoReplay();
  },speed);
}
function closePatternReplay(){
  stopAutoReplay();
  $('pr-replay').hidden=true;
  activePatternReplayId=null;
  activeReplayContext=[];
  activeReplayStep=0;
}
function exportPatternReviewCsv(){
  const tf=$('pr-filter-tf').value,outcome=$('pr-filter-outcome').value,side=$('pr-filter-side').value;
  const rows=aiLearningRecords.filter(r=>(tf==='all'||r.interval===tf)&&(outcome==='all'||r.outcome===outcome)&&(side==='all'||r.side===side)).slice().sort((a,b)=>a.time-b.time);
  if(!rows.length){$('pr-list').innerHTML='<p>Tiada rekod untuk dieksport.</p>';return;}
  const fields=['time','interval','side','pattern','open','high','low','close','bodyRatio','h1','m15','entry','stop','target','outcome','bars','resolvedAt'];
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv=[fields.join(','),...rows.map(r=>fields.map(k=>q(r[k])).join(','))].join('\r\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='genji-pattern-review-'+(tf==='all'?'all':tf)+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

function renderBackupStats(){
  if(!$('backup-ai-count'))return;
  $('backup-ai-count').textContent=String(aiLearningRecords.length);
  $('backup-perf-count').textContent=String(performanceRecords.length);
  $('backup-log-count').textContent=String(signalLog.length);
}
function downloadGenjiBackup(){
  const payload={
    app:'GENJI PURE ENGULFING',
    schema:1,
    exportedAt:new Date().toISOString(),
    data:{
      aiLearning:aiLearningRecords,
      performance:performanceRecords,
      signalLog:signalLog
    }
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download='genji-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('backup-status').textContent='Backup berjaya dijana. Simpan fail JSON di tempat yang selamat.';
}
function mergeById(existing,incoming,keyFn,limit){
  const map=new Map();
  existing.forEach(row=>map.set(keyFn(row),row));
  incoming.forEach(row=>{if(row&&typeof row==='object')map.set(keyFn(row),row);});
  return [...map.values()].slice(-limit);
}
async function importGenjiBackup(file){
  if(!file)return;
  if(file.size>10*1024*1024){$('backup-status').textContent='Fail terlalu besar. Had import ialah 10 MB.';return;}
  try{
    const text=await file.text();
    const parsed=JSON.parse(text);
    if(parsed.app!=='GENJI PURE ENGULFING'||parsed.schema!==1||!parsed.data||typeof parsed.data!=='object')throw new Error('Format backup tidak dikenali.');
    const data=parsed.data;
    const validArray=(value)=>Array.isArray(value)?value:[];
    const ai=validArray(data.aiLearning).filter(r=>r&&typeof r.id==='string'&&typeof r.interval==='string'&&Number.isFinite(Number(r.time)));
    const perf=validArray(data.performance).filter(r=>r&&typeof r.id==='string'&&typeof r.interval==='string');
    const logs=validArray(data.signalLog).filter(r=>r&&typeof r.id==='string'&&typeof r.interval==='string');
    aiLearningRecords=mergeById(aiLearningRecords,ai,r=>r.id,3000);
    performanceRecords=mergeById(performanceRecords,perf,r=>r.id,500);
    signalLog=mergeById(signalLog,logs,r=>r.id,1000);
    saveAiLearning();
    savePerformanceRecords();
    saveSignalLog();
    renderBackupStats();
    renderPerformance();
    renderSignalLog();
    $('backup-status').textContent='Import selesai: '+ai.length+' rekod AI, '+perf.length+' performance dan '+logs.length+' signal log dibaca. Rekod sedia ada dikekalkan dan digabungkan.';
  }catch(error){
    $('backup-status').textContent='Import gagal: '+error.message;
  }
}

function drawTag(ctx, x, y, text, background, foreground) {
  ctx.font = 'bold 10px system-ui';
  const width = ctx.measureText(text).width + 12;
  ctx.fillStyle = background;
  ctx.fillRect(x - width / 2, y - 9, width, 18);
  ctx.fillStyle = foreground;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
function renderChart() {
  const canvas = $('chart');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f1729';
  ctx.fillRect(0, 0, width, height);

  const candles = state.candles;
  if (!candles.length) {
    ctx.fillStyle = '#aab7cc';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(state.candleError
      ? 'Data candle gagal dimuat: ' + state.candleError
      : 'Sedang memuat data XAUUSD…', width / 2, height / 2);
    return;
  }

  const axis = chart.axisW, timeHeight = chart.timeH;
  const drawWidth = Math.max(1, width - axis);
  const drawHeight = Math.max(1, height - timeHeight);
  const spacing = view.barSpacing;
  const visible = Math.ceil(drawWidth / spacing);
  const first = candles.length - visible - view.scrollOffset;
  const start = Math.max(0, Math.floor(first) - 1);
  const end = Math.min(candles.length, Math.floor(first) + visible + 2);
  let highest = -Infinity, lowest = Infinity;
  for (let i = start; i < end; i++) {
    highest = Math.max(highest, candles[i].h);
    lowest = Math.min(lowest, candles[i].l);
  }
  if (!Number.isFinite(highest) || !Number.isFinite(lowest)) return;

  const padding = (highest - lowest) * 0.08 || 1;
  const maxPrice = highest + padding, minPrice = lowest - padding;
  const priceRange = maxPrice - minPrice;
  const priceHeight = drawHeight;
  const y = price => (maxPrice - price) / priceRange * priceHeight;
  const x = index => (index - first) * spacing + spacing / 2;

  ctx.fillStyle = '#0f1729';
  ctx.fillRect(0, 0, drawWidth, drawHeight);
  // Draw support/resistance bands behind the candles.
  for (const zone of state.zones) {
    if (zone.high < minPrice || zone.low > maxPrice) continue;
    const topY=y(zone.high), bottomY=y(zone.low);
    const support=zone.type==='support';
    ctx.fillStyle=support?'rgba(38,166,154,0.10)':'rgba(239,83,80,0.10)';
    ctx.fillRect(0,topY,drawWidth,Math.max(2,bottomY-topY));
    ctx.strokeStyle=support?'rgba(38,166,154,0.62)':'rgba(239,83,80,0.62)';
    ctx.setLineDash([5,4]);
    ctx.beginPath();ctx.moveTo(0,y(zone.mid));ctx.lineTo(drawWidth,y(zone.mid));ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle=support?'#58cdbd':'#ff8585';
    ctx.font='bold 9px system-ui';ctx.textAlign='left';
    ctx.fillText((support?'S ':'R ')+zone.mid.toFixed(2)+' · '+zone.touches+'x',5,Math.max(10,topY-3));
  }
  ctx.strokeStyle = '#1c2941';
  ctx.fillStyle = '#aab7cc';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  for (let grid = 0; grid <= 5; grid++) {
    const price = minPrice + priceRange * grid / 5;
    const py = y(price);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(drawWidth, py);
    ctx.stroke();
    ctx.fillText(price.toFixed(2), drawWidth + 7, py);
  }

  for (let i = start; i < end; i++) {
    const candle = candles[i], px = x(i);
    const bullish = candle.c >= candle.o;
    const color = bullish ? '#26a69a' : '#ef5350';
    const bodyWidth = Math.max(1, spacing * 0.7);
    const openY = y(candle.o), closeY = y(candle.c);
    const top = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(closeY - openY));

    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(px, y(candle.h));
    ctx.lineTo(px, y(candle.l));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(px - bodyWidth / 2, top, bodyWidth, bodyHeight);


    const pattern = state.patterns.find(item => item.index === i);
    if (pattern) {
      const patternColor = pattern.name.includes('Bullish') ? '#26a69a'
        : pattern.name.includes('Bearish') ? '#ef5350' : '#eab308';
      ctx.fillStyle = patternColor;
      ctx.font = '9px system-ui';
      ctx.textAlign = 'center';
      const label = pattern.name.replace('Engulfing', 'Engulf')
        .replace(' Pin Bar', ' Pin').replace('Bullish', 'Bull')
        .replace('Bearish', 'Bear');
      ctx.fillText(label, px, pattern.name.includes('Bearish')
        ? Math.max(12, y(candle.h) - 14)
        : Math.min(priceHeight - 4, y(candle.l) + 14));
    }
  }

  if (state.tick && Number.isFinite(state.tick.mid)) {
    const priceY = y(state.tick.mid);
    if (priceY >= 0 && priceY <= priceHeight) {
      ctx.strokeStyle = '#2962ff';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, priceY);
      ctx.lineTo(drawWidth, priceY);
      ctx.stroke();
      ctx.setLineDash([]);
      drawTag(ctx, drawWidth + 36, priceY, state.tick.mid.toFixed(2), '#2962ff', '#fff');
    }
  }
  if (chart.hover) {
    ctx.strokeStyle = '#8b9bb477';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(chart.hover.x, 0);
    ctx.lineTo(chart.hover.x, drawHeight);
    ctx.moveTo(0, chart.hover.y);
    ctx.lineTo(drawWidth, chart.hover.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
function clampView() {
  const visible = Math.ceil(($('chart').clientWidth - chart.axisW) / view.barSpacing);
  view.scrollOffset = Math.max(-10,
    Math.min(Math.max(0, state.candles.length - visible), view.scrollOffset));
}
function pointerPosition(event) {
  const rect = $('chart').getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function bind() {
  $('log-filter').onchange=renderSignalLog;
  $('btn-export-log').onclick=exportSignalLog;
  $('log-history').addEventListener('click',event=>{
    const button=event.target.closest('[data-log-id]');
    if(!button) return;
    const id=decodeURIComponent(button.dataset.logId);
    const row=signalLog.find(item=>item.id===id);
    if(row) showLogSnapshot(row);
  });

  $('btn-alert-sound').onclick = () => {
    alertState.soundEnabled=!alertState.soundEnabled;
    if (alertState.soundEnabled) {
      try {
        const AudioCtx=window.AudioContext||window.webkitAudioContext;
        if (AudioCtx && !alertState.audioContext) alertState.audioContext=new AudioCtx();
        if (alertState.audioContext?.state==='suspended') alertState.audioContext.resume();
        $('btn-alert-sound').textContent='Bunyi: ON';
      } catch (_) { alertState.soundEnabled=false; $('btn-alert-sound').textContent='Bunyi: TIDAK SOKONG'; }
    } else $('btn-alert-sound').textContent='Bunyi: OFF';
    $('btn-alert-sound').setAttribute('aria-pressed',String(alertState.soundEnabled));
  };
  $('btn-alert-notify').onclick = async () => {
    if (!('Notification' in window)) {
      $('btn-alert-notify').textContent='Notifikasi: TIDAK SOKONG';
      return;
    }
    if (Notification.permission==='granted') {
      alertState.notifyEnabled=!alertState.notifyEnabled;
    } else if (Notification.permission!=='denied') {
      const permission=await Notification.requestPermission();
      alertState.notifyEnabled=permission==='granted';
    } else alertState.notifyEnabled=false;
    $('btn-alert-notify').textContent='Notifikasi: '+(alertState.notifyEnabled?'ON':'OFF');
    $('btn-alert-notify').setAttribute('aria-pressed',String(alertState.notifyEnabled));
  };

  $('btn-run-backtest').onclick=runAiBacktest;
  $('btn-run-scan').onclick=scanHistoricalSignals;
  $('scan-filter').onchange=renderHistoricalScan;
  $('btn-export-backtest').onclick=exportBacktestCsv;
  $('pr-filter-tf').onchange=renderPatternReview;
  $('pr-filter-outcome').onchange=renderPatternReview;
  $('pr-filter-side').onchange=renderPatternReview;
  $('btn-export-review').onclick=exportPatternReviewCsv;
  $('ac-threshold').onchange=()=>{if(lastAiAutoCompareContext)renderAiAutoCompare(lastAiAutoCompareContext);};
  $('pr-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-replay-id]');
    if(!button)return;
    openPatternReplay(decodeURIComponent(button.dataset.replayId));
  });
  $('btn-close-replay').onclick=closePatternReplay;
  $('btn-replay-prev').onclick=()=>stepPatternReplay(-1);
  $('btn-replay-next').onclick=()=>stepPatternReplay(1);
  $('replay-scrubber').oninput=event=>{stopAutoReplay();const target=Number(event.target.value);const delta=target-activeReplayStep;stepPatternReplay(delta);};
  $('btn-replay-auto').onclick=toggleAutoReplay;
  $('replay-speed').onchange=()=>{if(replayTimer!==null){stopAutoReplay();toggleAutoReplay();}};
  renderPatternReview();
  $('btn-load-history').onclick=loadHistoricalCandles;
  renderHistoryLoader();
  $('btn-export-backup').onclick=downloadGenjiBackup;
  $('btn-import-backup').onclick=()=>$('backup-file-input').click();
  $('backup-file-input').onchange=event=>importGenjiBackup(event.target.files?.[0]);
  renderBackupStats();
  $('btn-clear-performance').onclick = () => {
    if (!confirm('Padam semua rekod performance yang disimpan pada peranti ini?')) return;
    performanceRecords = [];
    savePerformanceRecords();
    renderPerformance();
    renderPatternMemory(null);
  };
  document.querySelectorAll('.analysis-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.analysis-tab').forEach(item => { item.classList.toggle('active',item===tab); item.setAttribute('aria-selected',item===tab?'true':'false'); });
    document.querySelectorAll('.analysis-pane').forEach(pane => pane.classList.toggle('active',pane.id==='tab-'+tab.dataset.tab));
  }));
  $('sel-interval').onchange = event => {
    state.interval = event.target.value;
    state.candles = loadCachedCandles(state.interval); state.patterns = []; state.zones = []; state.historyLoadedAt = null;
    if(state.candles.length){detectPatterns();calculateSupportResistance();updatePerformanceOutcomes();renderAll();}
    renderHistoryLoader();
    if (state.running) { stop(); start(); }
    else { fetchCandles().then(renderAll).catch(error => {
      state.candleError = error.message; renderAll();
    }); }
  };
  $('sel-eng-def').onchange = event => {
    state.engDef = event.target.value;
    detectPatterns();
    renderAll();
  };
  $('sel-poll').onchange = event => {
    state.pollMs = Number(event.target.value);
    if (state.running) { stop(); start(); }
  };
  $('sel-limit').onchange = event => {
    state.limit = Number(event.target.value);
    if (state.running) { stop(); start(); }
    else { fetchCandles().then(renderAll).catch(error => {
      state.candleError = error.message; renderAll();
    }); }
  };
  $('btn-start').onclick = start;
  $('btn-stop').onclick = stop;
  $('btn-realtime').onclick = () => {
    view.scrollOffset = -5;
    scheduleRender();
  };
  $('btn-reset').onclick = () => {
    view.barSpacing = 7;
    view.scrollOffset = -5;
    scheduleRender();
  };

  const canvas = $('chart');
  canvas.onpointerdown = event => {
    canvas.setPointerCapture(event.pointerId);
    chart.dragging = true;
    chart.dragStartX = pointerPosition(event).x;
    chart.dragStartOffset = view.scrollOffset;
  };
  canvas.onpointermove = event => {
    const point = pointerPosition(event);
    if (chart.dragging) {
      view.scrollOffset = chart.dragStartOffset +
        (point.x - chart.dragStartX) / view.barSpacing;
      clampView();
      scheduleRender();
    } else {
      const visible = Math.ceil((canvas.clientWidth - chart.axisW) / view.barSpacing);
      const first = state.candles.length - visible - view.scrollOffset;
      const index = Math.floor(first + point.x / view.barSpacing);
      chart.hover = { ...point, index: index >= 0 && index < state.candles.length ? index : null };
      updateHud();
      scheduleRender();
    }
  };
  canvas.onpointerup = canvas.onpointercancel = () => { chart.dragging = false; };
  canvas.onpointerleave = () => {
    if (!chart.dragging) {
      chart.hover = null;
      updateHud();
      scheduleRender();
    }
  };
  canvas.onwheel = event => {
    event.preventDefault();
    const point = pointerPosition(event);
    const oldSpacing = view.barSpacing;
    const visibleAnchor = state.candles.length -
      Math.ceil((canvas.clientWidth - chart.axisW) / oldSpacing) -
      view.scrollOffset + point.x / oldSpacing;
    view.barSpacing = Math.max(view.minBar,
      Math.min(view.maxBar, oldSpacing * (event.deltaY < 0 ? 1.15 : 0.87)));
    const newVisible = Math.ceil((canvas.clientWidth - chart.axisW) / view.barSpacing);
    view.scrollOffset = state.candles.length - newVisible -
      (visibleAnchor - point.x / view.barSpacing);
    clampView();
    scheduleRender();
  };
  canvas.ondblclick = () => $('btn-reset').click();
  if ('ResizeObserver' in window) new ResizeObserver(scheduleRender).observe(canvas);
  else window.addEventListener('resize', scheduleRender);
}

async function autoBoot(){
  try{
    bind();
    restoreCachedCandles();
    renderTopbar();renderChart();
    scanHistoricalSignals();
    $('history-load-status').textContent='AUTO';
    $('history-load-note').textContent='Auto Start: live dimulakan dahulu; sejarah dimuatkan di latar…';
    start();
    loadHistoricalCandles().then(()=>{
      updatePerformanceOutcomes();
      runAiBacktest();
      scanHistoricalSignals();
      $('history-load-note').textContent+=' Auto Start aktif; data sejarah dan live dikemas kini semasa dashboard dibuka.';
    }).catch(error=>{
      $('history-load-status').textContent='RALAT';
      $('history-load-note').textContent='Sejarah gagal dimuat: '+error.message+'. Sambungan live masih berjalan.';
    });
  }catch(error){
    console.error('GENJI Auto Start error:',error);
    const note=document.getElementById('history-load-note');
    if(note)note.textContent='Ralat Auto Start: '+error.message+'. Muat semula halaman.';
  }
}
autoBoot();
