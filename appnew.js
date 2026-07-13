/* =========================================================
   GT BANK ANALYTICS — app.js v3.2
   Correção principal:
   - Unidade identificada pelo nome do arquivo.
   - Fallback pela linha "Nome:" do extrato Itaú.
   - Nenhuma unidade fica fixa dentro do parser.
   - Compatível com o HTML da versão com menu lateral:
     Importação | Base Bruta | Dashboard | Fluxo Financeiro
========================================================= */

let BASE_RAW = [];
let BASE_SELECTED = [];
let DENOM_SUMMARY = [];
let SELECTED_DENOMS = new Set();
let SELECTED_FILE = null;
let CURRENT_UNIT = "Unidade não identificada";

let chartTotal = null;
let chartTop = null;
let chartFlow = null;
let chartOutTop = null;

function $(id){
  return document.getElementById(id);
}

function safeOn(id, eventName, handler){
  const el = $(id);
  if(el) el.addEventListener(eventName, handler);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", initApp);
}else{
  initApp();
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

function initApp(){
  try{
    bindNavigation();
    bindImport();
    bindSelection();
    bindAnalysis();
    bindFlow();

    setStatus("Pronto. Selecione um arquivo e clique em Processar e padronizar.");
    setMiniStatus("Pronto");
  }catch(err){
    console.error(err);
    setError("Erro ao inicializar o app: " + (err.message || err));
  }
}

function bindNavigation(){
  document.querySelectorAll(".navItem").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".navItem").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));

      btn.classList.add("active");

      const view = $(btn.dataset.view);
      if(view) view.classList.add("active");

      if(btn.dataset.view === "analysisView") renderAnalysis();
      if(btn.dataset.view === "flowView") renderFlowAnalysis();
    });
  });
}

function bindImport(){
  const fileInput = $("fileInput");
  const dropzone = $("dropzone");

  if(fileInput){
    fileInput.addEventListener("change", () => {
      SELECTED_FILE = fileInput.files[0] || null;

      if($("fileName")){
        $("fileName").textContent = SELECTED_FILE
          ? SELECTED_FILE.name
          : "Nenhum arquivo selecionado";
      }

      if(SELECTED_FILE){
        CURRENT_UNIT = detectUnitFromFilename(SELECTED_FILE.name);
        setStatus(
          `Arquivo selecionado: ${SELECTED_FILE.name}. ` +
          `Unidade pelo nome do arquivo: ${CURRENT_UNIT}. ` +
          `Clique em Processar e padronizar.`
        );
      }
    });
  }

  safeOn("btnProcess", "click", processFile);
  safeOn("btnReset", "click", resetAll);
  safeOn("btnExport", "click", exportWorkbook);

  if(dropzone && fileInput){
    ["dragenter", "dragover"].forEach(evt => {
      dropzone.addEventListener(evt, e => {
        e.preventDefault();
        dropzone.classList.add("drag");
      });
    });

    ["dragleave", "drop"].forEach(evt => {
      dropzone.addEventListener(evt, e => {
        e.preventDefault();
        dropzone.classList.remove("drag");
      });
    });

    dropzone.addEventListener("drop", e => {
      const file = e.dataTransfer.files[0];
      if(!file) return;

      SELECTED_FILE = file;
      fileInput.files = e.dataTransfer.files;
      CURRENT_UNIT = detectUnitFromFilename(file.name);

      if($("fileName")) $("fileName").textContent = file.name;

      setStatus(
        `Arquivo arrastado: ${file.name}. ` +
        `Unidade pelo nome do arquivo: ${CURRENT_UNIT}. ` +
        `Clique em Processar e padronizar.`
      );
    });
  }
}

function bindSelection(){
  safeOn("searchDenom", "input", renderDenomSelector);
  safeOn("btnSuggest", "click", selectSuggested);
  safeOn("btnAll", "click", selectAll);
  safeOn("btnNone", "click", selectNone);
  safeOn("btnApply", "click", applySelection);
}

function bindAnalysis(){
  safeOn("threshold", "input", () => {
    if($("thresholdLabel")){
      $("thresholdLabel").textContent = `${Number($("threshold").value).toFixed(2)}×`;
    }
  });

  safeOn("btnUpdateAnalysis", "click", renderAnalysis);
  safeOn("analysisSearch", "input", renderAnalysis);
}

function bindFlow(){
  safeOn("flowFactor", "input", () => {
    if($("flowFactorLabel")){
      $("flowFactorLabel").textContent = `${Number($("flowFactor").value).toFixed(2)}×`;
    }
  });

  safeOn("btnUpdateFlow", "click", renderFlowAnalysis);
  safeOn("flowSearch", "input", renderFlowAnalysis);
}

