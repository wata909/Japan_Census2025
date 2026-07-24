'use strict';

// 5年ごとの期間（フィールド名は build_all.py の rate_XX_YY と対応）
const PERIODS = [
  { id:'rate_00_05', a:'2000', b:'2005', label:'2000→2005' },
  { id:'rate_05_10', a:'2005', b:'2010', label:'2005→2010' },
  { id:'rate_10_15', a:'2010', b:'2015', label:'2010→2015' },
  { id:'rate_15_20', a:'2015', b:'2020', label:'2015→2020' },
  { id:'total_00_20', a:'2000', b:'2020', label:'2000→2020(通算)', total:true },
];
const YEARS = ['2000','2005','2010','2015','2020'];

// Viridis（低=青紫→中=緑→高=黄）
const VIRIDIS = [[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],
  [31,158,137],[53,183,121],[109,205,89],[180,222,44],[253,231,37]];
const NO_DATA = '#d6dbe0';
function viridis(t){ t=Math.max(0,Math.min(1,t)); const x=t*(VIRIDIS.length-1);
  const i=Math.min(Math.floor(x),VIRIDIS.length-2), f=x-i, a=VIRIDIS[i], b=VIRIDIS[i+1];
  const c=[0,1,2].map(k=>Math.round(a[k]+(b[k]-a[k])*f)); return `rgb(${c[0]},${c[1]},${c[2]})`; }

// 5年ごと：5%刻みの離散クラス（−25〜+25%）。境界11本→12クラス。外側は頭打ち。
const BREAKS_SEQ = [-25,-20,-15,-10,-5,0,5,10,15,20,25];
const NCLASS_SEQ = BREAKS_SEQ.length + 1;           // 12クラス
const CLASS_COLORS_SEQ = Array.from({length:NCLASS_SEQ}, (_,i)=>viridis(i/(NCLASS_SEQ-1)));
// 通算(2000→2020)：10%刻みの離散クラス（−50〜+50%）。境界11本→12クラス。外側は頭打ち。
const BREAKS_TOTAL = [-50,-40,-30,-20,-10,0,10,20,30,40,50];
const NCLASS_TOTAL = BREAKS_TOTAL.length + 1;       // 12クラス
const CLASS_COLORS_TOTAL = Array.from({length:NCLASS_TOTAL}, (_,i)=>viridis(i/(NCLASS_TOTAL-1)));
function scaleFor(pp){ return (pp&&pp.total) ? {breaks:BREAKS_TOTAL,colors:CLASS_COLORS_TOTAL} : {breaks:BREAKS_SEQ,colors:CLASS_COLORS_SEQ}; }
function classIndex(v, breaks){ let i=0; for(const b of breaks){ if(v>=b) i++; else break; } return i; }
function colorFor(v, pp){ if(v==null||!isFinite(v)) return NO_DATA;
  const {breaks,colors}=scaleFor(pp); return colors[classIndex(v,breaks)]; }
// MapLibre 用の step 式（離散）。has判定でグレー。
// total_00_20 は事前集計フィールドを持たないため、pop2000/pop2020 から式内で算出する。
function fillExpression(pp){
  const {breaks,colors} = scaleFor(pp);
  if(pp.total){
    const pct=['*',['/',['-',['to-number',['get','pop2020']],['to-number',['get','pop2000']]],
      ['to-number',['get','pop2000']]],100];
    const step=['step',pct, colors[0]];
    breaks.forEach((b,i)=>{ step.push(b, colors[i+1]); });
    return ['case',['all',['has','pop2000'],['has','pop2020'],['>',['to-number',['get','pop2000']],0]],step,NO_DATA];
  }
  const step=['step',['to-number',['get',pp.id]], colors[0]];
  breaks.forEach((b,i)=>{ step.push(b, colors[i+1]); });
  return ['case',['has',pp.id],step,NO_DATA];
}
// 単位1件分の増減率（%）を取得。total_00_20 は pop2000/pop2020 から算出。
function getRate(p, pp){
  if(pp.total){
    const p0=Number(p.pop2000), p1=Number(p.pop2020);
    if(!(p0>0) || !isFinite(p1)) return null;
    return (p1-p0)/p0*100;
  }
  const v=p[pp.id];
  return (v==null||v==='')?null:Number(v);
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
  // 5年ごと（5%刻み）
  $('ramp-seq').innerHTML = CLASS_COLORS_SEQ.map(c=>`<span style="background:${c}"></span>`).join('');
  $('ticks-seq').innerHTML = BREAKS_SEQ.map(b=>`${b>0?'+':''}${b}`).concat(['']).map(t=>`<span>${t}</span>`).join('');
  // 通算2000→2020（10%刻み）
  $('ramp-total').innerHTML = CLASS_COLORS_TOTAL.map(c=>`<span style="background:${c}"></span>`).join('');
  $('ticks-total').innerHTML = BREAKS_TOTAL.map(b=>`${b>0?'+':''}${b}`).concat(['']).map(t=>`<span>${t}</span>`).join('');
}

