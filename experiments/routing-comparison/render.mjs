import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RelationshipDecorations } from "../../src/RelationshipDecorations.tsx";
import {
  tableWidth,
  height,
  rounded,
  HEADER,
  ROW,
} from "../../src/geometry.ts";
import { relationshipLabels } from "../../src/relationships.ts";
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function drawing({ diagram: d, routes }) {
  const labels = relationshipLabels(d, routes);
  return `<g class="edges">${d.edges
    .map((e) => {
      const r = routes.get(e.id),
        child = d.tables.find((t) => t.id === e.to.table),
        parent = d.tables.find((t) => t.id === e.from.table),
        fk = child.foreignKeys.find((f) => f.id === e.foreignKeyId),
        label = labels.get(e.id);
      const desc = `${parent.name}.${parent.columns[e.from.row][0]} → ${child.name}.${child.columns[e.to.row][0]}`;
      return `<g class="edge" data-edge="${esc(e.id)}"><title>${esc(desc)}</title><path class="hit" d="${rounded(r.points)}"/><path class="line" d="${rounded(r.points)}"/>${renderToStaticMarkup(React.createElement(RelationshipDecorations, { child, fk, from: r.points[0], to: r.points.at(-1), fromSide: r.fromSide ?? e.from.side, toSide: r.toSide ?? e.to.side }))}${label ? `<g class="relationship-label" transform="translate(${label.x} ${label.y})"><rect width="${label.width}" height="${label.height}" rx="3"/><text x="${label.width / 2}" text-anchor="middle">${label.lines.map((s, i) => `<tspan x="${label.width / 2}" y="${15 + i * 16}">${esc(s)}</tspan>`).join("")}</text></g>` : ""}</g>`;
    })
    .join("")}</g><g class="tables">${d.tables
    .map((t) => {
      const w = tableWidth(t);
      return `<g transform="translate(${t.x} ${t.y})"><rect class="table-box" width="${w}" height="${height(t)}" rx="9"/><path class="table-heading" d="M9 0H${w - 9}Q${w} 0 ${w} 9V${HEADER}H0V9Q0 0 9 0"/><text x="16" y="31" class="table-title">${esc(t.name)}</text>${t.columns.map((c, i) => `<text x="12" y="${HEADER + i * ROW + 24}" class="column-key">${esc(c[2] === "PK,FK" ? "P/F" : c[2])}</text><text x="39" y="${HEADER + i * ROW + 24}" class="column-name">${esc(c[0])}</text><text x="${w - 14}" y="${HEADER + i * ROW + 24}" text-anchor="end" class="column-type">${esc(c[1])}</text>`).join("")}</g>`;
    })
    .join("")}</g>`;
}
export function renderHtml(result) {
  const payload = result.cases.map((c) => ({
    ...c,
    diagram: undefined,
    results: Object.fromEntries(
      Object.entries(c.results).map(([k, r]) => [
        k,
        {
          svg: drawing(r),
          metrics: r.metrics,
          timingMs: r.timingMs,
          deterministic: r.deterministic,
        },
      ]),
    ),
  }));
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>線と整頓の比較 · SimpleER</title><style>
:root{--bg:#f8faf9;--surface:#fff;--text:#263b35;--muted:#68766f;--border:#d5ddd9;--accent:#376f61;--line:#84998e}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{padding:20px 24px 14px;background:white;border-bottom:1px solid var(--border)}header p{margin:5px 0 0;color:var(--muted);font-size:13px}h1{font-size:19px;margin:0;font-weight:650}.topline{display:flex;justify-content:space-between;align-items:center;gap:16px}a{color:var(--accent)}.controls{display:flex;flex-wrap:wrap;gap:12px 20px;padding:14px 24px;border-bottom:1px solid var(--border);background:white;align-items:center;position:sticky;top:0;z-index:2}.controls label{display:flex;gap:8px;align-items:center}select,button{font:inherit;color:inherit;background:white;border:1px solid var(--border);border-radius:5px;padding:7px 10px;min-height:36px}button{cursor:pointer}button[aria-pressed=true]{background:#e8f2ed;border-color:var(--accent)}input{accent-color:var(--accent)}main{padding:16px 24px 24px}.case-note{color:var(--muted);font-size:13px;margin:0 0 14px}section{border:1px solid var(--border);margin-bottom:20px;background:var(--bg);border-radius:6px;overflow:hidden}.panel-head{background:white;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 20px;padding:12px 16px;border-bottom:1px solid var(--border)}h2{font-size:15px;margin:0}.scope{font-size:12px;color:var(--muted);font-weight:400;margin-left:12px}.metrics{font-size:12px;display:flex;gap:14px;flex-wrap:wrap}.metrics b{font-variant-numeric:tabular-nums;font-size:14px;font-weight:600}.canvas{overflow:auto;background-image:radial-gradient(#dce4df .8px,transparent .8px);background-size:24px 24px}svg.diagram{display:block;max-width:none;margin:0 auto}.table-box{fill:white;stroke:var(--border);stroke-width:1.3}.table-heading{fill:#f0f4f2}.table-title{font:600 17px ui-monospace,SFMono-Regular,Consolas,monospace;fill:var(--text)}.column-name{font:14px ui-monospace,SFMono-Regular,Consolas,monospace;fill:var(--text)}.column-type{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;fill:var(--muted)}.column-key{font-size:10px;fill:var(--accent)}.line{fill:none;stroke:var(--line);stroke-width:2}.hit{fill:none;stroke:transparent;stroke-width:12;cursor:pointer}.cardinality{fill:none;stroke:var(--line);stroke-width:1.7;pointer-events:none}.cardinality circle,.relationship-label rect{fill:var(--bg)}.relationship-label text{font-size:12px;fill:var(--text)}.edge.active .line,.edge.active .cardinality{stroke:var(--accent);stroke-width:2.5}.warnings{color:#a44538;font-size:12px}.detail{border-top:1px solid var(--border);padding:12px 16px;background:white}.detail summary{cursor:pointer;font-size:12px;color:var(--muted)}.detail p{font-size:12px;line-height:1.8}.empty{padding:60px 20px;color:var(--muted)}footer{font-size:12px;color:var(--muted);padding:0 24px 30px;line-height:1.8}.compact section:first-child{display:none}button:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media(max-width:600px){header{padding:16px}.topline{align-items:flex-start}h1{font-size:17px}.controls{padding:12px 16px;gap:10px;position:static}.controls label:first-child,.controls label:nth-child(2){width:100%;justify-content:space-between}select{max-width:70%}main{padding:14px 10px}.panel-head{padding:12px}.scope{display:block;margin:4px 0 0}.metrics{gap:12px}footer{padding:0 16px 24px}}
</style><header><div class="topline"><h1>線と整頓の比較</h1><a href="/">SimpleERへ戻る</a></div><p>同じテーブル・同じカラム・同じ見た目で比較　／　2026.10.02</p></header>
<div class="controls"><label>図 <select id="case" aria-label="比較する図">${payload.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label><label>比較対象 <select id="engine" aria-label="比較対象"><option value="avoid">libavoid · 線のみ</option><option value="elk">ELK · 配置と線</option><option value="hybrid">ELK配置 ＋ libavoidの線</option><option value="current">現在の整頓</option></select></label><label><input id="pair" type="checkbox" checked>上下で比較</label><div><button id="fit" aria-pressed="true">全体</button> <button id="actual" aria-pressed="false">100%</button></div></div>
<main><p class="case-note" id="note"></p><div id="panels"></div></main><footer>カラムの接続点は固定。鳥の足・ラベル・角丸は共通。線を押すと、両方の図で同じ関係を強調します。<br>曲がり・交差の数は線の中心で集計。共有部分や接触は「交差」に含めません。処理時間はNode.jsで5回実行した中央値。現在・ELKは配置と線、libavoidは線のみ（初回読み込み・描画を除く）。</footer>
<script>
const cases=${JSON.stringify(payload).replaceAll("<", "\\u003c")};
const names={current:'現在の整頓',avoid:'libavoid',elk:'ELK Layered',hybrid:'ELK ＋ libavoid'};
const scopes={current:'現在の配置・現在の線',avoid:'現在の配置・線を再計算',elk:'配置と線を再計算',hybrid:'ELKの配置・線を再計算'};
const $=id=>document.getElementById(id);let fit=true,chosen=null;
function draw(){const c=cases.find(c=>c.id===$('case').value),engine=$('engine').value,a=c.results.current,b=c.results[engine];$('note').textContent=c.note;
 const list=[['current',a],[engine,b]],available=list.filter(([,r])=>r);const maxWidth=Math.max(...available.map(([,r])=>r.metrics.bounds.width))+80,maxHeight=Math.max(...available.map(([,r])=>r.metrics.bounds.height))+80;
 $('panels').className=$('pair').checked?'':'compact';
 $('panels').innerHTML=list.map(([id,r],i)=>{if(!r)return '<section><div class="panel-head"><h2>'+names[id]+'</h2></div><div class="empty">追加・移動の比較は「libavoid · 線のみ」を選んでください。</div></section>';
  const m=r.metrics,warnings=[['共通端点のない線の重なり',m.unrelatedOverlapPairs],['テーブル貫通',m.penetrations],['接続点・向きの不一致',m.endpointErrors],['短い端点区間',m.shortStubs],['テーブル重なり',m.tableOverlaps],['斜め線',m.nonOrthogonal],['ラベルとテーブルの重なり',m.labelTableCollisions],['ラベル同士の重なり',m.labelLabelCollisions]].filter(([,n])=>n).map(([s,n])=>s+' '+n).join(' / ');
  return '<section><div class="panel-head"><h2>'+names[id]+'<span class="scope">'+(c.id==='before'||c.id==='added'||c.id==='moved'?'配置は固定':scopes[id])+'</span></h2><div class="metrics"><span>曲がり <b>'+m.bends+'</b></span><span>交差 <b>'+m.crossings+'</b></span><span>線の長さ <b>'+m.length+'</b> px</span>'+(r.timingMs?'<span><b>'+r.timingMs.median.toFixed(1)+'</b> ms</span>':'')+'</div>'+(warnings?'<span class="warnings">'+warnings+'</span>':'')+'</div><div class="canvas"><svg class="diagram" role="img" aria-label="'+c.name+'・'+names[id]+'" data-width="'+maxWidth+'" data-height="'+maxHeight+'" viewBox="'+(m.bounds.x-40)+' '+(m.bounds.y-40)+' '+maxWidth+' '+maxHeight+'">'+r.svg+'</svg></div><details class="detail"><summary>図のサイズと検証結果</summary><p>幅 '+Math.round(m.bounds.width)+' × 高さ '+Math.round(m.bounds.height)+' px ／ 共有された線の長さ '+m.sharedLength+' px（線の組ごとに集計） ／ 共通端点のない線の重なり '+m.unrelatedOverlapPairs+' 組<br>テーブル貫通 '+m.penetrations+' ／ 接続点・向きの不一致 '+m.endpointErrors+' ／ ラベル重なり '+(m.labelTableCollisions+m.labelLabelCollisions)+(r.deterministic!==undefined?' ／ 同じ入力を繰り返した結果 '+(r.deterministic?'一致':'不一致'):'')+'</p></details></section>';
 }).join('');resize();highlight();}
function resize(){document.querySelectorAll('svg.diagram').forEach(svg=>{const w=+svg.dataset.width,h=+svg.dataset.height,scale=fit?Math.min(1,svg.parentElement.clientWidth/w,560/h):1;svg.style.width=(w*scale)+'px';svg.style.height=(h*scale)+'px';});}
function highlight(){document.querySelectorAll('[data-edge]').forEach(el=>el.classList.toggle('active',el.dataset.edge===chosen));}
$('case').addEventListener('change',()=>{if(['before','added','moved'].includes($('case').value)&&!['current','avoid'].includes($('engine').value))$('engine').value='avoid';chosen=null;draw();});$('engine').addEventListener('change',draw);$('pair').addEventListener('change',draw);
$('fit').onclick=()=>{fit=true;$('fit').setAttribute('aria-pressed','true');$('actual').setAttribute('aria-pressed','false');resize();};$('actual').onclick=()=>{fit=false;$('fit').setAttribute('aria-pressed','false');$('actual').setAttribute('aria-pressed','true');resize();};
$('panels').addEventListener('click',e=>{const edge=e.target.closest('[data-edge]');if(edge){chosen=chosen===edge.dataset.edge?null:edge.dataset.edge;highlight();}});window.addEventListener('resize',resize);draw();
</script></html>`;
}