/* =========================================================
   IDENTIFICAÇÃO DA UNIDADE
========================================================= */

function normalizeSearchText(value){
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-\.]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectUnitFromText(value){
  const text = normalizeSearchText(value);

  if(
    text.includes("sao cristovao") ||
    text.includes("saocristovao") ||
    text.includes("gt sc") ||
    text.includes("gtsc")
  ){
    return "São Cristóvão BA";
  }

  if(
    text.includes("cajazeiras") ||
    text.includes("gt caja") ||
    text.includes("gtcaja")
  ){
    return "Cajazeiras BA";
  }

  if(
    text.includes("camacari") ||
    text.includes("gt cam") ||
    text.includes("gtcam")
  ){
    return "Camaçari BA";
  }

  if(
    text.includes("gama") ||
    text.includes("gt gama") ||
    text.includes("gtgama")
  ){
    return "Gama - DF";
  }

  return "Unidade não identificada";
}

function detectUnitFromFilename(filename){
  return detectUnitFromText(filename);
}

function detectUnitFromRows(rows){
  if(!Array.isArray(rows)) return "Unidade não identificada";

  const limit = Math.min(rows.length, 30);

  for(let i = 0; i < limit; i++){
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const joined = row.map(v => String(v || "")).join(" ");
    const unit = detectUnitFromText(joined);

    if(unit !== "Unidade não identificada"){
      return unit;
    }
  }

  return "Unidade não identificada";
}

function resolveCurrentUnit(filename, rows){
  const fromFilename = detectUnitFromFilename(filename);

  if(fromFilename !== "Unidade não identificada"){
    return fromFilename;
  }

  return detectUnitFromRows(rows);
}

/* =========================================================
   PROCESSAMENTO PRINCIPAL
========================================================= */

async function processFile(){
  try{
    clearError();

    const fileInput = $("fileInput");
    const file = SELECTED_FILE ||
      (fileInput && fileInput.files ? fileInput.files[0] : null);

    if(!file){
      setError("Selecione um arquivo antes de processar.");
      return;
    }

    resetDataOnly();
    setStatus(`Lendo arquivo: ${file.name}...`);
    setMiniStatus("Lendo arquivo");

    const rows = await readFileToRows(file);

    CURRENT_UNIT = resolveCurrentUnit(file.name, rows);

    if(CURRENT_UNIT === "Unidade não identificada"){
      throw new Error(
        "Não consegui identificar a unidade pelo nome do arquivo nem pelo campo Nome do extrato. " +
        "Inclua Camaçari, Cajazeiras, São Cristóvão ou Gama no nome do arquivo."
      );
    }

    setStatus(
      `Arquivo lido: ${rows.length.toLocaleString("pt-BR")} linhas. ` +
      `Unidade confirmada: ${CURRENT_UNIT}. Padronizando...`
    );

    BASE_RAW = parseItauRows(rows, CURRENT_UNIT);

    if(!BASE_RAW.length){
      throw new Error("Nenhuma linha válida encontrada no extrato.");
    }

    DENOM_SUMMARY = buildDenomSummary(BASE_RAW);

    SELECTED_DENOMS = new Set(
      DENOM_SUMMARY
        .filter(x => x.suggested)
        .map(x => x.denom)
    );

    renderDenomSelector();
    applySelection(false);
    setDefaultFlowDatesIfEmpty();
    renderFlowAnalysis();

    setStatus(
      `Base padronizada para ${CURRENT_UNIT}: ` +
      `${BASE_RAW.length.toLocaleString("pt-BR")} lançamentos e ` +
      `${DENOM_SUMMARY.length.toLocaleString("pt-BR")} denominações.`
    );

    setMiniStatus(CURRENT_UNIT);

  }catch(err){
    console.error(err);
    setError(err.message || String(err));
  }
}

/* =========================================================
   LEITURA XLSX / CSV
========================================================= */

async function readFileToRows(file){
  const buffer = await file.arrayBuffer();
  const name = String(file.name || "").toLowerCase();

  if(name.endsWith(".csv")){
    return parseCsv(new TextDecoder("utf-8").decode(buffer));
  }

  if(typeof XLSX === "undefined"){
    throw new Error("Biblioteca XLSX não carregou.");
  }

  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    raw: false
  });

  const sheetName = pickBestSheetName(workbook.SheetNames);
  const ws = workbook.Sheets[sheetName];

  fixWorksheetRefByExistingCells(ws);

  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false
  });
}

