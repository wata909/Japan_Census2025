'use strict';

// ---- 指標定義（Leaflet版と同一） -----------------------------------------
const METRICS = [
  { id: 'pop_chg_pct', label: '5年間の人口増減率',      unit: '%',      scale: 'diverging',  digits: 2 },
  { id: 'pop_chg',     label: '5年間の人口増減数',      unit: '人',     scale: 'diverging',  digits: 0 },
  { id: 'hh_chg_pct',  label: '5年間の世帯増減率',      unit: '%',      scale: 'diverging',  digits: 2 },
  { id: 'hh_chg',      label: '5年間の世帯増減数',      unit: '世帯',   scale: 'diverging',  digits: 0 },
  { id: 'pop_total',   label: '人口（総数・2025年）',   unit: '人',     scale: 'sequential', digits: 0 },
  { id: 'pop_male',    label: '人口（男）',             unit: '人',     scale: 'sequential', digits: 0 },
  { id: 'pop_female',  label: '人口（女）',             unit: '人',     scale: 'sequential', digits: 0 },
  { id: 'pop_2020',    label: '人口（2020年・組替）',   unit: '人',     scale: 'sequential', digits: 0 },
  { id: 'pop_density', label: '人口密度',               unit: '人/km²', scale: 'sequential', digits: 1 },
  { id: 'sex_ratio',   label: '人口性比（女100人当たり男）', unit: '', scale: 'sequential', digits: 1 },
  { id: 'area_km2',    label: '面積',                   unit: 'km²',    scale: 'sequential', digits: 2 },
  { id: 'hh_total',    label: '世帯数（2025年）',       unit: '世帯',   scale: 'sequential', digits: 0 },
  { id: 'hh_2020',     label: '世帯数（2020年・組替）', unit: '世帯',   scale: 'sequential', digits: 0 },
];

const VIRIDIS = [
  [68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],
  [31,158,137],[53,183,121],[109,205,89],[180,222,44],[253,231,37],
];
const NO_DATA = '#d6dbe0';

function viridis(t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (VIRIDIS.length - 1);
  const i = Math.min(Math.floor(x), VIRIDIS.length - 2);
  const f = x - i, a = VIRIDIS[i], b = VIRIDIS[i + 1];
  const c = [0,1,2].map(k => Math.round(a[k] + (b[k]-a[k])*f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function rampCss() {
  return `linear-gradient(to right, ${VIRIDIS.map((c,i)=>
    `rgb(${c[0]},${c[1]},${c[2]}) ${(i/(VIRIDIS.length-1)*100).toFixed(1)}%`).join(', ')})`;
}
function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length-1)*p, lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi]-sorted[lo])*(idx-lo);
}
function fmt(v, digits) {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// ---- スケール → MapLibre の色式 -------------------------------------------
let VALUES = {};   // metricId -> sorted number[]

// interpolate 用に (値, 色) の組を昇順・狭義単調で作る
function buildStops(metric) {
  const sorted = VALUES[metric.id] || [];
  const pairs = [];  // [value, t]
  if (metric.scale === 'diverging') {
    const neg = sorted.filter(v => v < 0), pos = sorted.filter(v => v > 0);
    const rank = (arr, v) => {
      if (!arr.length) return 0; let lo=0, hi=arr.length;
      while (lo<hi){const m=(lo+hi)>>1; if(arr[m]<v) lo=m+1; else hi=m;} return lo/arr.length;
    };
    // 負側・0・正側から代表点をサンプルし t を割り当て
    for (let i=0;i<=5;i++){ if(neg.length){ const q=quantile(neg,i/5); pairs.push([q, 0.5*rank(neg,q)]); } }
    pairs.push([0, 0.5]);
    for (let i=0;i<=5;i++){ if(pos.length){ const q=quantile(pos,i/5); pairs.push([q, 0.5+0.5*rank(pos,q)]); } }
    return {
      pairs,
      ticks: [ fmt(neg.length?neg[0]:0,metric.digits), fmt(neg.length?quantile(neg,0.5):0,metric.digits),
               '0', fmt(pos.length?quantile(pos,0.5):0,metric.digits), fmt(pos.length?pos[pos.length-1]:0,metric.digits) ],
      note: `0（増減なし）が中央の緑。増加＝黄（${pos.length}団体）、減少＝青〜紫（${neg.length}団体）。`
          + '正負それぞれの側で分位に応じて階調を配分。',
    };
  }
  for (let i=0;i<=10;i++) pairs.push([quantile(sorted, i/10), i/10]);
  return {
    pairs,
    ticks: [0,2.5,5,7.5,10].map(i => fmt(quantile(sorted,i/10), metric.digits)),
    note: '10分位で配色。値が大きいほど黄、小さいほど青。',
  };
}

// pairs（昇順・狭義単調に整える）→ MapLibre interpolate 式
function fillExpression(metric) {
  const { pairs } = buildStops(metric);
  const clean = [];
  let prev = -Infinity;
  for (const [v, t] of pairs) {
    let val = v;
    if (!(val > prev)) val = prev + 1e-6;   // 狭義単調を保証
    clean.push([val, viridis(t)]);
    prev = val;
  }
  const interp = ['interpolate', ['linear'], ['to-number', ['get', metric.id]]];
  for (const [v, col] of clean) interp.push(v, col);
  // 値が無い（北方領土など）→ グレー
  return ['case', ['has', metric.id], interp, NO_DATA];
}

// ---- 地図 -----------------------------------------------------------------
// PMTiles 配信元（Cloudflare R2 公開バケット）
const R2 = 'https://pub-c579cfd9d6374549b3cc48a71c02eaff.r2.dev';

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const $ = id => document.getElementById(id);
let metric = METRICS[0];

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      gsi: {
        type: 'raster',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        tileSize: 256, maxzoom: 18,
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>｜統計: 総務省統計局 令和7年国勢調査 人口速報集計｜境界: 国土数値情報 N03（2020年）',
      },
      // PMTiles は HTTP Range が必須。GitHub Pages は Range 非対応のため、
      // Cloudflare R2 の公開バケットから配信する（S24プロジェクトと同じ運用）。
      census: { type: 'vector', url: `pmtiles://${R2}/census2025_city.pmtiles`, promoteId: 'code' },
    },
    layers: [
      { id: 'gsi', type: 'raster', source: 'gsi' },
      // 塗り（境界線なし＝面のみ）。ベクトルタイルなので隣接面に隙間は出ない。
      { id: 'choropleth', type: 'fill', source: 'census', 'source-layer': 'census',
        paint: { 'fill-color': NO_DATA, 'fill-opacity': 0.82 } },
      // ホバー時のみ境界を光らせる（feature-state）
      { id: 'hover-line', type: 'line', source: 'census', 'source-layer': 'census',
        paint: { 'line-color': '#14181d',
          'line-width': ['case', ['boolean', ['feature-state','hover'], false], 2, 0] } },
    ],
  },
  center: [137.0, 38.2],
  zoom: 4.2,
  minZoom: 4, maxZoom: 12,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

