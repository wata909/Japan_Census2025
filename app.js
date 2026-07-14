'use strict';

// ---- 指標定義 -------------------------------------------------------------
// scale: 'diverging' = 0 を中心に対称。減少→青、増加→黄（Viridis の両端）。
//        'sequential' = 分位ベースで Viridis 全域（低→青、高→黄）。
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

// ---- Viridis --------------------------------------------------------------
// 低（0）= 濃紺〜青紫、中間 = 緑、高（1）= 黄。
const VIRIDIS = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
];
const NO_DATA = '#d6dbe0';

function viridis(t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (VIRIDIS.length - 1);
  const i = Math.min(Math.floor(x), VIRIDIS.length - 2);
  const f = x - i;
  const a = VIRIDIS[i], b = VIRIDIS[i + 1];
  const c = [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function rampCss() {
  const stops = VIRIDIS.map((c, i) =>
    `rgb(${c[0]},${c[1]},${c[2]}) ${(i / (VIRIDIS.length - 1) * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

// ---- スケール -------------------------------------------------------------
function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// 指標ごとに、値 → 0..1 の正規化関数と凡例の目盛りを作る
function buildScale(metric, values) {
  const sorted = values.slice().sort((a, b) => a - b);

  if (metric.scale === 'diverging') {
    // 0 を中央（Viridis の中間＝緑）に固定。増減の分布は減少側に大きく偏るため、
    // 正負それぞれの側で分位に応じた階調を割り当てて色域を使い切る。
    const neg = sorted.filter(v => v < 0);
    const pos = sorted.filter(v => v > 0);
    const rank = (arr, v) => {  // arr 内で v 以下の割合（0..1）
      if (!arr.length) return 0;
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
      return lo / arr.length;
    };
    return {
      norm: v => {
        if (v < 0) return 0.5 * rank(neg, v);        // 減少が大きいほど 0 側（濃紺紫）
        if (v > 0) return 0.5 + 0.5 * rank(pos, v);  // 増加が大きいほど 1 側（黄）
        return 0.5;                                   // 増減なし = 中央の緑
      },
      ticks: [
        fmt(neg.length ? neg[0] : 0, metric.digits),
        fmt(neg.length ? quantile(neg, 0.5) : 0, metric.digits),
        '0',
        fmt(pos.length ? quantile(pos, 0.5) : 0, metric.digits),
        fmt(pos.length ? pos[pos.length - 1] : 0, metric.digits),
      ],
      note: `0（増減なし）が中央の緑。増加＝黄（${pos.length}団体）、減少＝青〜紫（${neg.length}団体）。`
          + '正負それぞれの側で分位に応じて階調を配分（目盛りは最小・中央値・0・中央値・最大）。',
    };
  }

  // 分位ベース：人口や密度は分布の歪みが大きいため、順位で色を割り当てる
  const breaks = [];
  for (let i = 0; i <= 10; i++) breaks.push(quantile(sorted, i / 10));
  return {
    norm: v => {
      // v が何番目の分位区間かを線形補間して 0..1 に
      for (let i = 0; i < 10; i++) {
        if (v <= breaks[i + 1]) {
          const span = breaks[i + 1] - breaks[i];
          const f = span > 0 ? (v - breaks[i]) / span : 0;
          return (i + f) / 10;
        }
      }
      return 1;
    },
    ticks: [0, 2.5, 5, 7.5, 10].map(i => fmt(quantile(sorted, i / 10), metric.digits)),
    note: '10分位で配色（各色に約189団体）。値が大きいほど黄、小さいほど青。',
  };
}

function fmt(v, digits) {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// ---- 地図 -----------------------------------------------------------------
const map = L.map('map', { preferCanvas: true, minZoom: 4, maxZoom: 12, zoomSnap: 0.25 });
// 沖縄本島〜北海道が収まる範囲に合わせる（小笠原・南鳥島はパンで参照）
const JAPAN_BOUNDS = L.latLngBounds([[26.0, 127.0], [45.8, 146.2]]);
map.fitBounds(JAPAN_BOUNDS, { paddingTopLeft: [320, 20], paddingBottomRight: [260, 20] });

L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>｜統計: 総務省統計局 令和7年国勢調査 人口速報集計｜境界: 国土数値情報 N03（2020年）',
  maxZoom: 12,
}).addTo(map);

let layer = null;
let scale = null;
let metric = METRICS[0];

const $ = id => document.getElementById(id);

function styleFor(feature) {
  const v = feature.properties[metric.id];
  const has = typeof v === 'number' && isFinite(v);
  return {
    fillColor: has ? viridis(scale.norm(v)) : NO_DATA,
    fillOpacity: 0.82,
    color: '#ffffff',
    weight: 0.3,
    opacity: 0.7,
  };
}

function renderLegend() {
  $('ramp').style.background = rampCss();
  $('ticks').innerHTML = scale.ticks
    .map(t => `<span>${t}</span>`).join('');
  $('legend-note').textContent = `単位：${metric.unit || '—'}。${scale.note}`;
}

function showInfo(p) {
  $('info-hint').hidden = true;
  $('info-body').hidden = false;
  $('i-name').textContent = p.name || '（データなし）';
  $('i-pref').textContent = p.pref || '';
  const v = p[metric.id];
  $('i-value').textContent = fmt(v, metric.digits);
  $('i-unit').textContent = (typeof v === 'number' && isFinite(v)) ? metric.unit : '';
  $('i-metric').textContent = metric.label;
  $('i-pop').textContent = fmt(p.pop_total, 0);
  $('i-pop20').textContent = fmt(p.pop_2020, 0);
  const c = p.pop_chg_pct;
  $('i-chg').textContent = (typeof c === 'number' && isFinite(c))
    ? `${c > 0 ? '+' : ''}${fmt(c, 2)} %` : '—';
  $('i-hh').textContent = fmt(p.hh_total, 0);
}

function clearInfo() {
  $('info-hint').hidden = false;
  $('info-body').hidden = true;
}

function onEachFeature(feature, lyr) {
  lyr.on({
    mouseover: e => {
      e.target.setStyle({ weight: 2, color: '#14181d', opacity: 1 });
      e.target.bringToFront();
      showInfo(feature.properties);
    },
    mouseout: e => {
      layer.resetStyle(e.target);
      clearInfo();
    },
  });
}

function repaint() {
  scale = buildScale(metric, collectValues(metric.id));
  renderLegend();
  layer.setStyle(styleFor);
}

let features = [];
function collectValues(id) {
  return features
    .map(f => f.properties[id])
    .filter(v => typeof v === 'number' && isFinite(v));
}

// ---- データ読み込み --------------------------------------------------------
async function load() {
  const t0 = performance.now();
  const res = await fetch('data/census2025_city.fgb');
  if (!res.ok) throw new Error(`FGB の取得に失敗: ${res.status}`);

  for await (const f of flatgeobuf.deserialize(res.body)) {
    features.push(f);
    if (features.length % 400 === 0) {
      $('status').textContent = `読み込み中… ${features.length} 件`;
    }
  }

  metric = METRICS[0];
  scale = buildScale(metric, collectValues(metric.id));
  layer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: styleFor,
    onEachFeature,
  }).addTo(map);
  renderLegend();

  const ms = Math.round(performance.now() - t0);
  $('status').textContent = `${features.length.toLocaleString('ja-JP')} 市区町村を表示（${ms} ms）`;
}

// ---- UI -------------------------------------------------------------------
const sel = $('metric');
sel.innerHTML = METRICS.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
sel.addEventListener('change', () => {
  metric = METRICS.find(m => m.id === sel.value);
  repaint();
});

load().catch(err => {
  $('status').textContent = `エラー: ${err.message}`;
  console.error(err);
});
