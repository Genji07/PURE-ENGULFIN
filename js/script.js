'use strict';

const state = {
  interval: '5m', pollMs: 10000, limit: 200, engDef: 'both',
  candles: [], tick: null, running: false, timer: null,
  candleError: null, tickError: null, patterns: [], zones: [], trendH1: null, trendM15: null, trendError: null
};
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
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}
async function fetchCandles() {
  const url = 'https://biquote.io/api/XAUUSD/ohlc?interval=' +
    encodeURIComponent(state.interval) + '&limit=' + state.limit;
  const data = await getJson(url);
  const bars = Array.isArray(data) ? data : data.bars;
  if (!Array.isArray(bars)) throw new Error('Format OHLC tidak dikenali');

  const parsed = bars.map(bar => ({
    t: unixTime(bar.openTime ?? bar.time ?? bar.t ?? bar.timestamp),
    o: Number(bar.open ?? bar.o),
    h: Number(bar.high ?? bar.h),
    l: Number(bar.low ?? bar.l),
    c: Number(bar.close ?? bar.c),
    v: Number(bar.tickVolume ?? bar.volume ?? 0),
    isOpen: bar.isOpen === true, isClosed: bar.isClosed === true, hasOpenFlag: typeof bar.isOpen === 'boolean', hasClosedFlag: typeof bar.isClosed === 'boolean'
  })).filter(c =>
    Number.isFinite(c.t) &&
    [c.o, c.h, c.l, c.c].every(Number.isFinite) &&
    c.h >= Math.max(c.o, c.c, c.l) &&
    c.l <= Math.min(c.o, c.c, c.h)
  ).sort((a, b) => a.t - b.t);

  const unique = [];
  for (const candle of parsed) {
    if (!unique.length || candle.t > unique[unique.length - 1].t) unique.push(candle);
    else if (candle.t === unique[unique.length - 1].t) unique[unique.length - 1] = candle;
  }
  if (!unique.length) throw new Error('API tiada candle sah');
  state.candles = unique;
  detectPatterns();
  calculateSupportResistance();
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
  try {
    const [h1,m15] = await Promise.all([fetchTrendTimeframe('1h'),fetchTrendTimeframe('15m')]);
    state.trendH1 = getTrend(h1,'1h');
    state.trendM15 = getTrend(m15,'15m');
    state.trendError = null;
  } catch (error) {
    state.trendH1 = state.trendM15 = {label:'DATA TAK ADA',direction:'unknown'};
    state.trendError = error.message;
  }
}
async function fetchTick() {
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
async function tickOnce() {
  if (!state.running) return;
  const results = await Promise.allSettled([fetchCandles(), fetchTick(), fetchTrend()]);
  state.candleError = results[0].status === 'rejected' ? results[0].reason.message : null;
  state.tickError = results[1].status === 'rejected' ? results[1].reason.message : null;
  renderAll();
  if (state.running) state.timer = setTimeout(tickOnce, state.pollMs);
}
function start() {
  if (state.running) return;
  state.running = true;
  $('btn-start').disabled = true;
  $('btn-stop').disabled = false;
  tickOnce();
}
function stop() {
  state.running = false;
  clearTimeout(state.timer);
  state.timer = null;
  $('btn-start').disabled = false;
  $('btn-stop').disabled = true;
  renderTopbar();
}
function renderTopbar() {
  const dot = $('conn-dot');
  dot.className = 'live-dot' + (state.candleError ? ' err' : state.running ? ' on' : '');
  let message = state.candleError
    ? 'RALAT DATA: ' + state.candleError
    : state.running ? 'LIVE · ' + state.interval + ' · ' + state.pollMs / 1000 + 's'
    : 'Berhenti';
  if (state.tickError && !state.candleError) message += ' · Harga live tidak tersedia';
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
function renderAll() {
  renderTopbar();
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
function renderAnalysis() {
  const candles = state.candles;
  const closedIndex = candles.map((c,i)=>isClosedCandle(c,state.interval)?i:-1).filter(i=>i>=0).pop();
  const candle = closedIndex == null ? null : candles[closedIndex];
  const pattern = closedIndex == null ? null : state.patterns.find(p=>p.index===closedIndex);
  const h1 = state.trendH1, m15 = state.trendM15;
  const patternSide = pattern?.name.includes('Bullish') ? 'bull' : pattern?.name.includes('Bearish') ? 'bear' : null;
  const body = candle ? Math.abs(candle.c-candle.o) : 0;
  const range = candle ? Math.max(candle.h-candle.l,1e-8) : 1;
  const bodyRatio = body/range;
  const bodyStrong = bodyRatio >= 0.5;
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
  else if (!pattern) reasons.push({ok:false,text:'Tiada engulfing pada candle tertutup terakhir. Sistem tidak mengeluarkan signal.'});
  else {
    reasons.push({ok:true,text:pattern.name+' ('+pattern.type+') dikesan pada candle tertutup terakhir.'});
    reasons.push({ok:bodyStrong,text:'Kekuatan body '+(bodyRatio*100).toFixed(0)+'% daripada range candle ('+(bodyStrong?'memadai':'agak kecil')+').' });
    reasons.push({ok:!!h1 && h1.direction===patternSide,text:'Trend H1: '+(h1?.label||'BELUM ADA')+'.'});
    reasons.push({ok:!!m15 && m15.direction===patternSide,text:'Trend M15: '+(m15?.label||'BELUM ADA')+'.'});
    if (patternSide==='bull') reasons.push({ok:!!supportRejection,text:zoneContext||'Tiada rejection support yang jelas; semak kedudukan zon support.'});
    if (patternSide==='bear') reasons.push({ok:!!resistanceRejection,text:zoneContext||'Tiada rejection resistance yang jelas; semak kedudukan zon resistance.'});
    if (trendOK && bodyStrong) {
      signal=patternSide==='bull'?'BUY':'SELL';
      detail='Engulfing, candle tertutup, body dan trend H1/M15 searah. Signal teknikal disahkan.';
    } else {
      detail='Pattern dikesan tetapi syarat confirmation belum lengkap. Kekalkan WAIT.';
    }
  }
  $('a-pattern').textContent=pattern?pattern.name:'TIADA';
  $('a-type').textContent=pattern?.type || (state.engDef==='both'?'BODY + FULL':state.engDef==='body'?'PURE BODY':'FULL CANDLE');
  $('a-h1').textContent=h1?.label||'MENUNGGU';
  $('a-m15').textContent=m15?.label||'MENUNGGU';
  $('a-candle').textContent=candle?'CLOSED':'MENUNGGU';
  $('a-body').textContent=candle?(bodyRatio*100).toFixed(0)+'%':'—';
  renderZones();
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
  const priceHeight = drawHeight * (1 - chart.volPct);
  const volumeHeight = drawHeight - priceHeight;
  const y = price => (maxPrice - price) / priceRange * priceHeight;
  const x = index => (index - first) * spacing + spacing / 2;

  ctx.fillStyle = '#0f1729';
  ctx.fillRect(0, 0, drawWidth, drawHeight);
  ctx.fillStyle = '#0c1322';
  ctx.fillRect(0, priceHeight, drawWidth, volumeHeight);
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

  let maxVolume = 1;
  for (let i = start; i < end; i++) maxVolume = Math.max(maxVolume, candles[i].v || 0);
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

    if (candle.v > 0) {
      const barHeight = candle.v / maxVolume * volumeHeight;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(px - bodyWidth / 2, priceHeight + volumeHeight - barHeight,
        bodyWidth, barHeight);
      ctx.globalAlpha = 1;
    }

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

bind();
renderTopbar();
renderChart();
start();