function repaint(){
  map.setPaintProperty('choropleth','fill-color', fillExpression(period));
  document.querySelectorAll('.periods button').forEach(btn=>
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
  const rates = PERIODS.map(pp=>getRate(p,pp));
  const W=300,H=150, padL=8,padR=8,padT=10,padB=26, bw=(W-padL-padR)/PERIODS.length;
  const CLAMP=50;
  const scale = v => { const c=Math.max(-CLAMP,Math.min(CLAMP,v)); return (H-padB)/2 - c/CLAMP*((H-padB)/2 - padT); };
  const zeroY=(H-padB)/2;
  let s=`<line x1="${padL}" y1="${zeroY}" x2="${W-padR}" y2="${zeroY}" stroke="#c8ccd2" stroke-width="1"/>`;
  // ±25%・±50%の基準線
  [-50,-25,25,50].forEach(g=>{ const y=scale(g);
    s+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#eceef1" stroke-width="1" stroke-dasharray="3 3"/>`;
    s+=`<text x="${W-padR}" y="${y-2}" font-size="8" fill="#adb4bd" text-anchor="end">${g>0?'+':''}${g}%</text>`; });
  rates.forEach((v,i)=>{
    // 通算(total)バーは5年ごとの推移と系列が異なるため区切り線を入れる
    if(PERIODS[i].total){ const sepX=padL+i*bw;
      s+=`<line x1="${sepX}" y1="${padT-4}" x2="${sepX}" y2="${H-padB+4}" stroke="#c8ccd2" stroke-width="1" stroke-dasharray="2 2"/>`; }
    const x=padL+i*bw+bw*0.18, w=bw*0.64;
    if(v==null){ s+=`<text x="${x+w/2}" y="${zeroY}" font-size="9" fill="#adb4bd" text-anchor="middle">–</text>`; }
    else { const y=scale(v), h=Math.abs(y-zeroY);
      s+=`<rect x="${x}" y="${Math.min(y,zeroY)}" width="${w}" height="${Math.max(h,1)}" rx="1.5" fill="${colorFor(v,PERIODS[i])}"/>`;
      s+=`<text x="${x+w/2}" y="${v>=0?y-3:y+9}" font-size="8" fill="#5a6570" text-anchor="middle">${v.toFixed(1)}</text>`; }
    s+=`<text x="${padL+i*bw+bw/2}" y="${H-14}" font-size="8" fill="#7b8794" text-anchor="middle">${PERIODS[i].a.slice(2)}→${PERIODS[i].b.slice(2)}</text>`;
  });
  s+=`<text x="${padL}" y="${H-3}" font-size="8.5" fill="#7b8794">5年ごとの増減率 ＋ 20年通算 %</text>`;
  $('chart').innerHTML=s;

  // 人口テーブル（各年）＋末尾に2000→2020の通算行
  let rows = YEARS.map((y,i)=>{
    const pop=p['pop'+y]; const r=(i===0)?null:rates[i-1];
    return `<tr><td>${y}</td><td>${fmt(pop==null?null:Number(pop))}</td><td>${i===0?'—':pct(r)}</td></tr>`;
  }).join('');
  const p0=Number(p.pop2000), p1=Number(p.pop2020);
  const diff = (isFinite(p0)&&isFinite(p1))? p1-p0 : null;
  const totalRate = getRate(p, PERIODS.find(pp=>pp.total));
  rows += `<tr class="total-row"><td>通算</td><td>${diff==null?'—':(diff>0?'+':'')+fmt(diff)}</td><td>${pct(totalRate)}</td></tr>`;
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

  const onPeriodClick = btn => { period=PERIODS.find(pp=>pp.id===btn.dataset.id); repaint(); };
  const pdivSeq=$('periods-seq');
  pdivSeq.innerHTML=PERIODS.filter(pp=>!pp.total).map(pp=>`<button data-id="${pp.id}">${pp.label}</button>`).join('');
  pdivSeq.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>onPeriodClick(btn)));

  const pdivTotal=$('periods-total');
  pdivTotal.innerHTML=PERIODS.filter(pp=>pp.total).map(pp=>`<button class="total" data-id="${pp.id}">${pp.label}</button>`).join('');
  pdivTotal.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>onPeriodClick(btn)));

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
