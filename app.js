/* Dashboard — Tarifas/Taxas Itaú (São Cristóvão)
   Suporta 2 formatos de CSV:

   (A) FORMATO "LANÇAMENTOS" (linha a linha):
       Data | Lançamento | Valor (R$)

   (B) FORMATO "PIVOT" (sua planilha):
       Denominação | 2023-02 | 2023-03 | ... | 2026-02
       (cada linha = uma denominação, cada coluna-mês = valor)
*/

const $ = (id) => document.getElementById(id);
const DEFAULT_CSV_URL = "https://docs.google.com/spreadsheets/d/1g9rTDldOUzgcVWKrvw1IGZ2RlhItF5gh/export?format=csv&gid=1092717054";

function categorize(raw) {
  const d = String(raw || "").trim().toUpperCase();
  if (d.includes("TAR/CUSTAS COBRAN") || (d.includes("CUSTAS") && d.includes("COBRAN"))) return "Tarifa/Custas de Cobrança";
  if (d.includes("TAR PIX")) return "Tarifa PIX";
  if (d.includes("CTA GAR") || d.includes("CONTR/RENOV CTA GAR")) return "Tarifa Contrato/Renov. Cta Garantida";
  if (d.startsWith("IOF")) return "IOF";
  if (d.startsWith("JUROS")) return "Juros";
  if (d.includes("PLANO ADAPT")) return "Tarifa Plano Adapt";
  return String(raw || "").trim() || "Outros";
}

const INCLUDE_RE = /(\bTAR\b|TAR\/|TARIFA|CUSTAS|IOF|JUROS|ENCARG|MANUT|PACOTE|CESTA|CONTR\/RENOV|LIMITE)/i;
const EXCLUDE_RE = /(SISPAG|FORNECEDORES|SALARIOS|TRIBUTOS|PAGAMENTO|PIX DEVOLVIDO|BUSINESS)/i;

function parseCsv(text) {
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
  const v = String(s || "").trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00");
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
}

function toNumberBR(s) {
  const v = String(s ?? "").trim();
  if (!v) return NaN;
  const cleaned = v.replace(/R\$\s?/g, "").replace(/\s/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) return Number(cleaned.replace(/\./g, "").replace(",", "."));
  if (cleaned.includes(",") && !cleaned.includes(".")) return Number(cleaned.replace(/\./g, "").replace(",", "."));
  return Number(cleaned);
}

function ymFromDate(d) {
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
    out.push(median(values.slice(start, i+1)));
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
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

let MODE = "unknown"; // rows | pivot
let RAW = [];
let PIVOT = null;
let chartTotal = null;
let chartDenom = null;

function setStatus(msg) { $("status").textContent = msg || ""; }

function setDefaultDatesFromMonths(months) {
  if (!months.length) return;
  $("startDate").value = months[0] + "-01";
  $("endDate").value = months[months.length-1] + "-01";
}

function setDefaultDatesFromRows(minDate, maxDate) {
  const toISO = (d) => d ? d.toISOString().slice(0,10) : "";
  $("startDate").value = toISO(minDate);
  $("endDate").value = toISO(maxDate);
}

function looksLikeMonth(s) {
  return /^\d{4}-\d{2}$/.test(String(s||"").trim());
}

function applyPreset(preset) {
  if (preset === "custom") return;

  if (MODE === "pivot" && PIVOT?.months?.length) {
    const months = PIVOT.months;
    if (preset === "all") { setDefaultDatesFromMonths(months); return; }

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
    return;
  }

  const end = new Date();
  const start = new Date(end);
  const yearStart = new Date(end.getFullYear(), 0, 1);

  if (preset === "3m") start.setMonth(start.getMonth() - 3);
  if (preset === "6m") start.setMonth(start.getMonth() - 6);
  if (preset === "12m") start.setMonth(start.getMonth() - 12);
  if (preset === "ytd") start.setTime(yearStart.getTime());
  if (preset === "all") return;

  $("startDate").value = start.toISOString().slice(0,10);
  $("endDate").value = end.toISOString().slice(0,10);
}

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
  const maxRows = 50;
  for (const p of pairs.slice(0, maxRows)) {
    const tr = document.createElement("tr");
    const tdD = document.createElement("td"); tdD.innerHTML = `<span class="chip">${p.d}</span>`; tr.appendChild(tdD);
    const tdT = document.createElement("td"); tdT.className="num"; tdT.textContent = fmtBRL(p.t); tr.appendChild(tdT);
    tbody.appendChild(tr);
  }
  $("countPill").textContent = `${pairs.length.toLocaleString("pt-BR")} denominações (top ${Math.min(maxRows,pairs.length)})`;
}

