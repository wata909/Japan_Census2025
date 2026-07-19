'use strict';

// 大正9年(1920)行政区域＝旧市町村単位。令和2年(2020)国勢調査 小地域を空間割当して集計、2015→2020増減。
const METRICS = [
  { id: 'pop_chg_pct', label: '人口増減率（2015→2020）', unit: '%',   scale: 'diverging',  digits: 2 },
  { id: 'pop_chg',     label: '人口増減数（2015→2020）', unit: '人',  scale: 'diverging',  digits: 0 },
  { id: 'hh_chg_pct',  label: '世帯増減率（2015→2020）', unit: '%',   scale: 'diverging',  digits: 2 },
  { id: 'hh_chg',      label: '世帯増減数（2015→2020）', unit: '世帯', scale: 'diverging',  digits: 0 },
  { id: 'pop2020',     label: '人口（2020年）',          unit: '人',  scale: 'sequential', digits: 0 },
  { id: 'pop2015',     label: '人口（2015年）',          unit: '人',  scale: 'sequential', digits: 0 },
  { id: 'hh2020',      label: '世帯数（2020年）',        unit: '世帯', scale: 'sequential', digits: 0 },
  { id: 'hh2015',      label: '世帯数（2015年）',        unit: '世帯', scale: 'sequential', digits: 0 },
];

const VIRIDIS = [
  [68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],
  [31,158,137],[53,183,121],[109,205,89],[180,222,44],[253,231,37],
];
const NO_DATA = '#d6dbe0';
function viridis(t){ t=Math.max(0,Math.min(1,t)); const x=t*(VIRIDIS.length-1);
  const i=Math.min(Math.floor(x),VIRIDIS.length-2), f=x-i, a=VIRIDIS[i], b=VIRIDIS[i+1];
  const c=[0,1,2].map(k=>Math.round(a[k]+(b[k]-a[k])*f)); return `rgb(${c[0]},${c[1]},${c[2]})`; }
function rampCss(){ return `linear-gradient(to right, ${VIRIDIS.map((c,i)=>
  `rgb(${c[0]},${c[1]},${c[2]}) ${(i/(VIRIDIS.length-1)*100).toFixed(1)}%`).join(', ')})`; }
function quantile(s,p){ if(!s.length) return NaN; const idx=(s.length-1)*p, lo=Math.floor(idx), hi=Math.ceil(idx);
  return s[lo]+(s[hi]-s[lo])*(idx-lo); }
function fmt(v,d){ if(v==null||!isFinite(v)) return '—';
  return v.toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d}); }

let VALUES = {};
function buildStops(metric){
  const sorted = VALUES[metric.id] || [];
  const pairs = [];
  if (metric.scale === 'diverging') {
    const neg=sorted.filter(v=>v<0), pos=sorted.filter(v=>v>0);
    const rank=(arr,v)=>{ if(!arr.length) return 0; let lo=0,hi=arr.length;
      while(lo<hi){const m=(lo+hi)>>1; if(arr[m]<v) lo=m+1; else hi=m;} return lo/arr.length; };
    for(let i=0;i<=5;i++){ if(neg.length){ const q=quantile(neg,i/5); pairs.push([q,0.5*rank(neg,q)]); } }
    pairs.push([0,0.5]);
    for(let i=0;i<=5;i++){ if(pos.length){ const q=quantile(pos,i/5); pairs.push([q,0.5+0.5*rank(pos,q)]); } }
    return { pairs,
      ticks:[ fmt(neg.length?neg[0]:0,metric.digits), fmt(neg.length?quantile(neg,0.5):0,metric.digits),
              '0', fmt(pos.length?quantile(pos,0.5):0,metric.digits), fmt(pos.length?pos[pos.length-1]:0,metric.digits) ],
      note:`0（増減なし）が中央の緑。増加＝黄（${pos.length}単位）、減少＝青〜紫（${neg.length}単位）。正負それぞれの側で分位に応じて階調を配分。` };
  }
  for(let i=0;i<=10;i++) pairs.push([quantile(sorted,i/10), i/10]);
  return { pairs, ticks:[0,2.5,5,7.5,10].map(i=>fmt(quantile(sorted,i/10),metric.digits)),
    note:'10分位で配色。値が大きいほど黄、小さいほど青。' };
}
function fillExpression(metric){
  const {pairs}=buildStops(metric); const clean=[]; let prev=-Infinity;
  for(const [v,t] of pairs){ let val=v; if(!(val>prev)) val=prev+1e-6; clean.push([val,viridis(t)]); prev=val; }
  const interp=['interpolate',['linear'],['to-number',['get',metric.id]]];
  for(const [v,col] of clean) interp.push(v,col);
  return ['case',['has',metric.id],interp,NO_DATA];
}

const R2 = 'https://pub-c579cfd9d6374549b3cc48a71c02eaff.r2.dev';

