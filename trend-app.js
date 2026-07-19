'use strict';

// 5年ごとの期間（フィールド名は build_all.py の rate_XX_YY と対応）
const PERIODS = [
  { id:'rate_00_05', a:'2000', b:'2005', label:'2000→2005' },
  { id:'rate_05_10', a:'2005', b:'2010', label:'2005→2010' },
  { id:'rate_10_15', a:'2010', b:'2015', label:'2010→2015' },
  { id:'rate_15_20', a:'2015', b:'2020', label:'2015→2020' },
];
const YEARS = ['2000','2005','2010','2015','2020'];

// Viridis（低=青紫→中=緑→高=黄）
const VIRIDIS = [[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],
  [31,158,137],[53,183,121],[109,205,89],[180,222,44],[253,231,37]];
const NO_DATA = '#d6dbe0';
function viridis(t){ t=Math.max(0,Math.min(1,t)); const x=t*(VIRIDIS.length-1);
  const i=Math.min(Math.floor(x),VIRIDIS.length-2), f=x-i, a=VIRIDIS[i], b=VIRIDIS[i+1];
  const c=[0,1,2].map(k=>Math.round(a[k]+(b[k]-a[k])*f)); return `rgb(${c[0]},${c[1]},${c[2]})`; }

// 5%刻みの離散クラス（−20〜+20%）。境界9本→10クラス。外側は頭打ち。
const BREAKS = [-20,-15,-10,-5,0,5,10,15,20];      // クラス境界
const NCLASS = BREAKS.length + 1;                   // 10クラス
const CLASS_COLORS = Array.from({length:NCLASS}, (_,i)=>viridis(i/(NCLASS-1)));
function classIndex(v){ let i=0; for(const b of BREAKS){ if(v>=b) i++; else break; } return i; }
function colorFor(v){ if(v==null||!isFinite(v)) return NO_DATA; return CLASS_COLORS[classIndex(v)]; }
// MapLibre 用の step 式（離散）。has判定でグレー。
function fillExpression(id){
  const step=['step',['to-number',['get',id]], CLASS_COLORS[0]];
  BREAKS.forEach((b,i)=>{ step.push(b, CLASS_COLORS[i+1]); });
  return ['case',['has',id],step,NO_DATA];
}
function fmt(v,d=0){ if(v==null||!isFinite(v)) return '—';
  return v.toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function pct(v){ return (v==null||!isFinite(v))?'—':`${v>0?'+':''}${v.toFixed(2)}%`; }

const R2 = 'https://pub-c579cfd9d6374549b3cc48a71c02eaff.r2.dev';
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);
const $ = id => document.getElementById(id);

let map, PREF, PCONF, period = PERIODS[3], hoveredId = null;

function renderLegend(){
  // 10クラスの色ブロック
  $('ramp').innerHTML = CLASS_COLORS.map(c=>`<span style="background:${c}"></span>`).join('');
  // 各クラスの上限境界を右寄せ（最終クラスは以上）
  const labels = BREAKS.map(b=>`${b>0?'+':''}${b}`).concat(['']);
  $('ticks').innerHTML = labels.map(t=>`<span>${t}</span>`).join('');
}

function repaint(){
  map.setPaintProperty('choropleth','fill-color', fillExpression(period.id));
  document.querySelectorAll('#periods button').forEach(btn=>
    btn.classList.toggle('active', btn.dataset.id===period.id));
}

function setHover(id){
  if(hoveredId===id) return;
  if(hoveredId!==null) map.setFeatureState({source:'kyu',sourceLayer:'kyu',id:hoveredId},{hover:false});
  hoveredId=id;
  if(id!==null) map.setFeatureState({source:'kyu',sourceLayer:'kyu',id},{hover:true});
}

