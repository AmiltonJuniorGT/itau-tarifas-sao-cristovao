/* Dashboard — Tarifas/Taxas Itaú
   - Carrega CSV público
   - Classifica “denominação”
   - Agrega por mês
   - Mediana móvel 3m
   - Outliers acima do limiar (default 1.20×)
*/

const $ = (id) => document.getElementById(id);

const DEFAULT_CSV_URL = "https://docs.google.com/spreadsheets/d/1g9rTDldOUzgcVWKrvw1IGZ2RlhItF5gh/export?format=csv&gid=1092717054"; // opcional: cole seu CSV público aqui para já abrir automaticamente

// =====================
// Regras de classificação
// =====================
function categorize(raw) {
  const d = String(raw || "").trim().toUpperCase();

  // Ajuste aqui conforme seu extrato
  if (d.includes("TAR/CUSTAS COBRAN") || (d.includes("CUSTAS") && d.includes("COBRAN"))) return "Tarifa/Custas de Cobrança";
  if (d.includes("TAR PIX")) return "Tarifa PIX";
  if (d.includes("CTA GAR") || d.includes("CONTR/RENOV CTA GAR")) return "Tarifa Contrato/Renov. Cta Garantida";
  if (d.startsWith("IOF")) return "IOF";
  if (d.startsWith("JUROS")) return "Juros";
  if (d.includes("PLANO ADAPT")) return "Tarifa Plano Adapt";

  // fallback: mantém a descrição original (ou você pode agrupar mais agressivamente)
  return String(raw || "").trim() || "Outros";
}

// “Taxas e tarifas” — filtro textual (mantém só candidatos típicos)
const INCLUDE_RE = /(\bTAR\b|TAR\/|TARIFA|CUSTAS|IOF|JUROS|ENCARG|MANUT|PACOTE|CESTA|CONTR\/RENOV|LIMITE)/i;
const EXCLUDE_RE = /(SISPAG|FORNECEDORES|SALARIOS|TRIBUTOS|PAGAMENTO|PIX DEVOLVIDO|BUSINESS)/i;

// =====================
// CSV loader
// =====================
function parseCsv(text) {
  // CSV simples (Itaú/Sheets), com aspas
  const rows = [];
  let cur = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i+1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cur.push(field); field = "";
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i+1] === '\n') i++;
      cur.push(field); field = "";
      if (cur.some(v => v !== "")) rows.push(cur);
      cur = [];
    } else {
      field += ch;
    }
  }
  if (field.length || cur.length) { cur.push(field); if (cur.some(v => v !== "")) rows.push(cur); }
  return rows;
}

function toDateBR(s) {
  // aceita dd/mm/yyyy ou yyyy-mm-dd
  const v = String(s || "").trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00");
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
}