function pickBestSheetName(sheetNames){
  if(!sheetNames || !sheetNames.length){
    throw new Error("Arquivo sem abas.");
  }

  const found = sheetNames.find(s => {
    const n = normalizeHeader(s);
    return n.includes("lancamento") || n.includes("lancamentos");
  });

  return found || sheetNames[0];
}

function fixWorksheetRefByExistingCells(ws){
  const refs = Object.keys(ws || {}).filter(k => k[0] !== "!");
  if(!refs.length) return;

  let minR = Infinity;
  let minC = Infinity;
  let maxR = 0;
  let maxC = 0;

  refs.forEach(ref => {
    try{
      const c = XLSX.utils.decode_cell(ref);
      minR = Math.min(minR, c.r);
      minC = Math.min(minC, c.c);
      maxR = Math.max(maxR, c.r);
      maxC = Math.max(maxC, c.c);
    }catch(e){}
  });

  if(Number.isFinite(minR)){
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: minR, c: minC },
      e: { r: maxR, c: maxC }
    });
  }
}

function parseCsv(text){
  text = String(text || "").replace(/^\uFEFF/, "");

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for(let i = 0; i < text.length; i++){
    const ch = text[i];

    if(ch === '"'){
      if(inQuotes && text[i + 1] === '"'){
        field += '"';
        i++;
      }else{
        inQuotes = !inQuotes;
      }
    }else if((ch === "," || ch === ";") && !inQuotes){
      row.push(field);
      field = "";
    }else if((ch === "\n" || ch === "\r") && !inQuotes){
      if(ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if(row.some(v => norm(v) !== "")) rows.push(row);
      row = [];
      field = "";
    }else{
      field += ch;
    }
  }

  if(field.length || row.length){
    row.push(field);
    if(row.some(v => norm(v) !== "")) rows.push(row);
  }

  return rows;
}

/* =========================================================
   PARSER ITAÚ
========================================================= */

function parseItauRows(rows, unitName){
  const raw = [];

  for(let i = 0; i < rows.length; i++){
    const r = rows[i];

    const data = parseDate(r[0]);
    const descricao = normalizeDescription(r[1]);
    const valorOriginal = parseValue(r[4]);

    if(!data || !descricao) continue;
    if(shouldIgnoreDescription(descricao)) continue;

    if(
      valorOriginal === null ||
      valorOriginal === undefined ||
      Number.isNaN(valorOriginal)
    ){
      continue;
    }

    const valorAbs = Math.abs(valorOriginal);
    if(!valorAbs) continue;

    raw.push({
      Data: formatDateBR(data),
      DataISO: toISODate(data),
      Unidade: unitName,
      Banco: "Itaú",
      Conta: "",
      "Denominação": descricao,
      Valor: round2(valorAbs),
      ValorOriginal: round2(valorOriginal),
      Direcao: valorOriginal < 0 ? "Saída" : "Entrada",
      Mes: toYM(data),
      Tipo: suggestType(descricao)
    });
  }

  return raw;
}

function shouldIgnoreDescription(descricao){
  const d = normalizeDescription(descricao);

  return (
    d.includes("SALDO") ||
    d.includes("TOTAL DISPON") ||
    d.includes("LIMITE") ||
    d.includes("RESUMO") ||
    d.includes("LANCAMENTOS") ||
    d.includes("LANÇAMENTOS") ||
    d.includes("PERIODO") ||
    d.includes("PERÍODO") ||
    d.includes("ATUALIZACAO") ||
    d.includes("ATUALIZAÇÃO") ||
    d.includes("AGENCIA") ||
    d.includes("AGÊNCIA") ||
    d === "CONTA"
  );
}

/* =========================================================
   AGRUPAMENTO / SELEÇÃO
========================================================= */

function buildDenomSummary(raw){
  const map = new Map();

  raw.forEach(r => {
    const d = r["Denominação"];

    if(!map.has(d)){
      map.set(d, {
        denom: d,
        count: 0,
        total: 0,
        suggested: isSuggestedTariff(d)
      });
    }

    const o = map.get(d);
    o.count++;
    o.total += r.Valor;
  });

  return [...map.values()]
    .map(x => ({ ...x, total: round2(x.total) }))
    .sort((a, b) => b.total - a.total);
}

function isSuggestedTariff(descricao){
  const d = normalizeDescription(descricao);

  const termos = [
    "TAR", "TARIFA", "CESTA", "MENSALIDADE", "IOF", "JUROS",
    "ENCARGO", "ENCARGOS", "ADAPT", "EXCED", "MANUT", "PACOTE",
    "SISDEB", "COBRANCA", "COBRANÇA"
  ];

  const ignorar = [
    "SISPAG PIX TRANSFERENCI", "REND PAGO", "APLIC", "BOLETO RECEBIDO",
    "CREDITO", "CRÉDITO", "TRANSFERENCIA RECEBIDA", "TRANSFERÊNCIA RECEBIDA",
    "RESGATE", "DEPOSITO", "DEPÓSITO"
  ];

  if(ignorar.some(t => d.includes(normalizeDescription(t)))) return false;
  return termos.some(t => d.includes(normalizeDescription(t)));
}

function suggestType(descricao){
  return isSuggestedTariff(descricao) ? "Custo/Tarifa" : "Movimento";
}

function renderDenomSelector(){
  const list = $("denomList");
  if(!list) return;

  const q = normalizeDescription(($(
    "searchDenom"
  ) && $("searchDenom").value) || "");

  const filtered = DENOM_SUMMARY.filter(x =>
    !q || normalizeDescription(x.denom).includes(q)
  );

  if($("selectionInfo")){
    $("selectionInfo").textContent =
      `${SELECTED_DENOMS.size.toLocaleString("pt-BR")} selecionadas de ` +
      `${DENOM_SUMMARY.length.toLocaleString("pt-BR")}`;
  }

  if(!filtered.length){
    list.innerHTML = `<div class="empty">Nenhuma denominação encontrada.</div>`;
    return;
  }

  list.innerHTML = filtered.map(x => {
    const checked = SELECTED_DENOMS.has(x.denom) ? "checked" : "";
    const tag = x.suggested ? `<span class="tagSuggest">sugerida</span>` : "";

    return `
      <label class="denomItem">
        <input type="checkbox" data-denom="${escapeAttr(x.denom)}" ${checked}>
        <div class="denomName">${escapeHtml(x.denom)} ${tag}</div>
        <div class="metric">${x.count.toLocaleString("pt-BR")} lanç.</div>
        <div class="metric total">${fmtBRL(x.total)}</div>
      </label>
    `;
  }).join("");

  list.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", e => {
      const d = e.target.dataset.denom;
      if(e.target.checked) SELECTED_DENOMS.add(d);
      else SELECTED_DENOMS.delete(d);

      if($("selectionInfo")){
        $("selectionInfo").textContent =
          `${SELECTED_DENOMS.size.toLocaleString("pt-BR")} selecionadas de ` +
          `${DENOM_SUMMARY.length.toLocaleString("pt-BR")}`;
      }
    });
  });
}