const JAPAN_BOUNDS = [[127.0, 26.0], [146.2, 45.8]];

function renderLegend() {
  const s = buildStops(metric);
  $('ramp').style.background = rampCss();
  $('ticks').innerHTML = s.ticks.map(t => `<span>${t}</span>`).join('');
  $('legend-note').textContent = `単位：${metric.unit || '—'}。${s.note}`;
}

function repaint() {
  map.setPaintProperty('choropleth', 'fill-color', fillExpression(metric));
  renderLegend();
}

// ---- 情報パネル & ホバー ---------------------------------------------------
let hoveredId = null;
function setHover(id) {
  if (hoveredId === id) return;
  if (hoveredId !== null)
    map.setFeatureState({ source:'census', sourceLayer:'census', id: hoveredId }, { hover:false });
  hoveredId = id;
  if (id !== null)
    map.setFeatureState({ source:'census', sourceLayer:'census', id }, { hover:true });
}
function showInfo(p) {
  $('info-hint').hidden = true; $('info-body').hidden = false;
  $('i-name').textContent = p.name || '（データなし）';
  $('i-pref').textContent = p.pref || '';
  const raw = p[metric.id];
  const v = (raw === undefined || raw === null || raw === '') ? null : Number(raw);
  $('i-value').textContent = fmt(v, metric.digits);
  $('i-unit').textContent = (v!=null && isFinite(v)) ? metric.unit : '';
  $('i-metric').textContent = metric.label;
  const num = k => (p[k]===undefined||p[k]===null||p[k]==='') ? null : Number(p[k]);
  $('i-pop').textContent = fmt(num('pop_total'), 0);
  $('i-pop20').textContent = fmt(num('pop_2020'), 0);
  const c = num('pop_chg_pct');
  $('i-chg').textContent = (c!=null && isFinite(c)) ? `${c>0?'+':''}${fmt(c,2)} %` : '—';
  $('i-hh').textContent = fmt(num('hh_total'), 0);
}
function clearInfo() { $('info-hint').hidden = false; $('info-body').hidden = true; }

map.on('mousemove', 'choropleth', e => {
  if (!e.features.length) return;
  map.getCanvas().style.cursor = 'pointer';
  const f = e.features[0];
  setHover(f.id);
  showInfo(f.properties);
});
map.on('mouseleave', 'choropleth', () => {
  map.getCanvas().style.cursor = '';
  setHover(null); clearInfo();
});

// ---- 初期化 ---------------------------------------------------------------
const sel = $('metric');
sel.innerHTML = METRICS.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
sel.addEventListener('change', () => { metric = METRICS.find(m => m.id === sel.value); repaint(); });

async function init() {
  VALUES = await (await fetch('data/values.json')).json();
  map.on('load', () => {
    map.fitBounds(JAPAN_BOUNDS, { padding: { top:20, left:320, right:260, bottom:20 }, duration:0 });
    repaint();
  });
  map.on('idle', () => { $('status').textContent = '1,890 市区町村を表示（PMTilesベクトルタイル）'; });
  map.on('error', e => { $('status').textContent = 'エラー: ' + (e.error?.message || e.type); });
}
init();