function toNumberBR(s) {
  // aceita -1.234,56 ou -1234.56
  const v = String(s ?? "").trim();
  if (!v) return NaN;
  // remove R$ e espaços
  const cleaned = v.replace(/R\$\s?/g, "").replace(/\s/g, "");
  // se tem vírgula como decimal
  if (cleaned.includes(",") && !cleaned.includes(".")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  // se tem ponto e vírgula (milhar + decimal BR)
  if (cleaned.includes(",") && cleaned.includes(".")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  return Number(cleaned);
}

function ym(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
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
    const slice = values.slice(start, i+1);
    out.push(median(slice));
  }
  return out;
}

function fmtBRL(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// =====================
// State
// =====================
let RAW = [];        // linhas originais (lançamentos filtrados)
let DENOMS = [];     // lista de denominações
let MONTHS = [];     // meses disponíveis
let chartTotal = null;
let chartDenom = null;

// =====================
// UI Helpers
// =====================
function setStatus(msg) { $("status").textContent = msg || ""; }

function setDefaultDatesFromData(minDate, maxDate) {
  const toISO = (d) => d ? d.toISOString().slice(0,10) : "";
  $("startDate").value = toISO(minDate);
  $("endDate").value = toISO(maxDate);
}

function applyPreset(preset) {
  if (preset === "custom") return;
  const end = new Date();
  const start = new Date(end);
  const yearStart = new Date(end.getFullYear(), 0, 1);

  if (preset === "3m") start.setMonth(start.getMonth() - 3);
  if (preset === "6m") start.setMonth(start.getMonth() - 6);
  if (preset === "12m") start.setMonth(start.getMonth() - 12);
  if (preset === "ytd") start.setTime(yearStart.getTime());
  if (preset === "all") {
    // mantém como está; será ajustado pelo dataset ao aplicar
    return;
  }
  $("startDate").value = start.toISOString().slice(0,10);
  $("endDate").value = end.toISOString().slice(0,10);
}

// =====================
// Core analytics
// =====================
function filterRows(rows, startDate, endDate, selectedDenoms) {
  return rows.filter(r => {
    if (!(r.date instanceof Date)) return false;
    if (startDate && r.date < startDate) return false;
    if (endDate && r.date > endDate) return false;
    if (selectedDenoms?.length && !selectedDenoms.includes(r.denom)) return false;
    return true;
  });
}

function aggregateByMonth(rows) {
  // map month -> denom -> sum
  const monthsSet = new Set();
  const denomSet = new Set();
  const map = new Map();

  for (const r of rows) {
    const m = ym(r.date);
    monthsSet.add(m);
    denomSet.add(r.denom);
    const key = m + "||" + r.denom;
    map.set(key, (map.get(key) || 0) + r.amountAbs);
  }

  const months = Array.from(monthsSet).sort();
  const denoms = Array.from(denomSet).sort();

  const matrix = denoms.map(d => months.map(m => map.get(m + "||" + d) || 0));
  const totalByMonth = months.map((m, idx) => denoms.reduce((acc, d, di) => acc + matrix[di][idx], 0));

  return { months, denoms, matrix, totalByMonth };
}

function buildResumoTable(months, denoms, matrix) {
  // Header
  const thead = $("tblResumo").querySelector("thead");
  const tbody = $("tblResumo").querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trh = document.createElement("tr");
  const th0 = document.createElement("th"); th0.textContent = "Denominação"; trh.appendChild(th0);
  for (const m of months) {
    const th = document.createElement("th"); th.textContent = m; trh.appendChild(th);
  }
  const thT = document.createElement("th"); thT.textContent = "Total"; trh.appendChild(thT);
  thead.appendChild(trh);

  // Heat scale per row (makes spikes obvious)
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

      // color: green (low) -> yellow -> red (high) within row
      const ratio = v / rowMax; // 0..1
      // map ratio to hue: 140 (green) down to 0 (red)
      const hue = 140 - Math.round(140 * ratio);
      td.style.background = `hsla(${hue}, 75%, 40%, ${0.12 + 0.30*ratio})`;
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
  thead.innerHTML = "";
  tbody.innerHTML = "";

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
    const tdT = document.createElement("td"); tdT.className = "num"; tdT.textContent = fmtBRL(tot); tr.appendChild(tdT);
    const tdMed = document.createElement("td"); tdMed.className = "num"; tdMed.textContent = fmtBRL(med); tr.appendChild(tdMed);

    const tdS = document.createElement("td");
    if (isOut) tdS.innerHTML = `<span class="badgeWarn">ACIMA</span>`;
    else tdS.innerHTML = `<span style="color: rgba(234,240,255,.55)">—</span>`;
    tr.appendChild(tdS);

    if (isOut) {
      tdT.style.background = "rgba(251,191,36,.15)";
      tdT.style.borderBottomColor = "rgba(251,191,36,.25)";
    }

    tbody.appendChild(tr);
  }
}

function buildDetailTable(rows) {
  const thead = $("tblDetalhe").querySelector("thead");
  const tbody = $("tblDetalhe").querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trh = document.createElement("tr");
  ["Data","Denominação","Lançamento","Valor (R$)"].forEach(h => {
    const th = document.createElement("th"); th.textContent = h; trh.appendChild(th);
  });
  thead.appendChild(trh);

  const maxRows = 350;
  const view = rows.slice(0, maxRows).sort((a,b)=>b.date-a.date);

  for (const r of view) {
    const tr = document.createElement("tr");
    const tdD = document.createElement("td"); tdD.textContent = r.date.toLocaleDateString("pt-BR"); tr.appendChild(tdD);
    const tdDen = document.createElement("td"); tdDen.innerHTML = `<span class="chip">${r.denom}</span>`; tr.appendChild(tdDen);
    const tdL = document.createElement("td"); tdL.textContent = r.launch; tr.appendChild(tdL);
    const tdV = document.createElement("td"); tdV.className="num"; tdV.textContent = fmtBRL(r.amountAbs); tr.appendChild(tdV);
    tbody.appendChild(tr);
  }
  $("countPill").textContent = `${rows.length.toLocaleString("pt-BR")} lançamentos (mostrando ${Math.min(rows.length, maxRows)})`;
}

function renderCharts(months, totalByMonth, med3, denoms, matrix) {
  // Total chart
  const ctx1 = $("chartTotal");
  if (chartTotal) chartTotal.destroy();
  chartTotal = new Chart(ctx1, {
    type: "line",
    data: {
      labels: months,
      datasets: [
        { label: "Total mensal", data: totalByMonth, borderWidth: 2, pointRadius: 2, tension: .25 },
        { label: "Mediana móvel (3m)", data: med3, borderWidth: 2, pointRadius: 2, borderDash: [6,6], tension: .25 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "rgba(234,240,255,.85)" } } },
      scales: {
        x: { ticks: { color: "rgba(234,240,255,.7)" }, grid: { color: "rgba(234,240,255,.08)" } },
        y: { ticks: { color: "rgba(234,240,255,.7)", callback: (v)=> (Number(v)).toLocaleString("pt-BR") }, grid: { color: "rgba(234,240,255,.08)" } },
      }
    }
  });

  // Denom chart
  const ctx2 = $("chartDenom");
  if (chartDenom) chartDenom.destroy();

  const maxSeries = 10; // evita poluição; use filtro para reduzir
  const seriesDenoms = denoms.slice(0, maxSeries);
  const datasets = seriesDenoms.map((d, i) => ({
    label: d,
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
      plugins: { legend: { labels: { color: "rgba(234,240,255,.85)" } } },
      scales: {
        x: { ticks: { color: "rgba(234,240,255,.7)" }, grid: { color: "rgba(234,240,255,.08)" } },
        y: { ticks: { color: "rgba(234,240,255,.7)", callback: (v)=> (Number(v)).toLocaleString("pt-BR") }, grid: { color: "rgba(234,240,255,.08)" } },
      }
    }
  });

  const totalAll = totalByMonth.reduce((a,b)=>a+b,0);
  $("totalPill").textContent = `Total no período: ${fmtBRL(totalAll)}`;
  $("denomPill").textContent = `${denoms.length} denominações (gráfico mostra até ${maxSeries})`;
}

