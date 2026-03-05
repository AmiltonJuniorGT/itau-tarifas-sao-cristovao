const $ = (id) => document.getElementById(id);

/** Catálogo de Unidades (Pivot mensal)
 *  Cada unidade aponta para um CSV público no formato:
 *  Denominação | YYYY-MM | YYYY-MM | ...
 *
 *  URL típica:
 *  https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=csv&gid=<GID>
 */
const UNITS = [
  {
    key: "SC",
    name: "São Cristóvão BA",
    csv: "https://docs.google.com/spreadsheets/d/1g9rTDldOUzgcVWKrvw1IGZ2RlhItF5gh/export?format=csv&gid=1092717054"
  },
  {
    key: "CAJ",
    name: "Cajazeiras BA",
    csv: "https://docs.google.com/spreadsheets/d/1dPt6Y1Mb1Yrzb0e3Z9U7Mc0fcVBVmcHq/export?format=csv&gid=1825385594"
  },
  {
    key: "CAM",
    name: "Camaçari BA",
    csv: "https://docs.google.com/spreadsheets/d/1d5LLNN1lShh61EHxS93vCuFKzTH3qwcM/export?format=csv&gid=551763344"
  }
];

function parseParams() {
  const p = new URLSearchParams(location.search);
  const u = (p.get("u") || "SC").split(",").map(s => s.trim()).filter(Boolean);
  const mode = (p.get("mode") || "sum").toLowerCase() === "compare" ? "compare" : "sum";
  return { u, mode };
}
function setParams(units, mode) {
  const p = new URLSearchParams(location.search);
  p.set("u", units.join(","));
  p.set("mode", mode);
  history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}