function buildDetailTableRows(rows) {
  const thead = $("tblDetalhe").querySelector("thead");
  const tbody = $("tblDetalhe").querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

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

  const maxSeries = 10;
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
      plugins: { legend: { labels: { color: "#1E2A24" } } },
      scales: {
        x: { ticks: { color: "#6B7C73" }, grid: { color: "rgba(30,42,36,.10)" } },
        y: { ticks: { color: "#6B7C73", callback: (v)=> (Number(v)).toLocaleString("pt-BR") }, grid: { color: "rgba(30,42,36,.10)" } },
      }
    }
  });

  const totalAll = totalByMonth.reduce((a,b)=>a+b,0);
  $("totalPill").textContent = `Total no período: ${fmtBRL(totalAll)}`;
  $("denomPill").textContent = `${denoms.length} denominações (gráfico mostra até ${maxSeries})`;
}

async function loadData(csvUrl) {
  if (!csvUrl) throw new Error("Informe a URL do CSV.");
  setStatus("Carregando CSV...");
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao carregar CSV (verifique se está público).");
  const text = await res.text();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV vazio.");

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i].map(x => String(x||"").trim().toLowerCase());
    if (r.includes("denominação") || r.includes("denominacao")) { headerIdx = i; break; }
    if (r.includes("data") && r.some(x => x.includes("lançamento") || x.includes("lancamento")) && r.some(x => x.includes("valor"))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) headerIdx = 0;

  const header = rows[headerIdx].map(h => String(h||"").trim());
  const dataRows = rows.slice(headerIdx + 1);

  const denomColIdx = header.findIndex(h => /denom/i.test(h));
  const monthCols = header
    .map((h, idx) => ({ h: String(h||"").trim(), idx }))
    .filter(x => looksLikeMonth(x.h));

  if (denomColIdx >= 0 && monthCols.length >= 2) {
    MODE = "pivot";
    const months = monthCols.map(x => x.h);
    const denoms = [];
    const matrix = [];

    for (const r of dataRows) {
      const denom = String(r[denomColIdx] || "").trim();
      if (!denom) continue;
      denoms.push(denom);

      const row = months.map((m, k) => {
        const idx = monthCols[k].idx;
        const v = toNumberBR(r[idx]);
        return Number.isFinite(v) ? Math.abs(v) : 0;
      });
      matrix.push(row);
    }

    if (!denoms.length) throw new Error("Formato Pivot detectado, mas sem linhas de denominação.");

    PIVOT = { months, denoms, matrix };

    const sel = $("denoms");
    sel.innerHTML = "";
    denoms.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      opt.selected = true;
      sel.appendChild(opt);
    });

    setDefaultDatesFromMonths(months);
    setStatus(`OK (Pivot): ${denoms.length.toLocaleString("pt-BR")} denominações | ${months.length} meses.`);
    return;
  }

  MODE = "rows";
  const lower = header.map(h => h.toLowerCase());
  const idxData = lower.findIndex(h => h.includes("data"));
  const idxLanc = lower.findIndex(h => h.includes("lançamento") || h.includes("lancamento"));
  const idxValor = lower.findIndex(h => h.includes("valor"));
  if (idxData < 0 || idxLanc < 0 || idxValor < 0) {
    throw new Error("Não consegui identificar formato Pivot nem colunas Data/Lançamento/Valor no CSV.");
  }

  const parsed = [];
  for (const r of dataRows) {
    const date = toDateBR(r[idxData]);
    const launch = String(r[idxLanc] || "").trim();
    const value = toNumberBR(r[idxValor]);
    if (!date || !Number.isFinite(value) || !launch) continue;
    if (value >= 0) continue;
    if (!INCLUDE_RE.test(launch)) continue;
    if (EXCLUDE_RE.test(launch)) continue;
    const denom = categorize(launch);
    parsed.push({ date, launch, value, amountAbs: Math.abs(value), denom });
  }

  RAW = parsed;
  if (!RAW.length) throw new Error("Nenhuma tarifa/taxa encontrada após filtros.");

  const dates = RAW.map(r=>r.date.getTime()).sort((a,b)=>a-b);
  const minDate = new Date(dates[0]);
  const maxDate = new Date(dates[dates.length-1]);

  const denomList = Array.from(new Set(RAW.map(r=>r.denom))).sort();
  const sel = $("denoms");
  sel.innerHTML = "";
  denomList.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d; opt.textContent = d; opt.selected = true;
    sel.appendChild(opt);
  });

  setDefaultDatesFromRows(minDate, maxDate);
  setStatus(`OK (Lançamentos): ${RAW.length.toLocaleString("pt-BR")} lançamentos filtrados.`);
}