// =====================
// Main flow
// =====================
async function loadData(csvUrl) {
  if (!csvUrl) throw new Error("Informe a URL do CSV.");
  setStatus("Carregando CSV...");
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao carregar CSV (verifique se está público).");
  const text = await res.text();
  const rows = parseCsv(text);

  // Detect header row by finding "Data" and "Lançamento"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i].map(x => String(x||"").trim().toLowerCase());
    if (r.includes("data") && r.some(x => x.includes("lançamento") || x.includes("lancamento")) && r.some(x => x.includes("valor"))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const header = rows[headerIdx].map(h => String(h||"").trim());
  const dataRows = rows.slice(headerIdx + 1);

  const col = (nameCandidates) => {
    const idx = header.findIndex(h => nameCandidates.some(n => h.toLowerCase().includes(n)));
    return idx;
  };

  const iData = col(["data"]);
  const iLanc = col(["lançamento","lancamento"]);
  const iValor = col(["valor"]);
  if (iData < 0 || iLanc < 0 || iValor < 0) {
    throw new Error("Não consegui identificar colunas Data/Lançamento/Valor no CSV.");
  }

  const parsed = [];
  for (const r of dataRows) {
    const date = toDateBR(r[iData]);
    const launch = String(r[iLanc] || "").trim();
    const value = toNumberBR(r[iValor]);

    if (!date || !Number.isFinite(value) || !launch) continue;

    // Apenas débitos e candidatos a tarifa/taxa
    if (value >= 0) continue;
    if (!INCLUDE_RE.test(launch)) continue;
    if (EXCLUDE_RE.test(launch)) continue;

    const denom = categorize(launch);
    parsed.push({ date, launch, value, amountAbs: Math.abs(value), denom });
  }

  RAW = parsed;
  if (!RAW.length) throw new Error("Nenhuma tarifa/taxa encontrada após filtros. Ajuste INCLUDE/EXCLUDE/categorize().");

  const dates = RAW.map(r=>r.date.getTime()).sort((a,b)=>a-b);
  const minDate = new Date(dates[0]);
  const maxDate = new Date(dates[dates.length-1]);

  // Populate denom multiselect
  const denomList = Array.from(new Set(RAW.map(r=>r.denom))).sort();
  DENOMS = denomList;
  const sel = $("denoms");
  sel.innerHTML = "";
  for (const d of denomList) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    opt.selected = true; // default: todas
    sel.appendChild(opt);
  }

  // Set default dates based on data
  setDefaultDatesFromData(minDate, maxDate);

  setStatus(`OK: ${RAW.length.toLocaleString("pt-BR")} lançamentos filtrados (${minDate.toLocaleDateString("pt-BR")} → ${maxDate.toLocaleDateString("pt-BR")}).`);
}