function setStatus(msg) {
  $("status").textContent = msg || "—";
  $("status2").textContent = msg || "";
}
function norm(s){ return String(s ?? "").replace(/\u00A0/g," ").trim(); }
function looksLikeMonth(s){ return /^\d{4}-\d{2}$/.test(norm(s)); }
function toNumberBR(s){
  const v = norm(s);
  if (!v) return NaN;
  const cleaned = v.replace(/R\$\s?/g,"").replace(/\s/g,"");
  if (cleaned.includes(",") && cleaned.includes(".")) return Number(cleaned.replace(/\./g,"").replace(",", "."));
  if (cleaned.includes(",") && !cleaned.includes(".")) return Number(cleaned.replace(/\./g,"").replace(",", "."));
  return Number(cleaned);
}
function median(arr){
  const a = arr.filter(x => Number.isFinite(x)).slice().sort((x,y)=>x-y);
  if (!a.length) return NaN;
  const mid = Math.floor(a.length/2);
  return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
}
function rollingMedian(values, window=3){
  const out = [];
  for (let i=0;i<values.length;i++){
    const start = Math.max(0, i-window+1);
    out.push(median(values.slice(start, i+1)));
  }
  return out;
}
function fmtBRL(n){
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

// CSV parser com aspas
function parseCsv(text){
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let cur=[], field="", inQuotes=false;

  for (let i=0;i<text.length;i++){
    const ch = text[i];
    if (ch === '"'){
      if (inQuotes && text[i+1] === '"'){ field+='"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes){
      cur.push(field); field="";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes){
      if (ch === "\r" && text[i+1] === "\n") i++;
      cur.push(field); field="";
      if (cur.some(v => norm(v) !== "")) rows.push(cur);
      cur=[];
    } else {
      field += ch;
    }
  }
  if (field.length || cur.length){
    cur.push(field);
    if (cur.some(v => norm(v) !== "")) rows.push(cur);
  }
  return rows;
}

// ---------------- MultiSelect UI ----------------
let selectedUnits = [];

function setUnitsButtonText() {
  const names = selectedUnits.map(k => UNITS.find(u => u.key === k)?.name || k);
  if (!names.length) $("unitsBtnText").textContent = "Selecione…";
  else if (names.length === 1) $("unitsBtnText").textContent = names[0];
  else $("unitsBtnText").textContent = `${names.length} unidades selecionadas`;
}

function buildUnitsMenu(defaults) {
  const menu = $("unitsMenu");
  menu.innerHTML = "";

  UNITS.forEach(u => {
    const row = document.createElement("label");
    row.className = "mselItem";
    row.innerHTML = `
      <input type="checkbox" value="${u.key}">
      <span>${u.name}</span>
      <span style="margin-left:auto" class="mselPill">${u.key}</span>
    `;
    const cb = row.querySelector("input");
    cb.checked = defaults.includes(u.key);

    cb.addEventListener("change", () => {
      selectedUnits = Array.from(menu.querySelectorAll("input[type=checkbox]"))
        .filter(x => x.checked).map(x => x.value);

      if (!selectedUnits.length) {
        cb.checked = true;
        selectedUnits = [u.key];
      }

      setUnitsButtonText();
      reloadAll();
    });

    menu.appendChild(row);
  });

  selectedUnits = defaults.length ? defaults.slice() : ["SC"];
  setUnitsButtonText();
}

function bindUnitsDropdown() {
  const btn = $("unitsBtn");
  const menu = $("unitsMenu");

  btn.addEventListener("click", () => {
    const open = menu.classList.toggle("open");
    menu.setAttribute("aria-hidden", open ? "false" : "true");
  });

  document.addEventListener("click", (e) => {
    const widget = $("unitsWidget");
    if (!widget.contains(e.target)) {
      menu.classList.remove("open");
      menu.setAttribute("aria-hidden", "true");
    }
  });
}

// ---------------- state ----------------
let chartTotal = null;
let chartDenom = null;
let PIVOTS = {}; // por unidade
let CONS = null; // consolidado

// ---------------- fetch pivot ----------------
async function fetchPivot(unit){
  const res = await fetch(unit.csv, { cache:"no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar CSV da unidade ${unit.name}.`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error(`CSV vazio (${unit.name}).`);

  let headerIdx = -1;
  for (let i=0;i<Math.min(rows.length, 50);i++){
    const r = rows[i].map(norm);
    const denomIdx = r.findIndex(x => x.toLowerCase().includes("denom"));
    if (denomIdx < 0) continue;
    const monthsCount = r.filter(looksLikeMonth).length;
    if (monthsCount >= 2){ headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error(`CSV não está no formato pivot esperado (${unit.name}).`);

  const header = rows[headerIdx].map(norm);
  const dataRows = rows.slice(headerIdx+1);

  const denomColIdx = header.findIndex(h => h.toLowerCase().includes("denom"));
  const monthCols = header.map((h,idx)=>({ h:norm(h), idx })).filter(x => looksLikeMonth(x.h));
  const months = monthCols.map(x => x.h);

  const denoms = [];
  const matrix = [];

  for (const r0 of dataRows){
    const r = r0.map(norm);
    const denom = norm(r[denomColIdx]);
    if (!denom) continue;
    denoms.push(denom);

    const row = monthCols.map(mc => {
      const v = toNumberBR(r[mc.idx]);
      return Number.isFinite(v) ? Math.abs(v) : 0;
    });
    matrix.push(row);
  }

  if (!denoms.length) throw new Error(`Sem linhas de denominação (${unit.name}).`);
  return { months, denoms, matrix };
}

// ---------------- consolidate ----------------
function consolidate(unitKeys){
  const pivs = unitKeys.map(k => ({ key:k, piv:PIVOTS[k] })).filter(x => x.piv);

  const monthsSet = new Set();
  pivs.forEach(x => x.piv.months.forEach(m => monthsSet.add(m)));
  const months = Array.from(monthsSet).sort();

  const denomSet = new Set();
  pivs.forEach(x => x.piv.denoms.forEach(d => denomSet.add(d)));
  const denoms = Array.from(denomSet).sort();

  const sumMap = new Map();
  const byUnitMonthly = {};

  pivs.forEach(({key, piv}) => {
    const monthIndex = months.map(m => piv.months.indexOf(m));
    const denomIndex = denoms.map(d => piv.denoms.indexOf(d));

    for (let di=0; di<denoms.length; di++){
      const srcDi = denomIndex[di];
      for (let mi=0; mi<months.length; mi++){
        const srcMi = monthIndex[mi];
        const v = (srcDi >= 0 && srcMi >= 0) ? (piv.matrix[srcDi][srcMi] || 0) : 0;
        const k2 = `${denoms[di]}||${months[mi]}`;
        sumMap.set(k2, (sumMap.get(k2) || 0) + v);
      }
    }

    byUnitMonthly[key] = months.map((m, mi) => {
      const srcMi = monthIndex[mi];
      if (srcMi < 0) return 0;
      let total = 0;
      for (let r=0;r<piv.denoms.length;r++) total += (piv.matrix[r][srcMi] || 0);
      return total;
    });
  });

  const matrix = denoms.map(d => months.map(m => sumMap.get(`${d}||${m}`) || 0));
  return { months, denoms, matrix, byUnitMonthly };
}

// ---------------- tables ----------------
function buildResumoTable(months, denoms, matrix){
  const thead = $("tblResumo").querySelector("thead");
  const tbody = $("tblResumo").querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

  const trh = document.createElement("tr");
  const th0 = document.createElement("th"); th0.textContent = "Denominação"; trh.appendChild(th0);
  for (const m of months){ const th=document.createElement("th"); th.textContent=m; trh.appendChild(th); }
  const thT = document.createElement("th"); thT.textContent="Total"; trh.appendChild(thT);
  thead.appendChild(trh);

  for (let i=0;i<denoms.length;i++){
    const tr = document.createElement("tr");
    const td0 = document.createElement("td");
    td0.className="tag";
    td0.innerHTML = `<span class="chip">${denoms[i]}</span>`;
    tr.appendChild(td0);

    const row = matrix[i];
    const rowMax = Math.max(...row, 0.000001);
    let rowSum = 0;

    for (let j=0;j<months.length;j++){
      const v = row[j] || 0;
      rowSum += v;
      const td = document.createElement("td");
      td.className="num";
      const ratio = v / rowMax;
      const alpha = 0.06 + 0.28*ratio;
      td.style.background = `rgba(46,125,50,${alpha})`;
      td.textContent = v ? fmtBRL(v) : "—";
      tr.appendChild(td);
    }

    const tdT = document.createElement("td");
    tdT.className="num";
    tdT.textContent = fmtBRL(rowSum);
    tr.appendChild(tdT);

    tbody.appendChild(tr);
  }
}

function buildOutliersTable(months, totalByMonth, med3, threshold){
  const thead = $("tblOutliers").querySelector("thead");
  const tbody = $("tblOutliers").querySelector("tbody");
  thead.innerHTML=""; tbody.innerHTML="";

  const trh = document.createElement("tr");
  ["Mês","Total","Mediana 3m","Status"].forEach(h => {
    const th=document.createElement("th"); th.textContent=h; trh.appendChild(th);
  });
  thead.appendChild(trh);

  for (let i=0;i<months.length;i++){
    const tot = totalByMonth[i];
    const med = med3[i];
    const isOut = Number.isFinite(med) && tot > med * threshold;

    const tr=document.createElement("tr");
    const tdM=document.createElement("td"); tdM.textContent=months[i]; tr.appendChild(tdM);
    const tdT=document.createElement("td"); tdT.className="num"; tdT.textContent=fmtBRL(tot); tr.appendChild(tdT);
    const tdMed=document.createElement("td"); tdMed.className="num"; tdMed.textContent=fmtBRL(med); tr.appendChild(tdMed);
    const tdS=document.createElement("td");
    tdS.innerHTML = isOut ? `<span class="badgeWarn">ACIMA</span>` : `<span style="color: rgba(30,42,36,.55)">—</span>`;
    tr.appendChild(tdS);

    if (isOut) tdT.style.background = "rgba(249,168,37,.18)";
    tbody.appendChild(tr);
  }
}

function buildDetailTablePivot(denoms, totals){
  const thead = $("tblDetalhe").querySelector("thead");
  const tbody = $("tblDetalhe").querySelector("tbody");
  thead.innerHTML=""; tbody.innerHTML="";

  const trh=document.createElement("tr");
  ["Denominação","Total no período"].forEach(h => {
    const th=document.createElement("th"); th.textContent=h; trh.appendChild(th);
  });
  thead.appendChild(trh);

  const pairs = denoms.map((d,i)=>({ d, t: totals[i] })).sort((a,b)=>b.t-a.t);
  const maxRows = 120;
  for (const p of pairs.slice(0,maxRows)){
    const tr=document.createElement("tr");
    const tdD=document.createElement("td"); tdD.innerHTML=`<span class="chip">${p.d}</span>`; tr.appendChild(tdD);
    const tdT=document.createElement("td"); tdT.className="num"; tdT.textContent=fmtBRL(p.t); tr.appendChild(tdT);
    tbody.appendChild(tr);
  }
  $("countPill").textContent = `${pairs.length.toLocaleString("pt-BR")} denominações (top ${Math.min(maxRows,pairs.length)})`;
}

// ---------------- charts ----------------
function renderCharts(months, totalByMonth, med3, denoms, matrix){
  const mode = $("mode").value;

  if (chartTotal) chartTotal.destroy();

  const datasetsTotal = [];
  if (mode === "compare" && CONS?.byUnitMonthly){
    $("noteTotal").textContent = "Comparação: total mensal por unidade (linhas)";
    for (const uk of selectedUnits){
      const unit = UNITS.find(u => u.key === uk);
      const data = CONS.byUnitMonthly[uk] || months.map(()=>0);
      datasetsTotal.push({ label: unit ? unit.name : uk, data, borderWidth:2, pointRadius:2, tension:.25 });
    }
  } else {
    $("noteTotal").textContent = "Consolidado: Total vs Mediana 3m";
    datasetsTotal.push(
      { label:"Total mensal", data: totalByMonth, borderColor:"#2E7D32", backgroundColor:"rgba(46,125,50,.08)", borderWidth:2, pointRadius:2, tension:.25 },
      { label:"Mediana móvel (3m)", data: med3, borderColor:"#66BB6A", borderWidth:2, pointRadius:2, borderDash:[6,6], tension:.25 }
    );
  }

  chartTotal = new Chart($("chartTotal"), {
    type:"line",
    data:{ labels:months, datasets: datasetsTotal },
    options:{
      responsive:true,
      plugins:{ legend:{ labels:{ color:"#1E2A24" } } },
      scales:{
        x:{ ticks:{ color:"#6B7C73" }, grid:{ color:"rgba(30,42,36,.10)" } },
        y:{ ticks:{ color:"#6B7C73", callback:(v)=>Number(v).toLocaleString("pt-BR") }, grid:{ color:"rgba(30,42,36,.10)" } }
      }
    }
  });

  if (chartDenom) chartDenom.destroy();
  const totalsByDenom = denoms.map((d,i)=>matrix[i].reduce((a,b)=>a+b,0));
  const order = totalsByDenom.map((t,i)=>({t,i})).sort((a,b)=>b.t-a.t).slice(0,10).map(x=>x.i);

  chartDenom = new Chart($("chartDenom"), {
    type:"line",
    data:{
      labels: months,
      datasets: order.map(i=>({
        label: denoms[i],
        data: matrix[i],
        borderWidth: 2,
        pointRadius: 1.5,
        tension: .25
      }))
    },
    options:{
      responsive:true,
      plugins:{ legend:{ labels:{ color:"#1E2A24" } } },
      scales:{
        x:{ ticks:{ color:"#6B7C73" }, grid:{ color:"rgba(30,42,36,.10)" } },
        y:{ ticks:{ color:"#6B7C73", callback:(v)=>Number(v).toLocaleString("pt-BR") }, grid:{ color:"rgba(30,42,36,.10)" } }
      }
    }
  });

  const totalAll = totalByMonth.reduce((a,b)=>a+b,0);
  $("totalPill").textContent = `Total no período: ${fmtBRL(totalAll)}`;
  $("denomPill").textContent = `${denoms.length} denominações (gráfico mostra top 10)`;
}

// ---------------- apply filters ----------------
function applyFilters(){
  if (!CONS) return;

  const threshold = Number($("threshold").value);
  const startYM = $("startDate").value ? $("startDate").value.slice(0,7) : null;
  const endYM   = $("endDate").value ? $("endDate").value.slice(0,7) : null;

  let months = CONS.months.slice();
  if (startYM) months = months.filter(m => m >= startYM);
  if (endYM) months = months.filter(m => m <= endYM);
  const monthIndex = months.map(m => CONS.months.indexOf(m));

  const selectedDenoms = Array.from($("denoms").selectedOptions).map(o=>o.value);
  const keepDenomIdx = CONS.denoms
    .map((d,i)=>({d,i}))
    .filter(x => selectedDenoms.length ? selectedDenoms.includes(x.d) : true)
    .map(x => x.i);

  const denoms = keepDenomIdx.map(i => CONS.denoms[i]);
  const matrix = keepDenomIdx.map(i => monthIndex.map(j => CONS.matrix[i][j] || 0));

  const totalByMonth = months.map((m, mi) => matrix.reduce((acc,row)=>acc+(row[mi]||0),0));
  const med3 = rollingMedian(totalByMonth, 3);

  buildResumoTable(months, denoms, matrix);
  buildOutliersTable(months, totalByMonth, med3, threshold);

  const totalsByDenom = denoms.map((d,i)=>matrix[i].reduce((a,b)=>a+b,0));
  buildDetailTablePivot(denoms, totalsByDenom);

  renderCharts(months, totalByMonth, med3, denoms, matrix);

  setParams(selectedUnits, $("mode").value);
  setStatus(`Aplicado: ${selectedUnits.length} unidade(s) | ${denoms.length} denominações | ${months.length} meses | limiar ${threshold.toFixed(2)}×`);
}

// ---------------- presets ----------------
function applyPreset(preset){
  if (!CONS || preset === "custom") return;
  const months = CONS.months;
  if (!months.length) return;

  if (preset === "all"){
    $("startDate").value = months[0] + "-01";
    $("endDate").value   = months[months.length-1] + "-01";
    return;
  }

  const endM = months[months.length-1];
  const end = new Date(endM + "-01T00:00:00");
  let start = new Date(end);
  const yearStart = new Date(end.getFullYear(), 0, 1);

  if (preset === "3m") start.setMonth(start.getMonth() - 3);
  if (preset === "6m") start.setMonth(start.getMonth() - 6);
  if (preset === "12m") start.setMonth(start.getMonth() - 12);
  if (preset === "ytd") start = yearStart;

  $("startDate").value = start.toISOString().slice(0,10);
  $("endDate").value = new Date(end.getFullYear(), end.getMonth()+1, 0).toISOString().slice(0,10);
}

// ---------------- export ----------------
function exportResumoCsv(){
  const table = $("tblResumo");
  const lines = [];
  table.querySelectorAll("tr").forEach(tr => {
    const cells = Array.from(tr.children).map(td => {
      const txt = td.textContent.replace(/\s+/g," ").trim();
      return `"${txt.replace(/"/g,'""')}"`;
    });
    lines.push(cells.join(","));
  });

  const blob = new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "resumo_mensal_tarifas_multiunidade.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------- reload ----------------
async function reloadAll(){
  try{
    setStatus("Carregando unidades...");

    const toLoad = selectedUnits
      .map(k => UNITS.find(u => u.key === k))
      .filter(u => u && !PIVOTS[u.key]);

    for (const unit of toLoad){
      setStatus(`Carregando: ${unit.name}...`);
      PIVOTS[unit.key] = await fetchPivot(unit);
    }

    CONS = consolidate(selectedUnits);

    const sel = $("denoms");
    sel.innerHTML = "";
    CONS.denoms.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      opt.selected = true;
      sel.appendChild(opt);
    });

    $("startDate").value = CONS.months[0] + "-01";
    $("endDate").value = CONS.months[CONS.months.length-1] + "-01";

    $("noteTotal").textContent = ($("mode").value === "compare")
      ? "Comparação: total mensal por unidade (linhas)"
      : "Consolidado: Total vs Mediana 3m";

    setStatus(`OK: ${selectedUnits.length} unidade(s) | ${CONS.denoms.length} denominações | ${CONS.months.length} meses.`);
    applyFilters();
  } catch (err){
    console.error(err);
    setStatus(err.message || String(err));
  }
}

// ---------------- init ----------------
function init(){
  const { u, mode } = parseParams();

  buildUnitsMenu(u.length ? u : ["SC"]);
  bindUnitsDropdown();

  $("mode").value = mode;

  $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
  $("threshold").addEventListener("input", () => {
    $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
  });

  $("preset").addEventListener("change", () => applyPreset($("preset").value));
  $("btnReload").addEventListener("click", (e) => { e.preventDefault(); reloadAll(); });
  $("btnApply").addEventListener("click", (e) => { e.preventDefault(); applyFilters(); });
  $("btnReset").addEventListener("click", (e) => {
    e.preventDefault();
    $("preset").value = "custom";
    Array.from($("denoms").options).forEach(o=>o.selected=true);
    applyFilters();
  });
  $("btnExport").addEventListener("click", (e) => { e.preventDefault(); exportResumoCsv(); });

  $("mode").addEventListener("change", () => reloadAll());

  reloadAll();
}

init();  p.set("mode", mode);
  history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}

function setStatus(msg) {
  $("status").textContent = msg || "—";
  $("status2").textContent = msg || "";
}

function norm(s){
  return String(s ?? "").replace(/\u00A0/g," ").trim();
}

function looksLikeMonth(s){
  return /^\d{4}-\d{2}$/.test(norm(s));
}

function toNumberBR(s){
  const v = norm(s);
  if (!v) return NaN;
  const cleaned = v.replace(/R\$\s?/g,"").replace(/\s/g,"");
  if (cleaned.includes(",") && cleaned.includes(".")) return Number(cleaned.replace(/\./g,"").replace(",","."));
  if (cleaned.includes(",") && !cleaned.includes(".")) return Number(cleaned.replace(/\./g,"").replace(",","."));
  return Number(cleaned);
}

function median(arr){
  const a = arr.filter(x => Number.isFinite(x)).slice().sort((x,y)=>x-y);
  if (!a.length) return NaN;
  const mid = Math.floor(a.length/2);
  return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
}

function rollingMedian(values, window=3){
  const out = [];
  for (let i=0;i<values.length;i++){
    const start = Math.max(0, i-window+1);
    out.push(median(values.slice(start, i+1)));
  }
  return out;
}

function fmtBRL(n){
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

// CSV parser com aspas
function parseCsv(text){
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let cur=[], field="", inQuotes=false;

  for (let i=0;i<text.length;i++){
    const ch = text[i];
    if (ch === '"'){
      if (inQuotes && text[i+1] === '"'){ field+='"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes){
      cur.push(field); field="";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes){
      if (ch === "\r" && text[i+1] === "\n") i++;
      cur.push(field); field="";
      if (cur.some(v => norm(v) !== "")) rows.push(cur);
      cur=[];
    } else {
      field += ch;
    }
  }
  if (field.length || cur.length){
    cur.push(field);
    if (cur.some(v => norm(v) !== "")) rows.push(cur);
  }
  return rows;
}

// -------------- state --------------
let chartTotal = null;
let chartDenom = null;

// PIVOTS por unidade: { unitKey: { months, denoms, matrix } }
let PIVOTS = {};
// Pivot consolidado selecionado: { months, denoms, matrix, byUnitTotals? }
let CONS = null;

// -------------- load one pivot --------------
async function fetchPivot(unit){
  const res = await fetch(unit.csv, { cache:"no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar CSV da unidade ${unit.name}.`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error(`CSV vazio (${unit.name}).`);

  // header: linha com Denominação e >=2 colunas YYYY-MM
  let headerIdx = -1;
  for (let i=0;i<Math.min(rows.length, 50);i++){
    const r = rows[i].map(norm);
    const denomIdx = r.findIndex(x => x.toLowerCase().includes("denom"));
    if (denomIdx < 0) continue;
    const monthsCount = r.filter(looksLikeMonth).length;
    if (monthsCount >= 2){ headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error(`CSV não está no formato pivot esperado (${unit.name}).`);

  const header = rows[headerIdx].map(norm);
  const dataRows = rows.slice(headerIdx+1);

  const denomColIdx = header.findIndex(h => h.toLowerCase().includes("denom"));
  const monthCols = header.map((h,idx)=>({ h:norm(h), idx })).filter(x => looksLikeMonth(x.h));
  const months = monthCols.map(x => x.h);

  const denoms = [];
  const matrix = [];

  for (const r0 of dataRows){
    const r = r0.map(norm);
    const denom = norm(r[denomColIdx]);
    if (!denom) continue;
    denoms.push(denom);
    const row = monthCols.map(mc => {
      const v = toNumberBR(r[mc.idx]);
      return Number.isFinite(v) ? Math.abs(v) : 0;
    });
    matrix.push(row);
  }
  if (!denoms.length) throw new Error(`Sem linhas de denominação (${unit.name}).`);

  return { months, denoms, matrix };
}

// -------------- consolidate pivots --------------
function consolidate(selectedUnitKeys){
  const pivs = selectedUnitKeys.map(k => ({ key:k, piv:PIVOTS[k] })).filter(x => x.piv);

  // união de meses
  const monthsSet = new Set();
  pivs.forEach(x => x.piv.months.forEach(m => monthsSet.add(m)));
  const months = Array.from(monthsSet).sort();

  // união de denominações
  const denomSet = new Set();
  pivs.forEach(x => x.piv.denoms.forEach(d => denomSet.add(d)));
  const denoms = Array.from(denomSet).sort();

  // map para somas: denom||month -> value
  const sumMap = new Map();
  // também vamos guardar totais por unidade por mês (para modo compare)
  const byUnitMonthly = {}; // key -> [monthTotals aligned months]
  pivs.forEach(({key, piv}) => {
    const monthIndex = months.map(m => piv.months.indexOf(m));
    const denomIndex = denoms.map(d => piv.denoms.indexOf(d));

    // construir matriz alinhada e somar
    for (let di=0; di<denoms.length; di++){
      const srcDi = denomIndex[di];
      for (let mi=0; mi<months.length; mi++){
        const srcMi = monthIndex[mi];
        const v = (srcDi >= 0 && srcMi >= 0) ? (piv.matrix[srcDi][srcMi] || 0) : 0;
        const key2 = `${denoms[di]}||${months[mi]}`;
        sumMap.set(key2, (sumMap.get(key2) || 0) + v);
      }
    }

    // totais por mês da unidade
    const unitMonthTotals = months.map((m, mi) => {
      const srcMi = monthIndex[mi];
      if (srcMi < 0) return 0;
      let total = 0;
      for (let r=0;r<piv.denoms.length;r++){
        total += (piv.matrix[r][srcMi] || 0);
      }
      return total;
    });
    byUnitMonthly[key] = unitMonthTotals;
  });

  const matrix = denoms.map(d => months.map(m => sumMap.get(`${d}||${m}`) || 0));
  return { months, denoms, matrix, byUnitMonthly };
}

// -------------- UI build tables --------------
function buildResumoTable(months, denoms, matrix){
  const thead = $("tblResumo").querySelector("thead");
  const tbody = $("tblResumo").querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

  const trh = document.createElement("tr");
  const th0 = document.createElement("th"); th0.textContent = "Denominação"; trh.appendChild(th0);
  for (const m of months){ const th=document.createElement("th"); th.textContent=m; trh.appendChild(th); }
  const thT = document.createElement("th"); thT.textContent="Total"; trh.appendChild(thT);
  thead.appendChild(trh);

  for (let i=0;i<denoms.length;i++){
    const tr = document.createElement("tr");
    const td0 = document.createElement("td");
    td0.className="tag";
    td0.innerHTML = `<span class="chip">${denoms[i]}</span>`;
    tr.appendChild(td0);

    const row = matrix[i];
    const rowMax = Math.max(...row, 0.000001);
    let rowSum = 0;

    for (let j=0;j<months.length;j++){
      const v = row[j] || 0;
      rowSum += v;
      const td = document.createElement("td");
      td.className="num";
      const ratio = v / rowMax;
      const alpha = 0.06 + 0.28*ratio;
      td.style.background = `rgba(46,125,50,${alpha})`;
      td.textContent = v ? fmtBRL(v) : "—";
      tr.appendChild(td);
    }

    const tdT = document.createElement("td");
    tdT.className="num";
    tdT.textContent = fmtBRL(rowSum);
    tr.appendChild(tdT);

    tbody.appendChild(tr);
  }
}

function buildOutliersTable(months, totalByMonth, med3, threshold){
  const thead = $("tblOutliers").querySelector("thead");
  const tbody = $("tblOutliers").querySelector("tbody");
  thead.innerHTML=""; tbody.innerHTML="";

  const trh = document.createElement("tr");
  ["Mês","Total","Mediana 3m","Status"].forEach(h => {
    const th=document.createElement("th"); th.textContent=h; trh.appendChild(th);
  });
  thead.appendChild(trh);

  for (let i=0;i<months.length;i++){
    const tot = totalByMonth[i];
    const med = med3[i];
    const isOut = Number.isFinite(med) && tot > med * threshold;

    const tr=document.createElement("tr");
    const tdM=document.createElement("td"); tdM.textContent=months[i]; tr.appendChild(tdM);
    const tdT=document.createElement("td"); tdT.className="num"; tdT.textContent=fmtBRL(tot); tr.appendChild(tdT);
    const tdMed=document.createElement("td"); tdMed.className="num"; tdMed.textContent=fmtBRL(med); tr.appendChild(tdMed);
    const tdS=document.createElement("td");
    tdS.innerHTML = isOut ? `<span class="badgeWarn">ACIMA</span>` : `<span style="color: rgba(30,42,36,.55)">—</span>`;
    tr.appendChild(tdS);

    if (isOut) tdT.style.background = "rgba(249,168,37,.18)";
    tbody.appendChild(tr);
  }
}

function buildDetailTablePivot(denoms, totals){
  const thead = $("tblDetalhe").querySelector("thead");
  const tbody = $("tblDetalhe").querySelector("tbody");
  thead.innerHTML=""; tbody.innerHTML="";

  const trh=document.createElement("tr");
  ["Denominação","Total no período"].forEach(h => {
    const th=document.createElement("th"); th.textContent=h; trh.appendChild(th);
  });
  thead.appendChild(trh);

  const pairs = denoms.map((d,i)=>({ d, t: totals[i] })).sort((a,b)=>b.t-a.t);
  const maxRows = 120;
  for (const p of pairs.slice(0,maxRows)){
    const tr=document.createElement("tr");
    const tdD=document.createElement("td"); tdD.innerHTML=`<span class="chip">${p.d}</span>`; tr.appendChild(tdD);
    const tdT=document.createElement("td"); tdT.className="num"; tdT.textContent=fmtBRL(p.t); tr.appendChild(tdT);
    tbody.appendChild(tr);
  }
  $("countPill").textContent = `${pairs.length.toLocaleString("pt-BR")} denominações (top ${Math.min(maxRows,pairs.length)})`;
}

// -------------- charts --------------
function renderCharts(months, totalByMonth, med3, denoms, matrix, mode, selectedUnits){
  // Total
  const ctx1 = $("chartTotal");
  if (chartTotal) chartTotal.destroy();

  const datasetsTotal = [];
  if (mode === "compare" && CONS?.byUnitMonthly){
    $("noteTotal").textContent = "Comparação: total mensal por unidade (linhas)";
    // cada unidade vira uma série
    for (const uk of selectedUnits){
      const unit = UNITS.find(u => u.key === uk);
      const data = CONS.byUnitMonthly[uk] || months.map(()=>0);
      datasetsTotal.push({
        label: unit ? unit.name : uk,
        data,
        borderWidth: 2,
        pointRadius: 2,
        tension: .25
      });
    }
  } else {
    $("noteTotal").textContent = "Consolidado: Total vs Mediana 3m";
    datasetsTotal.push(
      { label:"Total mensal", data: totalByMonth, borderColor:"#2E7D32", backgroundColor:"rgba(46,125,50,.08)", borderWidth:2, pointRadius:2, tension:.25 },
      { label:"Mediana móvel (3m)", data: med3, borderColor:"#66BB6A", borderWidth:2, pointRadius:2, borderDash:[6,6], pointRadius:2, tension:.25 }
    );
  }

  chartTotal = new Chart(ctx1, {
    type:"line",
    data:{ labels:months, datasets: datasetsTotal },
    options:{
      responsive:true,
      plugins:{ legend:{ labels:{ color:"#1E2A24" } } },
      scales:{
        x:{ ticks:{ color:"#6B7C73" }, grid:{ color:"rgba(30,42,36,.10)" } },
        y:{ ticks:{ color:"#6B7C73", callback:(v)=>Number(v).toLocaleString("pt-BR") }, grid:{ color:"rgba(30,42,36,.10)" } }
      }
    }
  });

  // Denoms (Top 10 por total no período, usando consolidado)
  const totalsByDenom = denoms.map((d,i)=>matrix[i].reduce((a,b)=>a+b,0));
  const order = totalsByDenom.map((t,i)=>({t,i})).sort((a,b)=>b.t-a.t).slice(0,10).map(x=>x.i);
  const denomTop = order.map(i => denoms[i]);
  const matrixTop = order.map(i => matrix[i]);

  const ctx2 = $("chartDenom");
  if (chartDenom) chartDenom.destroy();
  chartDenom = new Chart(ctx2, {
    type:"line",
    data:{
      labels: months,
      datasets: denomTop.map((d,i)=>({
        label: d,
        data: matrixTop[i],
        borderWidth: 2,
        pointRadius: 1.5,
        tension: .25
      }))
    },
    options:{
      responsive:true,
      plugins:{ legend:{ labels:{ color:"#1E2A24" } } },
      scales:{
        x:{ ticks:{ color:"#6B7C73" }, grid:{ color:"rgba(30,42,36,.10)" } },
        y:{ ticks:{ color:"#6B7C73", callback:(v)=>Number(v).toLocaleString("pt-BR") }, grid:{ color:"rgba(30,42,36,.10)" } }
      }
    }
  });

  const totalAll = totalByMonth.reduce((a,b)=>a+b,0);
  $("totalPill").textContent = `Total no período: ${fmtBRL(totalAll)}`;
  $("denomPill").textContent = `${denoms.length} denominações (gráfico mostra top 10)`;
}

// -------------- apply filters --------------
function applyFilters(){
  if (!CONS) return;

  const threshold = Number($("threshold").value);
  const mode = $("mode").value;

  const selectedUnits = Array.from($("units").selectedOptions).map(o=>o.value);
  const selectedDenoms = Array.from($("denoms").selectedOptions).map(o=>o.value);

  const startYM = $("startDate").value ? $("startDate").value.slice(0,7) : null;
  const endYM   = $("endDate").value ? $("endDate").value.slice(0,7) : null;

  // filtra meses
  let months = CONS.months.slice();
  if (startYM) months = months.filter(m => m >= startYM);
  if (endYM) months = months.filter(m => m <= endYM);

  const monthIndex = months.map(m => CONS.months.indexOf(m));

  // filtra denominações
  const keepDenomIdx = CONS.denoms
    .map((d,i)=>({d,i}))
    .filter(x => selectedDenoms.length ? selectedDenoms.includes(x.d) : true)
    .map(x => x.i);

  const denoms = keepDenomIdx.map(i => CONS.denoms[i]);
  const matrix = keepDenomIdx.map(i => monthIndex.map(j => CONS.matrix[i][j] || 0));

  const totalByMonth = months.map((m, mi) => matrix.reduce((acc,row)=>acc+(row[mi]||0),0));
  const med3 = rollingMedian(totalByMonth, 3);

  buildResumoTable(months, denoms, matrix);
  buildOutliersTable(months, totalByMonth, med3, threshold);

  const totalsByDenom = denoms.map((d,i)=>matrix[i].reduce((a,b)=>a+b,0));
  buildDetailTablePivot(denoms, totalsByDenom);

  renderCharts(months, totalByMonth, med3, denoms, matrix, mode, selectedUnits);

  // salvar na URL
  setParams(selectedUnits, mode);

  setStatus(`Aplicado: ${selectedUnits.length} unidade(s) | ${denoms.length} denominações | ${months.length} meses | limiar ${threshold.toFixed(2)}×`);
}

// -------------- presets --------------
function applyPreset(preset){
  if (!CONS || preset === "custom") return;

  const months = CONS.months;
  if (!months.length) return;

  if (preset === "all"){
    $("startDate").value = months[0] + "-01";
    $("endDate").value   = months[months.length-1] + "-01";
    return;
  }

  const endM = months[months.length-1];
  const end = new Date(endM + "-01T00:00:00");
  let start = new Date(end);
  const yearStart = new Date(end.getFullYear(), 0, 1);

  if (preset === "3m") start.setMonth(start.getMonth() - 3);
  if (preset === "6m") start.setMonth(start.getMonth() - 6);
  if (preset === "12m") start.setMonth(start.getMonth() - 12);
  if (preset === "ytd") start = yearStart;

  $("startDate").value = start.toISOString().slice(0,10);
  $("endDate").value = new Date(end.getFullYear(), end.getMonth()+1, 0).toISOString().slice(0,10);
}

// -------------- export resumo --------------
function exportResumoCsv(){
  const table = $("tblResumo");
  const lines = [];
  table.querySelectorAll("tr").forEach(tr => {
    const cells = Array.from(tr.children).map(td => {
      const txt = td.textContent.replace(/\s+/g," ").trim();
      return `"${txt.replace(/"/g,'""')}"`;
    });
    lines.push(cells.join(","));
  });

  const blob = new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "resumo_mensal_tarifas_multiunidade.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// -------------- init --------------
async function reloadAll(){
  try{
    setStatus("Carregando unidades...");
    const selectedUnits = Array.from($("units").selectedOptions).map(o=>o.value);
    const mode = $("mode").value;

    // buscar pivots que ainda não foram carregados
    const toLoad = selectedUnits
      .map(k => UNITS.find(u => u.key === k))
      .filter(u => u && !PIVOTS[u.key]);

    for (const unit of toLoad){
      setStatus(`Carregando: ${unit.name}...`);
      PIVOTS[unit.key] = await fetchPivot(unit);
    }

    // consolidar
    CONS = consolidate(selectedUnits);

    // preencher denominações (do consolidado)
    const sel = $("denoms");
    sel.innerHTML = "";
    CONS.denoms.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      opt.selected = true;
      sel.appendChild(opt);
    });

    // datas default
    $("startDate").value = CONS.months[0] + "-01";
    $("endDate").value = CONS.months[CONS.months.length-1] + "-01";

    // nota do modo
    $("noteTotal").textContent = (mode === "compare")
      ? "Comparação: total mensal por unidade (linhas)"
      : "Consolidado: Total vs Mediana 3m";

    setStatus(`OK: ${selectedUnits.length} unidade(s) | ${CONS.denoms.length} denominações | ${CONS.months.length} meses.`);
    applyFilters();
  } catch (err){
    console.error(err);
    setStatus(err.message || String(err));
  }
}

function init(){
  // montar lista de unidades
  const unitsSel = $("units");
  unitsSel.innerHTML = "";
  UNITS.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.key;
    opt.textContent = u.name;
    unitsSel.appendChild(opt);
  });

  // carregar defaults da URL
  const { u, mode } = parseParams();

  // selecionar unidades
  Array.from(unitsSel.options).forEach(o => { o.selected = u.includes(o.value); });
  // se nenhuma foi marcada, marca SC
  if (!Array.from(unitsSel.selectedOptions).length){
    const opt = Array.from(unitsSel.options).find(o => o.value === "SC");
    if (opt) opt.selected = true;
  }

  $("mode").value = mode;

  $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
  $("threshold").addEventListener("input", () => {
    $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
  });

  $("preset").addEventListener("change", () => applyPreset($("preset").value));

  $("btnReload").addEventListener("click", (e) => { e.preventDefault(); reloadAll(); });
  $("btnApply").addEventListener("click", (e) => { e.preventDefault(); applyFilters(); });
  $("btnReset").addEventListener("click", (e) => {
    e.preventDefault();
    $("preset").value = "custom";
    Array.from($("denoms").options).forEach(o=>o.selected=true);
    applyFilters();
  });
  $("btnExport").addEventListener("click", (e) => { e.preventDefault(); exportResumoCsv(); });

  // se o usuário mudar unidade ou modo, recarrega e consolida novamente
  $("units").addEventListener("change", () => reloadAll());
  $("mode").addEventListener("change", () => reloadAll());

  // boot
  reloadAll();
}

init();  }
  if (field.length || cur.length) {
    cur.push(field);
    if (cur.some(v => String(v).trim() !== "")) rows.push(cur);
  }
  return rows;
}

function norm(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .trim();
}

function looksLikeMonth(s) {
  const v = norm(s);
  return /^\d{4}-\d{2}$/.test(v);
}

function toNumberBR(s) {
  const v = norm(s);
  if (!v) return NaN;
  const cleaned = v.replace(/R\$\s?/g, "").replace(/\s/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) return Number(cleaned.replace(/\./g, "").replace(",", "."));
  if (cleaned.includes(",") && !cleaned.includes(".")) return Number(cleaned.replace(/\./g, "").replace(",", "."));
  return Number(cleaned);
}

function median(arr) {
  const a = arr.filter(x => Number.isFinite(x)).slice().sort((x,y)=>x-y);
  if (!a.length) return NaN;
  const mid = Math.floor(a.length/2);
  return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
}

function rollingMedian(values, window=3) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    out.push(median(values.slice(start, i+1)));
  }
  return out;
}

function fmtBRL(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

// -------------------------
// State
// -------------------------
let MODE = "pivot"; // pivot | rows
let PIVOT = null;
let chartTotal = null;
let chartDenom = null;

// -------------------------
// Tables
// -------------------------
function buildResumoTable(months, denoms, matrix) {
  const thead = $("tblResumo").querySelector("thead");
  const tbody = $("tblResumo").querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

  const trh = document.createElement("tr");
  const th0 = document.createElement("th"); th0.textContent = "Denominação"; trh.appendChild(th0);
  for (const m of months) { const th = document.createElement("th"); th.textContent = m; trh.appendChild(th); }
  const thT = document.createElement("th"); thT.textContent = "Total"; trh.appendChild(thT);
  thead.appendChild(trh);

  for (let i = 0; i < denoms.length; i++) {
    const tr = document.createElement("tr");
    const td0 = document.createElement("td");
    td0.className = "tag";
    td0.innerHTML = `<span class="chip">${denoms[i]}</span>`;
    tr.appendChild(td0);

    const row = matrix[i];
    const rowMax = Math.max(...row, 0.000001);
    let rowSum = 0;

    for (let j = 0; j < months.length; j++) {
      const v = row[j] || 0;
      rowSum += v;
      const td = document.createElement("td");
      td.className = "num";
      const ratio = v / rowMax;
      const alpha = 0.06 + 0.28*ratio;
      td.style.background = `rgba(46,125,50,${alpha})`;
      td.textContent = v ? fmtBRL(v) : "—";
      tr.appendChild(td);
    }

    const tdT = document.createElement("td");
    tdT.className = "num";
    tdT.textContent = fmtBRL(rowSum);
    tr.appendChild(tdT);

    tbody.appendChild(tr);
  }
}

function buildOutliersTable(months, totalByMonth, med3, threshold) {
  const thead = $("tblOutliers").querySelector("thead");
  const tbody = $("tblOutliers").querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

  const trh = document.createElement("tr");
  ["Mês","Total","Mediana 3m","Status"].forEach(h => {
    const th = document.createElement("th"); th.textContent = h; trh.appendChild(th);
  });
  thead.appendChild(trh);

  for (let i = 0; i < months.length; i++) {
    const tot = totalByMonth[i];
    const med = med3[i];
    const isOut = Number.isFinite(med) && tot > med * threshold;

    const tr = document.createElement("tr");
    const tdM = document.createElement("td"); tdM.textContent = months[i]; tr.appendChild(tdM);
    const tdT = document.createElement("td"); tdT.className="num"; tdT.textContent = fmtBRL(tot); tr.appendChild(tdT);
    const tdMed = document.createElement("td"); tdMed.className="num"; tdMed.textContent = fmtBRL(med); tr.appendChild(tdMed);

    const tdS = document.createElement("td");
    tdS.innerHTML = isOut ? `<span class="badgeWarn">ACIMA</span>` : `<span style="color: rgba(30,42,36,.55)">—</span>`;
    tr.appendChild(tdS);

    if (isOut) tdT.style.background = "rgba(249,168,37,.18)";
    tbody.appendChild(tr);
  }
}

function buildDetailTablePivot(denoms, totals) {
  const thead = $("tblDetalhe").querySelector("thead");
  const tbody = $("tblDetalhe").querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

  const trh = document.createElement("tr");
  ["Denominação","Total no período"].forEach(h => {
    const th = document.createElement("th"); th.textContent = h; trh.appendChild(th);
  });
  thead.appendChild(trh);

  const pairs = denoms.map((d,i)=>({d, t: totals[i]})).sort((a,b)=>b.t-a.t);
  const maxRows = 100;
  for (const p of pairs.slice(0, maxRows)) {
    const tr = document.createElement("tr");
    const tdD = document.createElement("td"); tdD.innerHTML = `<span class="chip">${p.d}</span>`; tr.appendChild(tdD);
    const tdT = document.createElement("td"); tdT.className="num"; tdT.textContent = fmtBRL(p.t); tr.appendChild(tdT);
    tbody.appendChild(tr);
  }
  $("countPill").textContent = `${pairs.length.toLocaleString("pt-BR")} denominações (top ${Math.min(maxRows,pairs.length)})`;
}

// -------------------------
// Charts
// -------------------------
function renderCharts(months, totalByMonth, med3, denoms, matrix) {
  const ctx1 = $("chartTotal");
  if (chartTotal) chartTotal.destroy();
  chartTotal = new Chart(ctx1, {
    type: "line",
    data: {
      labels: months,
      datasets: [
        { label: "Total mensal", data: totalByMonth, borderColor:"#2E7D32", backgroundColor:"rgba(46,125,50,.08)", borderWidth: 2, pointRadius: 2, tension: .25 },
        { label: "Mediana móvel (3m)", data: med3, borderColor:"#66BB6A", borderWidth: 2, pointRadius: 2, borderDash: [6,6], tension: .25 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#1E2A24" } } },
      scales: {
        x: { ticks: { color: "#6B7C73" }, grid: { color: "rgba(30,42,36,.10)" } },
        y: { ticks: { color: "#6B7C73", callback: (v)=> (Number(v)).toLocaleString("pt-BR") }, grid: { color: "rgba(30,42,36,.10)" } },
      }
    }
  });

  const ctx2 = $("chartDenom");
  if (chartDenom) chartDenom.destroy();

  // Ordena denominações pelo total no período e mostra as TOP 10
  const totalsByDenom = denoms.map((d, i) => matrix[i].reduce((a,b)=>a+b,0));
  const order = totalsByDenom.map((t,i)=>({t,i})).sort((a,b)=>b.t-a.t).slice(0,10).map(x=>x.i);

  const datasets = order.map((i) => ({
    label: denoms[i],
    data: matrix[i],
    borderWidth: 2,
    pointRadius: 1.5,
    tension: .25
  }));

  chartDenom = new Chart(ctx2, {
    type: "line",
    data: { labels: months, datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#1E2A24" } } },
      scales: {
        x: { ticks: { color: "#6B7C73" }, grid: { color: "rgba(30,42,36,.10)" } },
        y: { ticks: { color: "#6B7C73", callback: (v)=> (Number(v)).toLocaleString("pt-BR") }, grid: { color: "rgba(30,42,36,.10)" } },
      }
    }
  });

  const totalAll = totalByMonth.reduce((a,b)=>a+b,0);
  $("totalPill").textContent = `Total no período: ${fmtBRL(totalAll)}`;
  $("denomPill").textContent = `${denoms.length} denominações (gráfico mostra top 10)`;
}

// -------------------------
// Load pivot
// -------------------------
async function loadDataPivot(csvUrl) {
  setStatus("Carregando CSV...");
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao carregar CSV. Confirme se a planilha está pública.");

  const text = await res.text();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV vazio.");

  // encontrar header: primeira linha que contenha "Denominação" e pelo menos 2 colunas YYYY-MM
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i].map(norm);
    const denomIdx = r.findIndex(x => x.toLowerCase().includes("denom"));
    if (denomIdx < 0) continue;
    const monthsCount = r.filter(looksLikeMonth).length;
    if (monthsCount >= 2) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    throw new Error("CSV não está no formato pivot esperado: Denominação | YYYY-MM | YYYY-MM ...");
  }

  const header = rows[headerIdx].map(norm);
  const dataRows = rows.slice(headerIdx + 1);

  const denomColIdx = header.findIndex(h => h.toLowerCase().includes("denom"));
  const monthCols = header
    .map((h, idx) => ({ h: norm(h), idx }))
    .filter(x => looksLikeMonth(x.h));

  const months = monthCols.map(x => x.h);
  const denoms = [];
  const matrix = [];

  for (const r0 of dataRows) {
    const r = r0.map(norm);
    const denom = norm(r[denomColIdx]);
    if (!denom) continue;
    denoms.push(denom);

    const row = monthCols.map((mc) => {
      const v = toNumberBR(r[mc.idx]);
      // sempre positivo no dashboard
      return Number.isFinite(v) ? Math.abs(v) : 0;
    });
    matrix.push(row);
  }

  if (!denoms.length) throw new Error("Não encontrei linhas com denominação/valores.");

  PIVOT = { months, denoms, matrix };

  // preencher filtro de denominações
  const sel = $("denoms");
  sel.innerHTML = "";
  denoms.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    opt.selected = true;
    sel.appendChild(opt);
  });

  // datas default = início e fim dos meses disponíveis
  $("startDate").value = months[0] + "-01";
  $("endDate").value = months[months.length-1] + "-01";

  setStatus(`OK: ${denoms.length.toLocaleString("pt-BR")} denominações | ${months.length} meses.`);
}

// -------------------------
// Apply filters (pivot)
// -------------------------
function applyFilters() {
  const threshold = Number($("threshold").value);
  const selectedDenoms = Array.from($("denoms").selectedOptions).map(o=>o.value);

  if (!PIVOT) return;

  const startYM = $("startDate").value ? $("startDate").value.slice(0,7) : null;
  const endYM = $("endDate").value ? $("endDate").value.slice(0,7) : null;

  let months = PIVOT.months.slice();
  if (startYM) months = months.filter(m => m >= startYM);
  if (endYM) months = months.filter(m => m <= endYM);

  const monthIndex = months.map(m => PIVOT.months.indexOf(m));

  const keepDenomIdx = PIVOT.denoms
    .map((d,i)=>({d,i}))
    .filter(x => selectedDenoms.length ? selectedDenoms.includes(x.d) : true)
    .map(x => x.i);

  const denoms = keepDenomIdx.map(i => PIVOT.denoms[i]);
  const matrix = keepDenomIdx.map(i => monthIndex.map(j => PIVOT.matrix[i][j] || 0));

  const totalByMonth = months.map((m, mi) => matrix.reduce((acc,row)=>acc+(row[mi]||0),0));
  const med3 = rollingMedian(totalByMonth, 3);

  buildResumoTable(months, denoms, matrix);
  buildOutliersTable(months, totalByMonth, med3, threshold);

  const totalsByDenom = denoms.map((d, i) => matrix[i].reduce((a,b)=>a+b,0));
  buildDetailTablePivot(denoms, totalsByDenom);

  renderCharts(months, totalByMonth, med3, denoms, matrix);

  setStatus(`Aplicado: ${denoms.length} denominações | ${months.length} meses | limiar ${threshold.toFixed(2)}×.`);
}

function exportResumoCsv() {
  const table = $("tblResumo");
  const lines = [];
  const trs = table.querySelectorAll("tr");
  trs.forEach(tr => {
    const cells = Array.from(tr.children).map(td => {
      const txt = td.textContent.replace(/\s+/g," ").trim();
      return `"${txt.replace(/"/g,'""')}"`;
    });
    lines.push(cells.join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "resumo_mensal_tarifas.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function applyPreset(preset) {
  if (preset === "custom" || !PIVOT) return;

  const months = PIVOT.months;
  if (preset === "all") {
    $("startDate").value = months[0] + "-01";
    $("endDate").value = months[months.length-1] + "-01";
    return;
  }

  const endM = months[months.length-1];
  const end = new Date(endM + "-01T00:00:00");
  let start = new Date(end);
  const yearStart = new Date(end.getFullYear(), 0, 1);

  if (preset === "3m") start.setMonth(start.getMonth() - 3);
  if (preset === "6m") start.setMonth(start.getMonth() - 6);
  if (preset === "12m") start.setMonth(start.getMonth() - 12);
  if (preset === "ytd") start = yearStart;

  $("startDate").value = start.toISOString().slice(0,10);
  $("endDate").value = new Date(end.getFullYear(), end.getMonth()+1, 0).toISOString().slice(0,10);
}

function init() {
  $("csvUrl").value = DEFAULT_CSV_URL || "";
  $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;

  $("threshold").addEventListener("input", () => {
    $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
  });

  $("preset").addEventListener("change", () => applyPreset($("preset").value));

  $("btnReload").addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await loadDataPivot($("csvUrl").value.trim());
      applyFilters();
    } catch (err) {
      setStatus(String(err.message || err));
      console.error(err);
    }
  });

  $("btnApply").addEventListener("click", (e) => {
    e.preventDefault();
    try { applyFilters(); } catch (err) { setStatus(String(err.message || err)); }
  });

  $("btnReset").addEventListener("click", (e) => {
    e.preventDefault();
    $("preset").value = "custom";
    Array.from($("denoms").options).forEach(o=>o.selected=true);
    applyFilters();
  });

  $("btnExport").addEventListener("click", (e) => {
    e.preventDefault();
    exportResumoCsv();
  });

  // Auto-load on open
  (async () => {
    if (!DEFAULT_CSV_URL) return;
    try {
      await loadDataPivot(DEFAULT_CSV_URL);
      applyFilters();
    } catch (err) {
      setStatus(String(err.message || err));
      console.error(err);
    }
  })();
}

init();