function selectSuggested(){
  SELECTED_DENOMS = new Set(
    DENOM_SUMMARY.filter(x => x.suggested).map(x => x.denom)
  );
  renderDenomSelector();
  applySelection();
}

function selectAll(){
  SELECTED_DENOMS = new Set(DENOM_SUMMARY.map(x => x.denom));
  renderDenomSelector();
  applySelection();
}

function selectNone(){
  SELECTED_DENOMS = new Set();
  renderDenomSelector();
  applySelection();
}

function applySelection(showStatus = true){
  BASE_SELECTED = BASE_RAW.filter(r =>
    SELECTED_DENOMS.has(r["Denominação"])
  );

  renderTables();
  renderKpis();
  setDefaultDatesIfEmpty();
  renderAnalysis();
  renderFlowAnalysis();

  if($("btnExport")) $("btnExport").disabled = BASE_RAW.length === 0;

  if(showStatus){
    setStatus(
      `Seleção aplicada para ${CURRENT_UNIT}: ` +
      `${BASE_SELECTED.length.toLocaleString("pt-BR")} lançamentos.`
    );
  }
}

/* =========================================================
   DATAS PADRÃO
========================================================= */

function setDefaultDatesIfEmpty(){
  if(!BASE_SELECTED.length) return;

  const months = [...new Set(BASE_SELECTED.map(r => r.Mes))].sort();
  if(!months.length) return;

  if($("startDate") && !$("startDate").value){
    $("startDate").value = months[0] + "-01";
  }

  if($("endDate") && !$("endDate").value){
    $("endDate").value = months[months.length - 1] + "-01";
  }
}

function setDefaultFlowDatesIfEmpty(){
  if(!BASE_RAW.length) return;

  const months = [...new Set(BASE_RAW.map(r => r.Mes))].sort();
  if(!months.length) return;

  if($("flowStartDate") && !$("flowStartDate").value){
    $("flowStartDate").value = months[0] + "-01";
  }

  if($("flowEndDate") && !$("flowEndDate").value){
    $("flowEndDate").value = months[months.length - 1] + "-01";
  }
}

/* =========================================================
   DASHBOARD CUSTOS / TARIFAS
========================================================= */