function applyFilters() {
  const start = $("startDate").value ? new Date($("startDate").value + "T00:00:00") : null;
  const end = $("endDate").value ? new Date($("endDate").value + "T23:59:59") : null;

  const selectedDenoms = Array.from($("denoms").selectedOptions).map(o=>o.value);
  const threshold = Number($("threshold").value);

  const rows = filterRows(RAW, start, end, selectedDenoms);
  const { months, denoms, matrix, totalByMonth } = aggregateByMonth(rows);

  const med3 = rollingMedian(totalByMonth, 3);

  buildResumoTable(months, denoms, matrix);
  buildOutliersTable(months, totalByMonth, med3, threshold);
  buildDetailTable(rows);
  renderCharts(months, totalByMonth, med3, denoms, matrix);

  // store months for export
  MONTHS = months;

  setStatus(`Aplicado: ${rows.length.toLocaleString("pt-BR")} lançamentos | ${months.length} meses | limiar ${threshold.toFixed(2)}×.`);
}

function exportResumoCsv() {
  // Export current resumo table (from DOM) as CSV
  const table = $("tblResumo");
  const lines = [];
  const trs = table.querySelectorAll("tr");
  trs.forEach(tr => {
    const cells = Array.from(tr.children).map(td => {
      const txt = td.textContent.replace(/\s+/g," ").trim();
      // escape quotes
      return `"${txt.replace(/"/g,'""')}"`;
    });
    lines.push(cells.join(","));
  });
  downloadText("resumo_mensal_tarifas.csv", lines.join("\n"));
}

// =====================
// Wire UI
// =====================
function init() {
  $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
  $("threshold").addEventListener("input", () => {
    $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
  });

  $("preset").addEventListener("change", () => {
    applyPreset($("preset").value);
  });

  $("btnReload").addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await loadData($("csvUrl").value.trim());
      applyFilters();
    } catch (err) {
      setStatus(String(err.message || err));
      console.error(err);
    }
  });

  $("btnApply").addEventListener("click", () => {
    try { applyFilters(); } catch (err) { setStatus(String(err.message || err)); }
  });

  $("btnReset").addEventListener("click", () => {
    $("preset").value = "custom";
    // reselect all denoms
    Array.from($("denoms").options).forEach(o=>o.selected=true);
    applyFilters();
  });

  $("btnExport").addEventListener("click", (e) => {
    e.preventDefault();
    exportResumoCsv();
  });

  // Load default
  if (DEFAULT_CSV_URL) $("csvUrl").value = DEFAULT_CSV_URL;
}

init();