function applyFilters() {
  const threshold = Number($("threshold").value);
  const selectedDenoms = Array.from($("denoms").selectedOptions).map(o=>o.value);

  if (MODE === "pivot" && PIVOT) {
    const startYM = $("startDate").value ? $("startDate").value.slice(0,7) : null;
    const endYM = $("endDate").value ? $("endDate").value.slice(0,7) : null;

    let months = PIVOT.months.slice();
    if (startYM) months = months.filter(m => m >= startYM);
    if (endYM) months = months.filter(m => m <= endYM);

    const monthIndex = months.map(m => PIVOT.months.indexOf(m));

    const denomsAll = PIVOT.denoms;
    const keepDenomIdx = denomsAll
      .map((d,i)=>({d,i}))
      .filter(x => selectedDenoms.length ? selectedDenoms.includes(x.d) : true)
      .map(x => x.i);

    const denoms = keepDenomIdx.map(i => denomsAll[i]);
    const matrix = keepDenomIdx.map(i => monthIndex.map(j => PIVOT.matrix[i][j] || 0));

    const totalByMonth = months.map((m, mi) => matrix.reduce((acc,row)=>acc+(row[mi]||0),0));
    const med3 = rollingMedian(totalByMonth, 3);

    buildResumoTable(months, denoms, matrix);
    buildOutliersTable(months, totalByMonth, med3, threshold);

    const totalsByDenom = denoms.map((d, i) => matrix[i].reduce((a,b)=>a+b,0));
    buildDetailTablePivot(denoms, totalsByDenom);

    renderCharts(months, totalByMonth, med3, denoms, matrix);

    setStatus(`Aplicado (Pivot): ${denoms.length} denominações | ${months.length} meses | limiar ${threshold.toFixed(2)}×.`);
    return;
  }

  const start = $("startDate").value ? new Date($("startDate").value + "T00:00:00") : null;
  const end = $("endDate").value ? new Date($("endDate").value + "T23:59:59") : null;

  const rows = RAW.filter(r => {
    if (start && r.date < start) return false;
    if (end && r.date > end) return false;
    if (selectedDenoms.length && !selectedDenoms.includes(r.denom)) return false;
    return true;
  });

  const monthsSet = new Set();
  const denomSet = new Set();
  const map = new Map();
  for (const r of rows) {
    const m = ymFromDate(r.date);
    monthsSet.add(m);
    denomSet.add(r.denom);
    const key = m + "||" + r.denom;
    map.set(key, (map.get(key) || 0) + r.amountAbs);
  }
  const months = Array.from(monthsSet).sort();
  const denoms = Array.from(denomSet).sort();
  const matrix = denoms.map(d => months.map(m => map.get(m + "||" + d) || 0));
  const totalByMonth = months.map((m, idx) => denoms.reduce((acc, d, di) => acc + matrix[di][idx], 0));
  const med3 = rollingMedian(totalByMonth, 3);

  buildResumoTable(months, denoms, matrix);
  buildOutliersTable(months, totalByMonth, med3, threshold);
  buildDetailTableRows(rows);
  renderCharts(months, totalByMonth, med3, denoms, matrix);
  setStatus(`Aplicado (Lançamentos): ${rows.length} lançamentos | ${months.length} meses | limiar ${threshold.toFixed(2)}×.`);
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
  downloadText("resumo_mensal_tarifas.csv", lines.join("\n"));
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
      await loadData(DEFAULT_CSV_URL);
      applyFilters();
    } catch (err) {
      setStatus(String(err.message || err));
      console.error(err);
    }
  })();
}

init();