function getFilteredSelected(){
  let rows = BASE_SELECTED.slice();

  const start = $("startDate") && $("startDate").value
    ? $("startDate").value.slice(0, 7)
    : null;

  const end = $("endDate") && $("endDate").value
    ? $("endDate").value.slice(0, 7)
    : null;

  const q = normalizeDescription(
    ($("analysisSearch") && $("analysisSearch").value) || ""
  );

  if(start) rows = rows.filter(r => r.Mes >= start);
  if(end) rows = rows.filter(r => r.Mes <= end);
  if(q) rows = rows.filter(r =>
    normalizeDescription(r["Denominação"]).includes(q)
  );

  return rows;
}

function renderAnalysis(){
  const rows = getFilteredSelected();

  if(!rows.length){
    destroyCostCharts();
    clearCostTables();
    return;
  }

  const months = [...new Set(rows.map(r => r.Mes))].sort();
  const byMonth = months.map(m =>
    rows.filter(r => r.Mes === m).reduce((a, b) => a + b.Valor, 0)
  );
  const med3 = rollingMedian(byMonth, 3);
  const threshold = Number(($("threshold") && $("threshold").value) || 1.2);
  const ranking = buildDenomSummary(rows).slice(0, 15);

  if($("analysisInfo")){
    $("analysisInfo").textContent =
      `${CURRENT_UNIT} • ${rows.length.toLocaleString("pt-BR")} lançamentos analisados`;
  }

  if($("totalPill")){
    $("totalPill").textContent = fmtBRL(byMonth.reduce((a, b) => a + b, 0));
  }

  renderChartTotal(months, byMonth, med3);
  renderChartTop(ranking);
  renderOutliers(months, byMonth, med3, threshold);
  renderRanking(ranking);
}

function clearCostTables(){
  if($("analysisInfo")) $("analysisInfo").textContent = "Sem dados selecionados";
  if($("totalPill")) $("totalPill").textContent = "—";
  if($("outlierTable")) $("outlierTable").innerHTML = "";
  if($("rankingTable")) $("rankingTable").innerHTML = "";
}

function renderChartTotal(months, total, med3){
  if(typeof Chart === "undefined" || !$("chartTotal")) return;
  if(chartTotal) chartTotal.destroy();

  chartTotal = new Chart($("chartTotal"), {
    type: "line",
    data: {
      labels: months,
      datasets: [
        {
          label: "Total mensal",
          data: total,
          borderColor: "#2e7d32",
          backgroundColor: "rgba(46,125,50,.08)",
          borderWidth: 2,
          tension: .25
        },
        {
          label: "Mediana 3m",
          data: med3,
          borderColor: "#66bb6a",
          borderWidth: 2,
          borderDash: [6, 6],
          tension: .25
        }
      ]
    },
    options: { responsive: true }
  });
}

