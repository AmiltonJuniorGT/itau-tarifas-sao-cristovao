const $ = (id) => document.getElementById(id);

const UNITS = [
  {
    key: "SC",
    name: "São Cristóvão BA",
    csv: "https://docs.google.com/spreadsheets/d/1g9rTDldOUzgcVWKrvw1IGZ2RlhItF5gh/gviz/tq?tqx=out:csv&gid=1092717054"
  },
  {
    key: "CAJ",
    name: "Cajazeiras BA",
    csv: "https://docs.google.com/spreadsheets/d/1dPt6Y1Mb1Yrzb0e3Z9U7Mc0fcVBVmcHq/gviz/tq?tqx=out:csv&gid=1825385594"
  },
  {
    key: "CAM",
    name: "Camaçari BA",
    csv: "https://docs.google.com/spreadsheets/d/1d5LLNN1lShh61EHxS93vCuFKzTH3qwcM/gviz/tq?tqx=out:csv&gid=551763344"
  },
  {
    key: "GAMA",
    name: "Gama - DF",
    csv: "https://docs.google.com/spreadsheets/d/1GJ92lsbf-mI-IYGfhCChiXCCnTN50Jln/export?format=csv&gid=405964068"
  }
];

let selectedUnits = [];
let PIVOTS = {};
let CONS = null;
let chartTotal = null;
let chartDenom = null;

function parseParams(){
  const p = new URLSearchParams(location.search);
  const rawUnits = (p.get("u") || "SC").split(",").map(s => s.trim()).filter(Boolean);
  const valid = rawUnits.filter(k => UNITS.some(u => u.key === k));
  return {
    u: valid.length ? valid : ["SC"],
    mode: (p.get("mode") || "sum").toLowerCase() === "compare" ? "compare" : "sum"
  };
}

function setParams(units, mode){
  const p = new URLSearchParams(location.search);
  p.set("u", units.join(","));
  p.set("mode", mode);
  history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}

function setStatus(msg){
  $("status").textContent = msg || "—";
  $("status2").textContent = msg || "";
}

function norm(s){
  return String(s ?? "").replace(/\u00A0/g, " ").trim();
}

function looksLikeMonth(s){
  return /^\d{4}-\d{2}$/.test(norm(s));
}

function toNumberBR(s){
  let v = norm(s);
  if (!v || v === "-" || v === "—") return 0;

  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }

  v = v.replace(/R\$\s?/g, "").replace(/\s/g, "");
  if (v.includes(",") && v.includes(".")) v = v.replace(/\./g, "").replace(",", ".");
  else if (v.includes(",") && !v.includes(".")) v = v.replace(",", ".");

  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

function median(arr){
  const a = arr.filter(x => Number.isFinite(x)).slice().sort((x,y) => x-y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length/2);
  return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
}

function rollingMedian(values, window=3){
  return values.map((_, i) => median(values.slice(Math.max(0, i-window+1), i+1)));
}