// 経年変化：4期間の増減率を棒グラフ（±5%基準線つき）＋人口テーブル
function drawChart(p){
  const rates = PERIODS.map(pp=>{ const v=p[pp.id]; return (v==null||v==='')?null:Number(v); });
  const W=300,H=150, padL=8,padR=8,padT=10,padB=26, bw=(W-padL-padR)/PERIODS.length;
  const CLAMP=20;
  const scale = v => { const c=Math.max(-CLAMP,Math.min(CLAMP,v)); return (H-padB)/2 - c/CLAMP*((H-padB)/2 - padT); };
  const zeroY=(H-padB)/2;
  let s=`<line x1="${padL}" y1="${zeroY}" x2="${W-padR}" y2="${zeroY}" stroke="#c8ccd2" stroke-width="1"/>`;
  // ±10%・±20%の基準線
  [-20,-10,10,20].forEach(g=>{ const y=scale(g);
    s+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#eceef1" stroke-width="1" stroke-dasharray="3 3"/>`;
    s+=`<text x="${W-padR}" y="${y-2}" font-size="8" fill="#adb4bd" text-anchor="end">${g>0?'+':''}${g}%</text>`; });
  rates.forEach((v,i)=>{
    const x=padL+i*bw+bw*0.18, w=bw*0.64;
    if(v==null){ s+=`<text x="${x+w/2}" y="${zeroY}" font-size="9" fill="#adb4bd" text-anchor="middle">–</text>`; }
    else { const y=scale(v), h=Math.abs(y-zeroY);
      s+=`<rect x="${x}" y="${Math.min(y,zeroY)}" width="${w}" height="${Math.max(h,1)}" rx="1.5" fill="${colorFor(v)}"/>`;
      s+=`<text x="${x+w/2}" y="${v>=0?y-3:y+9}" font-size="8" fill="#5a6570" text-anchor="middle">${v.toFixed(1)}</text>`; }
    s+=`<text x="${padL+i*bw+bw/2}" y="${H-14}" font-size="8" fill="#7b8794" text-anchor="middle">${PERIODS[i].a.slice(2)}→${PERIODS[i].b.slice(2)}</text>`;
  });
  s+=`<text x="${padL}" y="${H-3}" font-size="8.5" fill="#7b8794">5年ごとの人口増減率 %</text>`;
  $('chart').innerHTML=s;

  // 人口テーブル（各年）
  let rows = YEARS.map((y,i)=>{
    const pop=p['pop'+y]; const r=(i===0)?null:rates[i-1];
    return `<tr><td>${y}</td><td>${fmt(pop==null?null:Number(pop))}</td><td>${i===0?'—':pct(r)}</td></tr>`;
  }).join('');
  $('ptbody').innerHTML=rows;
}

function showUnit(p){
  $('ts-empty').hidden=true; $('ts-body').hidden=false;
  $('u-name').textContent = p.name || '—';
  $('u-gun').textContent = (PCONF.name) + (p.gun? ' '+p.gun : '');
  drawChart(p);
}

async function init(){
  const PREFS = await (await fetch('data/kyu_prefs.json')).json();
  PREF = new URLSearchParams(location.search).get('pref');
  if(!PREFS[PREF]) PREF = PREFS['31'] ? '31' : Object.keys(PREFS).sort()[0];
  PCONF = PREFS[PREF];

  const psel=$('pref');
  psel.innerHTML=Object.keys(PREFS).sort().map(c=>`<option value="${c}"${c===PREF?' selected':''}>${PREFS[c].name}</option>`).join('');
  psel.addEventListener('change',()=>{ location.search='?pref='+psel.value; });

  const pdiv=$('periods');
  pdiv.innerHTML=PERIODS.map(pp=>`<button data-id="${pp.id}">${pp.label}</button>`).join('');
  pdiv.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{
    period=PERIODS.find(pp=>pp.id===btn.dataset.id); repaint(); }));

  renderLegend();
  document.title=`人口減少率の経年変化 — ${PCONF.name}（旧市町村単位）`;

  const bb=PCONF.bounds;
  map=new maplibregl.Map({ container:'map',
    style:{ version:8,
      sources:{
        gsi:{ type:'raster', tiles:['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
          tileSize:256, maxzoom:18,
          attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>｜統計: 総務省統計局 国勢調査 小地域(2000〜2020)｜集約単位: 国土数値情報 N03 大正9年(1920)' },
        kyu:{ type:'vector', url:`pmtiles://${R2}/kyu_census2020_${PREF}.pmtiles`, promoteId:'kyu_id' },
      },
      layers:[
        { id:'gsi', type:'raster', source:'gsi' },
        { id:'choropleth', type:'fill', source:'kyu', 'source-layer':'kyu',
          paint:{ 'fill-color':NO_DATA, 'fill-opacity':0.82 } },
        { id:'hover-line', type:'line', source:'kyu', 'source-layer':'kyu',
          paint:{ 'line-color':'#14181d', 'line-width':['case',['boolean',['feature-state','hover'],false],2,0] } },
      ],
    },
    center:[(bb[0][0]+bb[1][0])/2,(bb[0][1]+bb[1][1])/2], zoom:8, minZoom:5, maxZoom:13,
  });
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');

  map.on('mousemove','choropleth',e=>{ if(!e.features.length) return;
    map.getCanvas().style.cursor='pointer'; const f=e.features[0]; setHover(f.id); showUnit(f.properties); });
  map.on('mouseleave','choropleth',()=>{ map.getCanvas().style.cursor=''; setHover(null); });
  map.on('load',()=>{ map.fitBounds(bb,{padding:20,duration:0}); repaint(); });
  map.on('idle',()=>{ $('status').textContent=`${PCONF.name}の旧市町村（大正9年）・${PERIODS.length}期間 ｜ PMTiles/R2配信`; });
  map.on('error',e=>{ $('status').textContent='エラー: '+(e.error?.message||e.type); });
}
init();