function renderChartTop(ranking){
  if(typeof Chart === "undefined" || !$("chartTop")) return;
  if(chartTop) chartTop.destroy();

  chartTop = new Chart($("chartTop"), {
    type: "bar",
    data: {
      labels: ranking.map(x => x.denom.slice(0, 24)),
      datasets: [{
        label: "Total",
        data: ranking.map(x => x.total),
        backgroundColor: "rgba(46,125,50,.45)",
        borderColor: "#2e7d32",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

function renderOutliers(months, total, med3, threshold){
  const rows = months.map((m, i) => ({
    Mes: m,
    Total: round2(total[i]),
    Mediana: round2(med3[i]),
    Status: med3[i] > 0 && total[i] > med3[i] * threshold ? "ACIMA" : "—"
  }));

  if($("outlierTable")){
    $("outlierTable").innerHTML =
      tableHtml(rows, ["Mes", "Total", "Mediana", "Status"]);
  }
}

function renderRanking(ranking){
  if($("rankingTable")){
    $("rankingTable").innerHTML = tableHtml(
      ranking.map(x => ({
        "Denominação": x.denom,
        "Qtd": x.count,
        "Total": round2(x.total)
      })),
      ["Denominação", "Qtd", "Total"]
    );
  }
}

/* =========================================================
   FLUXO FINANCEIRO
========================================================= */

function getFilteredFlowRows(){
  let rows = BASE_RAW.slice();

  const start = $("flowStartDate") && $("flowStartDate").value
    ? $("flowStartDate").value.slice(0, 7)
    : null;

  const end = $("flowEndDate") && $("flowEndDate").value
    ? $("flowEndDate").value.slice(0, 7)
    : null;

  const q = normalizeDescription(
    ($("flowSearch") && $("flowSearch").value) || ""
  );

  if(start) rows = rows.filter(r => r.Mes >= start);
  if(end) rows = rows.filter(r => r.Mes <= end);
  if(q) rows = rows.filter(r =>
    normalizeDescription(r["Denominação"]).includes(q)
  );

  return rows;
}

function renderFlowAnalysis(){
  setDefaultFlowDatesIfEmpty();
  const rows = getFilteredFlowRows();

  if(!rows.length){
    destroyFlowCharts();
    if($("flowInfo")) $("flowInfo").textContent = "Sem dados";
    if($("newExpensesTable")) $("newExpensesTable").innerHTML = "";
    if($("abnormalExpensesTable")) $("abnormalExpensesTable").innerHTML = "";
    updateFlowKpis(0, 0, 0, 0);
    return;
  }

  const months = [...new Set(rows.map(r => r.Mes))].sort();

  const flow = months.map(m => {
    const mRows = rows.filter(r => r.Mes === m);
    const entradas = mRows
      .filter(r => r.Direcao === "Entrada")
      .reduce((a, b) => a + b.Valor, 0);
    const saidas = mRows
      .filter(r => r.Direcao === "Saída")
      .reduce((a, b) => a + b.Valor, 0);

    return {
      Mes: m,
      Entradas: round2(entradas),
      Saidas: round2(saidas),
      Resultado: round2(entradas - saidas)
    };
  });

  const entradasTotal = flow.reduce((a, b) => a + b.Entradas, 0);
  const saidasTotal = flow.reduce((a, b) => a + b.Saidas, 0);
  const resultado = entradasTotal - saidasTotal;
  const outRows = rows.filter(r => r.Direcao === "Saída");
  const topOut = buildDenomSummary(outRows).slice(0, 15);
  const factor = Number(($("flowFactor") && $("flowFactor").value) || 1.3);
  const newExpenses = detectNewExpenses(outRows).slice(0, 80);
  const abnormal = detectAbnormalExpenses(outRows, factor).slice(0, 80);

  updateFlowKpis(
    entradasTotal,
    saidasTotal,
    resultado,
    newExpenses.length + abnormal.length
  );

  if($("flowInfo")){
    $("flowInfo").textContent =
      `${CURRENT_UNIT} • ${rows.length.toLocaleString("pt-BR")} movimentos no período`;
  }

  renderChartFlow(flow);
  renderChartOutTop(topOut);
  renderNewExpenses(newExpenses);
  renderAbnormalExpenses(abnormal);
}

function updateFlowKpis(entradas, saidas, resultado, alertas){
  if($("kEntradas")) $("kEntradas").textContent = fmtBRL(entradas);
  if($("kSaidas")) $("kSaidas").textContent = fmtBRL(saidas);
  if($("kResultado")) $("kResultado").textContent = fmtBRL(resultado);
  if($("kAlertas")) $("kAlertas").textContent = Number(alertas || 0).toLocaleString("pt-BR");
}

function renderChartFlow(flow){
  if(typeof Chart === "undefined" || !$("chartFlow")) return;
  if(chartFlow) chartFlow.destroy();

  chartFlow = new Chart($("chartFlow"), {
    type: "line",
    data: {
      labels: flow.map(x => x.Mes),
      datasets: [
        {
          label: "Entradas",
          data: flow.map(x => x.Entradas),
          borderColor: "#2e7d32",
          backgroundColor: "rgba(46,125,50,.08)",
          borderWidth: 2,
          tension: .25
        },
        {
          label: "Saídas",
          data: flow.map(x => x.Saidas),
          borderColor: "#b45309",
          backgroundColor: "rgba(180,83,9,.08)",
          borderWidth: 2,
          tension: .25
        },
        {
          label: "Resultado",
          data: flow.map(x => x.Resultado),
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,.08)",
          borderWidth: 2,
          tension: .25
        }
      ]
    },
    options: { responsive: true }
  });
}

function renderChartOutTop(topOut){
  if(typeof Chart === "undefined" || !$("chartOutTop")) return;
  if(chartOutTop) chartOutTop.destroy();

  chartOutTop = new Chart($("chartOutTop"), {
    type: "bar",
    data: {
      labels: topOut.map(x => x.denom.slice(0, 24)),
      datasets: [{
        label: "Saídas",
        data: topOut.map(x => x.total),
        backgroundColor: "rgba(180,83,9,.45)",
        borderColor: "#b45309",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

function detectNewExpenses(outRows){
  const months = [...new Set(outRows.map(r => r.Mes))].sort();
  if(months.length < 2) return [];

  const current = months[months.length - 1];
  const previous = new Set(
    outRows.filter(r => r.Mes < current).map(r => r["Denominação"])
  );
  const currentRows = outRows.filter(r => r.Mes === current);

  return buildDenomSummary(currentRows)
    .filter(x => !previous.has(x.denom))
    .map(x => ({
      "Denominação": x.denom,
      "Mês": current,
      "Qtd": x.count,
      "Total": round2(x.total)
    }))
    .sort((a, b) => b.Total - a.Total);
}

function detectAbnormalExpenses(outRows, factor){
  const months = [...new Set(outRows.map(r => r.Mes))].sort();
  if(months.length < 4) return [];

  const current = months[months.length - 1];
  const histMonths = months.slice(0, -1);
  const currentSummary = buildDenomSummary(
    outRows.filter(r => r.Mes === current)
  );

  const alerts = [];

  currentSummary.forEach(cur => {
    const histTotals = histMonths
      .map(m => outRows
        .filter(r => r.Mes === m && r["Denominação"] === cur.denom)
        .reduce((a, b) => a + b.Valor, 0)
      )
      .filter(v => v > 0);

    if(histTotals.length < 2) return;

    const avg = histTotals.reduce((a, b) => a + b, 0) / histTotals.length;

    if(avg > 0 && cur.total > avg * factor){
      alerts.push({
        "Denominação": cur.denom,
        "Mês": current,
        "Atual": round2(cur.total),
        "Média histórica": round2(avg),
        "Variação %": round2(((cur.total / avg) - 1) * 100)
      });
    }
  });

  return alerts.sort((a, b) => b["Variação %"] - a["Variação %"]);
}

function renderNewExpenses(rows){
  if($("newExpensesTable")){
    $("newExpensesTable").innerHTML =
      tableHtml(rows, ["Denominação", "Mês", "Qtd", "Total"]);
  }
}

function renderAbnormalExpenses(rows){
  if($("abnormalExpensesTable")){
    $("abnormalExpensesTable").innerHTML = tableHtml(
      rows,
      ["Denominação", "Mês", "Atual", "Média histórica", "Variação %"]
    );
  }
}

/* =========================================================
   TABELAS / KPIs / EXPORTAÇÃO
========================================================= */

function destroyCostCharts(){
  if(chartTotal){ chartTotal.destroy(); chartTotal = null; }
  if(chartTop){ chartTop.destroy(); chartTop = null; }
}

function destroyFlowCharts(){
  if(chartFlow){ chartFlow.destroy(); chartFlow = null; }
  if(chartOutTop){ chartOutTop.destroy(); chartOutTop = null; }
}

function renderTables(){
  if($("rawTable")){
    $("rawTable").innerHTML = tableHtml(
      BASE_RAW.slice(0, 150),
      ["Data", "Unidade", "Banco", "Denominação", "ValorOriginal", "Direcao", "Valor", "Mes", "Tipo"]
    );
  }

  if($("selectedTable")){
    $("selectedTable").innerHTML = tableHtml(
      BASE_SELECTED.slice(0, 150),
      ["Data", "Unidade", "Banco", "Denominação", "Valor", "Mes", "Tipo"]
    );
  }
}

function renderKpis(){
  const months = [...new Set(BASE_SELECTED.map(r => r.Mes))];
  const total = BASE_SELECTED.reduce((a, b) => a + b.Valor, 0);

  if($("kRaw")) $("kRaw").textContent = BASE_RAW.length.toLocaleString("pt-BR");
  if($("kDenom")) $("kDenom").textContent = DENOM_SUMMARY.length.toLocaleString("pt-BR");
  if($("kMonths")) $("kMonths").textContent = months.length.toLocaleString("pt-BR");
  if($("kTotal")) $("kTotal").textContent = fmtBRL(total);
}

function exportWorkbook(){
  if(!BASE_RAW.length){
    alert("Importe um arquivo antes de exportar.");
    return;
  }

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(BASE_RAW),
    "BASE_PADRONIZADA"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(BASE_SELECTED),
    "BASE_SELECIONADA"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(buildPivot(BASE_SELECTED)),
    "PIVOT_MENSAL"
  );

  const safeUnit = normalizeSearchText(CURRENT_UNIT).replace(/\s+/g, "_");
  XLSX.writeFile(wb, `base_bank_analytics_${safeUnit}.xlsx`);
}

function buildPivot(rows){
  const months = [...new Set(rows.map(r => r.Mes))].sort();
  const map = new Map();

  rows.forEach(r => {
    const d = r["Denominação"];
    if(!map.has(d)) map.set(d, {});
    const obj = map.get(d);
    obj[r.Mes] = (obj[r.Mes] || 0) + r.Valor;
  });

  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([d, values]) => {
      const obj = { "Denominação": d };
      months.forEach(m => obj[m] = round2(values[m] || 0));
      return obj;
    });
}

/* =========================================================
   RESET
========================================================= */

function resetAll(){
  BASE_RAW = [];
  BASE_SELECTED = [];
  DENOM_SUMMARY = [];
  SELECTED_DENOMS = new Set();
  SELECTED_FILE = null;
  CURRENT_UNIT = "Unidade não identificada";

  if($("fileInput")) $("fileInput").value = "";
  if($("fileName")) $("fileName").textContent = "Nenhum arquivo selecionado";
  if($("denomList")){
    $("denomList").innerHTML =
      `<div class="empty">Processe um arquivo para listar os lançamentos agrupados.</div>`;
  }

  [
    "rawTable", "selectedTable", "outlierTable", "rankingTable",
    "newExpensesTable", "abnormalExpensesTable"
  ].forEach(id => {
    if($(id)) $(id).innerHTML = "";
  });

  destroyCostCharts();
  destroyFlowCharts();
  renderKpis();
  updateFlowKpis(0, 0, 0, 0);

  if($("btnExport")) $("btnExport").disabled = true;

  setStatus("Aguardando arquivo...");
  setMiniStatus("Aguardando arquivo");
}

function resetDataOnly(){
  BASE_RAW = [];
  BASE_SELECTED = [];
  DENOM_SUMMARY = [];
  SELECTED_DENOMS = new Set();
  destroyCostCharts();
  destroyFlowCharts();
}

/* =========================================================
   HELPERS
========================================================= */

function normalizeHeader(v){
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function norm(v){
  return String(v ?? "").replace(/\u00A0/g, " ").trim();
}

function parseDate(v){
  if(!v) return null;
  if(v instanceof Date && !isNaN(v)) return v;

  const s = norm(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);

  if(m){
    let y = Number(m[3]);
    if(y < 100) y += 2000;
    return new Date(y, Number(m[2]) - 1, Number(m[1]));
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m){
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function parseValue(v){
  if(v === null || v === undefined || v === "") return null;
  if(typeof v === "number") return Number.isFinite(v) ? v : null;

  let s = norm(v);
  if(!s || s === "-" || s === "—") return null;

  let negative = false;
  if(/^\(.*\)$/.test(s)){
    negative = true;
    s = s.slice(1, -1);
  }
  if(s.includes("-")) negative = true;

  s = s
    .replace(/R\$/g, "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  if(s.includes(",") && s.includes(".")){
    s = s.replace(/\./g, "").replace(",", ".");
  }else if(s.includes(",") && !s.includes(".")){
    s = s.replace(",", ".");
  }

  s = s.replace(/-/g, "");

  const n = Number(s);
  if(!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function normalizeDescription(v){
  return norm(v).replace(/\s+/g, " ").trim().toUpperCase();
}

function toYM(d){
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toISODate(d){
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateBR(d){
  return d.toLocaleDateString("pt-BR");
}

function round2(n){
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmtBRL(n){
  return Number(n || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function rollingMedian(values, window = 3){
  return values.map((_, i) =>
    median(values.slice(Math.max(0, i - window + 1), i + 1))
  );
}

function median(arr){
  const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if(!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function tableHtml(rows, cols){
  if(!rows.length) return `<div class="empty">Sem dados.</div>`;

  let html = "<table><thead><tr>";
  cols.forEach(c => html += `<th>${escapeHtml(c)}</th>`);
  html += "</tr></thead><tbody>";

  rows.forEach(r => {
    html += "<tr>";
    cols.forEach(c => {
      const v = r[c];
      const isNum = typeof v === "number";
      html += `<td class="${isNum ? "num" : ""}">${escapeHtml(formatCell(v))}</td>`;
    });
    html += "</tr>";
  });

  html += "</tbody></table>";
  return html;
}

function formatCell(v){
  if(typeof v === "number"){
    return v.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  return String(v ?? "");
}

function escapeHtml(v){
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(v){
  return escapeHtml(v).replace(/'/g, "&#039;");
}

function setStatus(msg){
  const box = $("statusBox");
  if(box) box.classList.remove("error");
  if($("status")) $("status").textContent = msg;
}

function setError(msg){
  const box = $("statusBox");
  if(box) box.classList.add("error");
  if($("status")) $("status").textContent = msg;
  setMiniStatus("Erro");
}

function clearError(){
  const box = $("statusBox");
  if(box) box.classList.remove("error");
}

function setMiniStatus(msg){
  if($("miniStatus")) $("miniStatus").textContent = msg;
}
