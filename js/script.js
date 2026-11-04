'use strict';

const state = {
  interval: '5m', pollMs: 10000, limit: 200, engDef: 'body',
  candles: [], tick: null, running: false, timer: null,
  candleError: null, tickError: null, patterns: []
};
const view = { barSpacing: 7, scrollOffset: -5, minBar: 2, maxBar: 40 };
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
    isOpen: Boolean(bar.isOpen)
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

    if (previous.c < previous.o && current.c > current.o &&
      (state.engDef === 'full'
        ? current.h >= previous.h && current.l <= previous.l
        : current.o <= previous.c && current.c >= previous.o)) {
      name = 'Bullish Engulfing';
    } else if (previous.c > previous.o && current.c < current.o &&
      (state.engDef === 'full'
        ? current.h >= previous.h && current.l <= previous.l
        : current.o >= previous.c && current.c <= previous.o)) {
      name = 'Bearish Engulfing';
    } else if (body / range <= 0.1) {
      name = 'Doji';
    } else if (lower >= body * 2 && upper <= body * 0.7) {
      name = 'Bullish Pin Bar';
    } else if (upper >= body * 2 && lower <= body * 0.7) {
      name = 'Bearish Pin Bar';
    }
    if (name) found.push({ index: i, name });
  }
  state.patterns = found;
}
async function tickOnce() {
  if (!state.running) return;
  const results = await Promise.allSettled([fetchCandles(), fetchTick()]);
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