function fmtBRL(n){
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

function parseCsv(text){
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let cur = [], field = "", inQuotes = false;

  for (let i=0; i<text.length; i++){
    const ch = text[i];
    if (ch === '"'){
      if (inQuotes && text[i+1] === '"'){ field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes){
      cur.push(field); field = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes){
      if (ch === "\r" && text[i+1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.some(v => norm(v) !== "")) rows.push(cur);
      cur = [];
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

function setUnitsButtonText(){
  const names = selectedUnits.map(k => UNITS.find(u => u.key === k)?.name || k);
  if (!names.length) $("unitsBtnText").textContent = "Selecione...";
  else if (names.length === 1) $("unitsBtnText").textContent = names[0];
  else $("unitsBtnText").textContent = `${names.length} unidades selecionadas`;
}

function getCheckedUnits(){
  return Array.from($("unitsMenu").querySelectorAll("input[type=checkbox]"))
    .filter(x => x.checked)
    .map(x => x.value);
}

function buildUnitsMenu(defaults){
  const menu = $("unitsMenu");
  menu.innerHTML = "";

  UNITS.forEach(u => {
    const row = document.createElement("label");
    row.className = "mselItem";
    row.innerHTML = `
      <input type="checkbox" value="${u.key}">
      <span>${u.name}</span>
      <span class="mselPill" style="margin-left:auto">${u.key}</span>
    `;

    const cb = row.querySelector("input");
    cb.checked = defaults.includes(u.key);

    cb.addEventListener("change", async () => {
      selectedUnits = getCheckedUnits();

      if (!selectedUnits.length) {
        cb.checked = true;
        selectedUnits = [u.key];
      }

      setUnitsButtonText();
      await reloadAll();
    });

    menu.appendChild(row);
  });

  selectedUnits = defaults.length ? defaults.slice() : ["SC"];
  setUnitsButtonText();
}

function bindUnitsDropdown(){
  const btn = $("unitsBtn");
  const menu = $("unitsMenu");

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = menu.classList.toggle("open");
    menu.setAttribute("aria-hidden", open ? "false" : "true");
  });

  menu.addEventListener("click", e => e.stopPropagation());

  document.addEventListener("click", () => {
    menu.classList.remove("open");
    menu.setAttribute("aria-hidden", "true");
  });
}

async function fetchPivot(unit){
  const res = await fetch(unit.csv, { cache:"no-store" });
  if (!res.ok) throw new Error(`${unit.name}: falha HTTP ${res.status}`);

  const text = await res.text();

  if (/^\s*</.test(text)) {
    throw new Error(`${unit.name}: o Google retornou HTML, não CSV. Verifique se a planilha está pública.`);
  }

  const rows = parseCsv(text);
  if (!rows.length) throw new Error(`${unit.name}: CSV vazio.`);

  let headerIdx = -1;
  for (let i=0; i<Math.min(rows.length, 50); i++){
    const r = rows[i].map(norm);
    const denomIdx = r.findIndex(x => x.toLowerCase().includes("denom"));
    if (denomIdx < 0) continue;
    if (r.filter(looksLikeMonth).length >= 2) { headerIdx = i; break; }
  }

  if (headerIdx < 0) {
    const first = rows.slice(0, 3).map(r => r.join(" | ")).join(" / ");
    throw new Error(`${unit.name}: não encontrei cabeçalho Denominação + meses YYYY-MM. Primeiras linhas: ${first.slice(0, 180)}`);
  }

  const header = rows[headerIdx].map(norm);
  const dataRows = rows.slice(headerIdx + 1);
  const denomColIdx = header.findIndex(h => h.toLowerCase().includes("denom"));
  const monthCols = header.map((h, idx) => ({ h:norm(h), idx })).filter(x => looksLikeMonth(x.h));
  const months = monthCols.map(x => x.h);
  const denoms = [];
  const matrix = [];

  for (const r0 of dataRows){
    const r = r0.map(norm);
    const denom = norm(r[denomColIdx]);
    if (!denom) continue;

    const row = monthCols.map(mc => Math.abs(toNumberBR(r[mc.idx])));
    if (row.every(v => v === 0)) continue;

    denoms.push(denom);
    matrix.push(row);
  }

  if (!denoms.length) throw new Error(`${unit.name}: sem linhas com valores.`);
  return { months, denoms, matrix };
}

function consolidate(unitKeys){
  const pivs = unitKeys.map(k => ({ key:k, piv:PIVOTS[k] })).filter(x => x.piv);

  const months = Array.from(new Set(pivs.flatMap(x => x.piv.months))).sort();
  const denoms = Array.from(new Set(pivs.flatMap(x => x.piv.denoms))).sort();

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

    byUnitMonthly[key] = months.map((_, mi) => {
      const srcMi = monthIndex[mi];
      if (srcMi < 0) return 0;
      return piv.matrix.reduce((acc, row) => acc + (row[srcMi] || 0), 0);
    });
  });

  const matrix = denoms.map(d => months.map(m => sumMap.get(`${d}||${m}`) || 0));
  return { months, denoms, matrix, byUnitMonthly };
}

function buildResumoTable(months, denoms, matrix){
  const thead = $("tblResumo").querySelector("thead");
  const tbody = $("tblResumo").querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

  const trh = document.createElement("tr");
  ["Denominação", ...months, "Total"].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  denoms.forEach((d, i) => {
    const tr = document.createElement("tr");
    const td0 = document.createElement("td");
    td0.className = "tag";
    td0.innerHTML = `<span class="chip">${d}</span>`;
    tr.appendChild(td0);

    const row = matrix[i];
    const rowMax = Math.max(...row, 0.000001);
    let rowSum = 0;

    row.forEach(v => {
      rowSum += v;
      const td = document.createElement("td");
      td.className = "num";
      const alpha = 0.06 + 0.28 * (v / rowMax);
      td.style.background = `rgba(46,125,50,${alpha})`;
      td.textContent = v ? fmtBRL(v) : "—";
      tr.appendChild(td);
    });

    const tdT = document.createElement("td");
    tdT.className = "num";
    tdT.textContent = fmtBRL(rowSum);
    tr.appendChild(tdT);
    tbody.appendChild(tr);
  });
}

function buildOutliersTable(months, totalByMonth, med3, threshold){
  const thead = $("tblOutliers").querySelector("thead");
  const tbody = $("tblOutliers").querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

  const trh = document.createElement("tr");
  ["Mês","Total","Mediana 3m","Status"].forEach(h => {
    const th = document.createElement("th"); th.textContent = h; trh.appendChild(th);
  });
  thead.appendChild(trh);

  months.forEach((m, i) => {
    const tot = totalByMonth[i];
    const med = med3[i];
    const isOut = Number.isFinite(med) && med > 0 && tot > med * threshold;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m}</td>
      <td class="num">${fmtBRL(tot)}</td>
      <td class="num">${fmtBRL(med)}</td>
      <td>${isOut ? '<span class="badgeWarn">ACIMA</span>' : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function buildDetailTable(denoms, totals){
  const thead = $("tblDetalhe").querySelector("thead");
  const tbody = $("tblDetalhe").querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

  const trh = document.createElement("tr");
  ["Denominação","Total no período"].forEach(h => {
    const th = document.createElement("th"); th.textContent = h; trh.appendChild(th);
  });
  thead.appendChild(trh);

  const pairs = denoms.map((d,i) => ({ d, t: totals[i] })).sort((a,b) => b.t-a.t);
  pairs.slice(0, 120).forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><span class="chip">${p.d}</span></td><td class="num">${fmtBRL(p.t)}</td>`;
    tbody.appendChild(tr);
  });

  $("countPill").textContent = `${pairs.length.toLocaleString("pt-BR")} denominações`;
}

function renderCharts(months, totalByMonth, med3, denoms, matrix){
  const mode = $("mode").value;

  if (chartTotal) chartTotal.destroy();
  const datasetsTotal = [];

  if (mode === "compare" && CONS?.byUnitMonthly) {
    $("noteTotal").textContent = "Comparação: total mensal por unidade";
    selectedUnits.forEach(uk => {
      const unit = UNITS.find(u => u.key === uk);
      datasetsTotal.push({
        label: unit ? unit.name : uk,
        data: CONS.byUnitMonthly[uk] || months.map(() => 0),
        borderWidth: 2,
        pointRadius: 2,
        tension: .25
      });
    });
  } else {
    $("noteTotal").textContent = "Consolidado: Total mensal vs Mediana 3m";
    datasetsTotal.push(
      { label:"Total mensal", data:totalByMonth, borderColor:"#2E7D32", backgroundColor:"rgba(46,125,50,.08)", borderWidth:2, pointRadius:2, tension:.25 },
      { label:"Mediana móvel (3m)", data:med3, borderColor:"#66BB6A", borderWidth:2, pointRadius:2, borderDash:[6,6], tension:.25 }
    );
  }

  chartTotal = new Chart($("chartTotal"), {
    type:"line",
    data:{ labels:months, datasets:datasetsTotal },
    options:{
      responsive:true,
      plugins:{ legend:{ labels:{ color:"#1E2A24" } } },
      scales:{
        x:{ ticks:{ color:"#6B7C73" }, grid:{ color:"rgba(30,42,36,.10)" } },
        y:{ ticks:{ color:"#6B7C73", callback:v => Number(v).toLocaleString("pt-BR") }, grid:{ color:"rgba(30,42,36,.10)" } }
      }
    }
  });

  if (chartDenom) chartDenom.destroy();

  const totalsByDenom = denoms.map((_, i) => matrix[i].reduce((a,b) => a+b, 0));
  const order = totalsByDenom.map((t,i) => ({t,i})).sort((a,b) => b.t-a.t).slice(0,10).map(x => x.i);

  chartDenom = new Chart($("chartDenom"), {
    type:"line",
    data:{
      labels:months,
      datasets:order.map(i => ({
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
        y:{ ticks:{ color:"#6B7C73", callback:v => Number(v).toLocaleString("pt-BR") }, grid:{ color:"rgba(30,42,36,.10)" } }
      }
    }
  });

  const totalAll = totalByMonth.reduce((a,b) => a+b, 0);
  $("totalPill").textContent = `Total: ${fmtBRL(totalAll)}`;
  $("denomPill").textContent = `${denoms.length} denominações`;
}

function applyFilters(){
  if (!CONS) return;

  const threshold = Number($("threshold").value);
  const startYM = $("startDate").value ? $("startDate").value.slice(0,7) : null;
  const endYM = $("endDate").value ? $("endDate").value.slice(0,7) : null;

  let months = CONS.months.slice();
  if (startYM) months = months.filter(m => m >= startYM);
  if (endYM) months = months.filter(m => m <= endYM);
  const monthIndex = months.map(m => CONS.months.indexOf(m));

  const selectedDenoms = Array.from($("denoms").selectedOptions).map(o => o.value);
  const keepDenomIdx = CONS.denoms
    .map((d,i) => ({d,i}))
    .filter(x => selectedDenoms.length ? selectedDenoms.includes(x.d) : true)
    .map(x => x.i);

  const denoms = keepDenomIdx.map(i => CONS.denoms[i]);
  const matrix = keepDenomIdx.map(i => monthIndex.map(j => CONS.matrix[i][j] || 0));

  const totalByMonth = months.map((_, mi) => matrix.reduce((acc,row) => acc + (row[mi] || 0), 0));
  const med3 = rollingMedian(totalByMonth, 3);

  buildResumoTable(months, denoms, matrix);
  buildOutliersTable(months, totalByMonth, med3, threshold);

  const totalsByDenom = denoms.map((_, i) => matrix[i].reduce((a,b) => a+b, 0));
  buildDetailTable(denoms, totalsByDenom);
  renderCharts(months, totalByMonth, med3, denoms, matrix);

  setParams(selectedUnits, $("mode").value);
  setStatus(`Aplicado: ${selectedUnits.length} unidade(s) | ${denoms.length} despesas | ${months.length} meses`);
}

function applyPreset(preset){
  if (!CONS || preset === "custom") return;
  const months = CONS.months;
  if (!months.length) return;

  if (preset === "all"){
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

function exportResumoCsv(){
  const table = $("tblResumo");
  const lines = [];
  table.querySelectorAll("tr").forEach(tr => {
    const cells = Array.from(tr.children).map(td => `"${td.textContent.replace(/\s+/g," ").trim().replace(/"/g,'""')}"`);
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

async function reloadAll(){
  try{
    setStatus("Carregando unidades...");

    const errors = [];
    const loadedKeys = [];

    for (const key of selectedUnits){
      const unit = UNITS.find(u => u.key === key);
      if (!unit) continue;

      if (!PIVOTS[key]) {
        setStatus(`Carregando: ${unit.name}...`);
        try {
          PIVOTS[key] = await fetchPivot(unit);
        } catch (err) {
          errors.push(err.message || String(err));
          delete PIVOTS[key];
        }
      }

      if (PIVOTS[key]) loadedKeys.push(key);
    }

    if (!loadedKeys.length) {
      setStatus(`Erro: nenhuma unidade carregou. ${errors.join(" | ")}`);
      return;
    }

    selectedUnits = loadedKeys;
    setUnitsButtonText();
    syncUnitCheckboxes();

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

    applyFilters();

    if (errors.length) {
      setStatus(`Carregado com aviso: ${loadedKeys.join(", ")}. Falhou: ${errors.join(" | ")}`);
    }
  } catch (err){
    console.error(err);
    setStatus(err.message || String(err));
  }
}

function syncUnitCheckboxes(){
  $("unitsMenu").querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.checked = selectedUnits.includes(cb.value);
  });
}

function init(){
  const { u, mode } = parseParams();

  buildUnitsMenu(u);
  bindUnitsDropdown();
  $("mode").value = mode;

  $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
  $("threshold").addEventListener("input", () => {
    $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
  });

  $("preset").addEventListener("change", () => applyPreset($("preset").value));
  $("mode").addEventListener("change", reloadAll);
  $("btnReload").addEventListener("click", reloadAll);
  $("btnApply").addEventListener("click", applyFilters);
  $("btnReset").addEventListener("click", () => {
    $("preset").value = "custom";
    Array.from($("denoms").options).forEach(o => o.selected = true);
    applyFilters();
  });
  $("btnExport").addEventListener("click", exportResumoCsv);

  reloadAll();
}

init();