// 都道府県ごとの設定（表示範囲・県名）。?pref=16 のように切替。
const PREFS = {
  '31': { name:'鳥取県', bounds:[[133.10,35.03],[134.53,35.63]] },
  '16': { name:'富山県', bounds:[[136.68,36.24],[137.85,37.02]] },
};
const PREF = (new URLSearchParams(location.search).get('pref') || '31');
const PCONF = PREFS[PREF] || PREFS['31'];

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);
const $ = id => document.getElementById(id);
let metric = METRICS[0];

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      gsi: { type:'raster', tiles:['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        tileSize:256, maxzoom:18,
        attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>｜統計: 総務省統計局 令和2年国勢調査 小地域｜集約単位: 国土数値情報 N03 大正9年(1920)' },
      kyu: { type:'vector', url:`pmtiles://${R2}/kyu_census2020_${PREF}.pmtiles`, promoteId:'kyu_id' },
    },
    layers: [
      { id:'gsi', type:'raster', source:'gsi' },
      { id:'choropleth', type:'fill', source:'kyu', 'source-layer':'kyu',
        paint:{ 'fill-color':NO_DATA, 'fill-opacity':0.82 } },
      { id:'hover-line', type:'line', source:'kyu', 'source-layer':'kyu',
        paint:{ 'line-color':'#14181d',
          'line-width':['case',['boolean',['feature-state','hover'],false],2,0] } },
    ],
  },
  center:[(PCONF.bounds[0][0]+PCONF.bounds[1][0])/2,(PCONF.bounds[0][1]+PCONF.bounds[1][1])/2],
  zoom:8, minZoom:6, maxZoom:13,
});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
const PREF_BOUNDS = PCONF.bounds;

function renderLegend(){
  const s=buildStops(metric); $('ramp').style.background=rampCss();
  $('ticks').innerHTML=s.ticks.map(t=>`<span>${t}</span>`).join('');
  $('legend-note').textContent=`単位：${metric.unit||'—'}。${s.note}`;
}
function repaint(){ map.setPaintProperty('choropleth','fill-color',fillExpression(metric)); renderLegend(); }

let hoveredId=null;
function setHover(id){
  if(hoveredId===id) return;
  if(hoveredId!==null) map.setFeatureState({source:'kyu',sourceLayer:'kyu',id:hoveredId},{hover:false});
  hoveredId=id;
  if(id!==null) map.setFeatureState({source:'kyu',sourceLayer:'kyu',id},{hover:true});
}
function num(p,k){ const v=p[k]; return (v===undefined||v===null||v==='')?null:Number(v); }
function showInfo(p){
  $('info-hint').hidden=true; $('info-body').hidden=false;
  const gun=p.gun||''; $('i-name').textContent=(p.name||'—');
  $('i-pref').textContent=gun?`${PCONF.name} ${gun}`:PCONF.name;
  const v=num(p,metric.id);
  $('i-value').textContent=fmt(v,metric.digits);
  $('i-unit').textContent=(v!=null&&isFinite(v))?metric.unit:'';
  $('i-metric').textContent=metric.label;
  $('i-pop20').textContent=fmt(num(p,'pop2020'),0);
  $('i-pop15').textContent=fmt(num(p,'pop2015'),0);
  const c=num(p,'pop_chg_pct');
  $('i-chg').textContent=(c!=null&&isFinite(c))?`${c>0?'+':''}${fmt(c,2)} %`:'—';
  $('i-hh').textContent=fmt(num(p,'hh2020'),0);
}
function clearInfo(){ $('info-hint').hidden=false; $('info-body').hidden=true; }

map.on('mousemove','choropleth',e=>{ if(!e.features.length) return;
  map.getCanvas().style.cursor='pointer'; const f=e.features[0]; setHover(f.id); showInfo(f.properties); });
map.on('mouseleave','choropleth',()=>{ map.getCanvas().style.cursor=''; setHover(null); clearInfo(); });

const sel=$('metric');
sel.innerHTML=METRICS.map(m=>`<option value="${m.id}">${m.label}</option>`).join('');
sel.addEventListener('change',()=>{ metric=METRICS.find(m=>m.id===sel.value); repaint(); });

async function init(){
  // 県名を見出しに反映
  document.title = `令和2年国勢調査 — 大正9年(1920)行政区域単位 人口増減（${PCONF.name}）`;
  const h1 = document.querySelector('#controls h1'); if(h1) h1.textContent = `令和2年国勢調査 人口増減（${PCONF.name}）`;
  VALUES = await (await fetch(`data/kyu_values_${PREF}.json`)).json();
  map.on('load',()=>{ map.fitBounds(PREF_BOUNDS,{padding:{top:20,left:330,right:260,bottom:20},duration:0}); repaint(); });
  map.on('idle',()=>{ $('status').textContent=`${PCONF.name}の旧市町村（大正9年）で表示・PMTiles/R2配信`; });
  map.on('error',e=>{ $('status').textContent='エラー: '+(e.error?.message||e.type); });
}
init();
