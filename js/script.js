function num(id) {
  var v = document.getElementById(id).value;
  return v === "" ? null : Number(v);
}
function text(id) { return document.getElementById(id).value.trim(); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function setVal(id, value) { var el = document.getElementById(id); if (el) el.value = value ?? ""; }

var API_BASE = (window.location.protocol === "file:" || window.location.port !== "3002")
  ? "http://localhost:3002" : "";

function parseForm(formStr) {
  var parts = (formStr || "").toUpperCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
  var valid = parts.filter(function(p){ return ["G","W","E","D","P","L"].indexOf(p) !== -1; }).slice(0,5);
  var points = 0;
  valid.forEach(function(p){
    if (p === "G" || p === "W") points += 3;
    else if (p === "E" || p === "D") points += 1;
  });
  var max = valid.length * 3;
  return { points: points, max: max, ratio: max ? points / max : 0, display: valid.join("-") || "N/A" };
}

function markEstimated(id, estimated) {
  var el = document.getElementById("est-" + id);
  if (!el) return;
  el.textContent = estimated ? "estimado" : "manual";
  el.className = "badge-est" + (estimated ? "" : " manual");
}

function getTeam(prefix) {
  var played = num("played" + prefix) || 0;
  var wins = num("wins" + prefix) || 0;
  var draws = num("draws" + prefix) || 0;
  var losses = num("losses" + prefix) || 0;
  var gf = num("gf" + prefix) || 0;
  var ga = num("ga" + prefix) || 0;
  var form = parseForm(text("form" + prefix));
  return {
    name: text("name" + prefix) || ("Equipo " + prefix),
    played, wins, draws, losses, gf, ga,
    avgGF: played ? gf / played : 0,
    avgGA: played ? ga / played : 0,
    winPct: played ? (wins / played) * 100 : 0,
    drawPct: played ? (draws / played) * 100 : 0,
    lossPct: played ? (losses / played) * 100 : 0,
    form,
    shots: num("shots" + prefix),
    corners: num("corners" + prefix),
    yc: num("yc" + prefix),
    rc: num("rc" + prefix)
  };
}

function strength(t) {
  var gdFactor = clamp((t.avgGF - t.avgGA + 3) / 6, 0, 1);
  var winFactor = t.played ? t.wins / t.played : 0;
  return (winFactor * 0.45) + (gdFactor * 0.35) + (t.form.ratio * 0.20);
}

function calcProb1X2(a, b) {
  var sa = strength(a) + 0.03;
  var sb = strength(b);
  var avgDraw = ((a.played ? a.draws / a.played : 0) + (b.played ? b.draws / b.played : 0)) / 2;
  var drawProb = clamp(avgDraw * 100, 18, 35);
  var remaining = 100 - drawProb;
  var total = sa + sb || 1;
  var homeProb = remaining * (sa / total);
  var awayProb = remaining - homeProb;
  var sum = homeProb + drawProb + awayProb;
  return { home: (homeProb / sum) * 100, draw: (drawProb / sum) * 100, away: (awayProb / sum) * 100 };
}

function poisson(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  var p = Math.exp(-lambda);
  for (var i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function goalMarkets(a, b) {
  var lambdaH = Math.max(0.05, a.avgGF * 0.7 + b.avgGA * 0.3);
  var lambdaA = Math.max(0.05, b.avgGF * 0.7 + a.avgGA * 0.3);
  var maxGoals = 10;
  var pH = [], pA = [];
  for (var i = 0; i <= maxGoals; i++) { pH.push(poisson(i, lambdaH)); pA.push(poisson(i, lambdaA)); }
  var totalDist = Array(21).fill(0);
  var bttsYes = 0;
  for (var h = 0; h <= maxGoals; h++) {
    for (var aw = 0; aw <= maxGoals; aw++) {
      var p = pH[h] * pA[aw];
      var t = h + aw;
      if (t <= 20) totalDist[t] += p;
      if (h >= 1 && aw >= 1) bttsYes += p;
    }
  }
  var under15 = 0, under25 = 0;
  for (var t2 = 0; t2 <= 20; t2++) {
    if (t2 <= 1) under15 += totalDist[t2];
    if (t2 <= 2) under25 += totalDist[t2];
  }
  return {
    lambdaH, lambdaA, expectedTotal: lambdaH + lambdaA,
    bttsYes: bttsYes * 100, bttsNo: (1 - bttsYes) * 100,
    over15: (1 - under15) * 100, under15: under15 * 100,
    over25: (1 - under25) * 100, under25: under25 * 100
  };
}

function poissonOverProb(lambda, line) {
  var threshold = Math.floor(line);
  var cum = 0;
  for (var k = 0; k <= threshold; k++) cum += poisson(k, lambda);
  return { over: (1 - cum) * 100, under: cum * 100 };
}

function fmt(n, digits) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toFixed(digits === undefined ? 2 : digits);
}
function addRow(body, label, va, vb) {
  var tr = document.createElement("tr");
  tr.innerHTML = "<td>" + label + "</td><td>" + va + "</td><td>" + vb + "</td>";
  body.appendChild(tr);
}
function addMarket(body, market, result, prob) {
  var tr = document.createElement("tr");
  tr.innerHTML = "<td>" + market + "</td><td>" + result + "</td><td><strong>" + prob + "</strong></td>";
  body.appendChild(tr);
}

function buildSummary(a, b, p1x2, gm, expCards, expShots, expCorners, matchInfo) {
  var favorite = p1x2.home > p1x2.away ? a.name : b.name;
  var diff = Math.abs(p1x2.home - p1x2.away);
  var balance = diff < 8 ? "un partido equilibrado" : "una ventaja estimada para " + favorite;
  var matchLine = matchInfo ? (matchInfo.homeTeam.name + " (Local) vs " + matchInfo.awayTeam.name + " (Visitante). ") : "";
  return matchLine + "El modelo estima " + balance + ". " +
    "Goles esperados: " + fmt(gm.lambdaH,2) + " - " + fmt(gm.lambdaA,2) + " (total " + fmt(gm.expectedTotal,2) + "). " +
    "BTTS Sí " + fmt(gm.bttsYes,1) + "%, Over 2.5 " + fmt(gm.over25,1) + "%. " +
    "Totales estimados: tarjetas " + fmt(expCards,1) + ", tiros " + fmt(expShots,1) + ", córners " + fmt(expCorners,1) + ". " +
    "Las métricas marcadas como estimadas usan promedios por competición y son editables. Estimación estadística, no garantía.";
}

function renderResult(a, b, matchInfo) {
  if (a.wins + a.draws + a.losses > a.played || b.wins + b.draws + b.losses > b.played) {
    alert("Revisa los datos: victorias + empates + derrotas no puede ser mayor que partidos jugados.");
    return;
  }
  var p1x2 = calcProb1X2(a, b);
  var gm = goalMarkets(a, b);
  var lineCards = num("lineCards") ?? 3.5;
  var lineShots = num("lineShots") ?? 24.5;
  var lineCorners = num("lineCorners") ?? 9.5;
  var expCards = (a.yc ?? 0) + (a.rc ?? 0) + (b.yc ?? 0) + (b.rc ?? 0);
  var expShots = (a.shots ?? 0) + (b.shots ?? 0);
  var expCorners = (a.corners ?? 0) + (b.corners ?? 0);
  var cardsOU = poissonOverProb(Math.max(0.1, expCards), lineCards);
  var shotsOU = poissonOverProb(Math.max(0.1, expShots), lineShots);
  var cornersOU = poissonOverProb(Math.max(0.1, expCorners), lineCorners);

  document.getElementById("thA").textContent = a.name + " (Local)";
  document.getElementById("thB").textContent = b.name + " (Visitante)";
  document.getElementById("labelA").textContent = "Local: " + a.name;
  document.getElementById("labelB").textContent = "Visitante: " + b.name;
  document.getElementById("probability").innerHTML =
    '<div class="prob-box"><div>' + a.name + ' gana</div><div class="value">' + fmt(p1x2.home,1) + '%</div></div>' +
    '<div class="prob-box"><div>Empate</div><div class="value">' + fmt(p1x2.draw,1) + '%</div></div>' +
    '<div class="prob-box"><div>' + b.name + ' gana</div><div class="value">' + fmt(p1x2.away,1) + '%</div></div>';

  var mb = document.getElementById("markets-body");
  mb.innerHTML = "";
  addMarket(mb, "Ambos marcan (BTTS)", "Sí", fmt(gm.bttsYes,1) + "%");
  addMarket(mb, "Ambos marcan (BTTS)", "No", fmt(gm.bttsNo,1) + "%");
  addMarket(mb, "Total goles", "Más de 1.5", fmt(gm.over15,1) + "%");
  addMarket(mb, "Total goles", "Menos de 1.5", fmt(gm.under15,1) + "%");
  addMarket(mb, "Total goles", "Más de 2.5", fmt(gm.over25,1) + "%");
  addMarket(mb, "Total goles", "Menos de 2.5", fmt(gm.under25,1) + "%");
  addMarket(mb, "Goles esperados", a.name + " / " + b.name + " / Total", fmt(gm.lambdaH,2) + " / " + fmt(gm.lambdaA,2) + " / " + fmt(gm.expectedTotal,2));
  addMarket(mb, "Total tarjetas (est.)", "Esperado", fmt(expCards,2));
  addMarket(mb, "Total tarjetas (línea " + fmt(lineCards,1) + ")", "Más de " + fmt(lineCards,1), fmt(cardsOU.over,1) + "%");
  addMarket(mb, "Total tarjetas (línea " + fmt(lineCards,1) + ")", "Menos de " + fmt(lineCards,1), fmt(cardsOU.under,1) + "%");
  addMarket(mb, "Total tiros (est.)", "Esperado", fmt(expShots,2));
  addMarket(mb, "Total tiros (línea " + fmt(lineShots,1) + ")", "Más de " + fmt(lineShots,1), fmt(shotsOU.over,1) + "%");
  addMarket(mb, "Total tiros (línea " + fmt(lineShots,1) + ")", "Menos de " + fmt(lineShots,1), fmt(shotsOU.under,1) + "%");
  addMarket(mb, "Total córners (est.)", "Esperado", fmt(expCorners,2));
  addMarket(mb, "Total córners (línea " + fmt(lineCorners,1) + ")", "Más de " + fmt(lineCorners,1), fmt(cornersOU.over,1) + "%");
  addMarket(mb, "Total córners (línea " + fmt(lineCorners,1) + ")", "Menos de " + fmt(lineCorners,1), fmt(cornersOU.under,1) + "%");

  var body = document.getElementById("results-body");
  body.innerHTML = "";
  addRow(body, "Promedio goles a favor", fmt(a.avgGF), fmt(b.avgGF));
  addRow(body, "Promedio goles en contra", fmt(a.avgGA), fmt(b.avgGA));
  addRow(body, "% Victorias", fmt(a.winPct,1) + "%", fmt(b.winPct,1) + "%");
  addRow(body, "% Empates", fmt(a.drawPct,1) + "%", fmt(b.drawPct,1) + "%");
  addRow(body, "% Derrotas", fmt(a.lossPct,1) + "%", fmt(b.lossPct,1) + "%");
  addRow(body, "Forma últimos 5", a.form.display + " (" + a.form.points + " pts)", b.form.display + " (" + b.form.points + " pts)");
  addRow(body, "Tiros promedio", fmt(a.shots), fmt(b.shots));
  addRow(body, "Córners promedio", fmt(a.corners), fmt(b.corners));
  addRow(body, "Tarjetas amarillas prom.", fmt(a.yc), fmt(b.yc));
  addRow(body, "Tarjetas rojas prom.", fmt(a.rc), fmt(b.rc));

  document.getElementById("summary-text").textContent = buildSummary(a, b, p1x2, gm, expCards, expShots, expCorners, matchInfo);
  document.getElementById("results").hidden = false;
}

var currentMatches = [];
var selectedMatch = null;
function setStatus(msg, isError) {
  var el = document.getElementById("match-status");
  el.textContent = msg || "";
  el.className = "status" + (isError ? " error" : "");
}

async function fetchJson(url) {
  var res;
  try {
    res = await fetch(API_BASE + url);
  } catch (e) {
    throw new Error("No se pudo conectar al servidor local. Abre 'Iniciar FutbolStats.bat' o ejecuta 'npm.cmd start' en la carpeta APP.");
  }
  var data = await res.json().catch(function(){ return {}; });
  if (!res.ok) throw new Error(data.error || ("Error HTTP " + res.status));
  return data;
}

async function loadCompetitions() {
  try {
    var data = await fetchJson("/api/competitions");
    var sel = document.getElementById("competition-select");
    sel.innerHTML = '<option value="">Selecciona una competición</option>';
    (data.competitions || []).forEach(function(c){
      var opt = document.createElement("option");
      opt.value = c.code || c.id;
      opt.textContent = c.name + (c.area ? " (" + c.area + ")" : "");
      sel.appendChild(opt);
    });
  } catch (e) {
    setStatus("No se pudieron cargar competiciones. " + e.message, true);
  }
}

function renderMatches() {
  var q = text("match-search").toLowerCase();
  var list = document.getElementById("matches-list");
  list.innerHTML = "";
  var filtered = currentMatches.filter(function(m){
    if (!q) return true;
    var hay = (m.homeTeam.name + " " + m.awayTeam.name + " " + (m.homeTeam.shortName||"") + " " + (m.awayTeam.shortName||"")).toLowerCase();
    return hay.indexOf(q) !== -1;
  });
  if (!filtered.length) { list.innerHTML = '<div class="status">No hay partidos para ese filtro.</div>'; return; }
  filtered.forEach(function(m){
    var item = document.createElement("div");
    item.className = "match-item";
    var date = new Date(m.utcDate);
    var dateStr = isNaN(date) ? m.utcDate : date.toLocaleString();
    item.innerHTML = '<div><div class="match-teams">' + m.homeTeam.name + ' (Local) vs ' + m.awayTeam.name + ' (Visitante)</div>' +
      '<div class="match-meta">' + dateStr + ' · ' + (m.competition?.name || "") + '</div></div>' +
      '<button type="button" class="secondary" data-id="' + m.id + '">Analizar</button>';
    item.querySelector("button").addEventListener("click", function(){ selectMatch(m.id); });
    list.appendChild(item);
  });
}

async function loadMatches() {
  var comp = document.getElementById("competition-select").value;
  if (!comp) { setStatus("Selecciona una competición.", true); return; }
  setStatus("Cargando partidos...");
  try {
    var data = await fetchJson("/api/matches?competition=" + encodeURIComponent(comp) + "&status=SCHEDULED&days=20");
    currentMatches = data.matches || [];
    selectedMatch = null;
    document.getElementById("selected-match").hidden = true;
    renderMatches();
    setStatus(currentMatches.length ? ("Se cargaron " + currentMatches.length + " partidos.") : "No se encontraron partidos próximos en ese rango.");
  } catch (e) { setStatus("Error cargando partidos: " + e.message, true); }
}

function fillTeam(prefix, stats, est) {
  setVal("name" + prefix, stats.name || "");
  setVal("played" + prefix, stats.played ?? 0);
  setVal("wins" + prefix, stats.wins ?? 0);
  setVal("draws" + prefix, stats.draws ?? 0);
  setVal("losses" + prefix, stats.losses ?? 0);
  setVal("gf" + prefix, stats.gf ?? 0);
  setVal("ga" + prefix, stats.ga ?? 0);
  setVal("form" + prefix, stats.form || "");
  if (est) {
    setVal("shots" + prefix, est.shots);
    setVal("corners" + prefix, est.corners);
    setVal("yc" + prefix, est.yellow);
    setVal("rc" + prefix, est.red);
    markEstimated("shots" + prefix, true);
    markEstimated("corners" + prefix, true);
    markEstimated("yc" + prefix, true);
    markEstimated("rc" + prefix, true);
  }
}

function bindManualFlags() {
  ["shotsA","cornersA","ycA","rcA","shotsB","cornersB","ycB","rcB"].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.addEventListener("input", function(){ markEstimated(id, false); });
  });
}

async function selectMatch(matchId) {
  setStatus("Cargando estadísticas del partido...");
  try {
    var data = await fetchJson("/api/match-analysis?matchId=" + encodeURIComponent(matchId));
    selectedMatch = data.match;
    fillTeam("A", data.home, data.estimated?.home);
    fillTeam("B", data.away, data.estimated?.away);
    document.getElementById("labelA").textContent = "Local: " + data.home.name;
    document.getElementById("labelB").textContent = "Visitante: " + data.away.name;
    var box = document.getElementById("selected-match");
    var date = new Date(selectedMatch.utcDate);
    box.hidden = false;
    var estNote = data.estimated?.note ? '<br><span class="hint" style="color:#fcd34d">' + data.estimated.note + '</span>' : '';
    box.innerHTML = "<strong>Partido seleccionado:</strong> " + data.home.name + " (Local) vs " + data.away.name + " (Visitante)<br>" +
      "<span class='hint' style='color:#bbf7d0'>Fecha: " + (isNaN(date)?selectedMatch.utcDate:date.toLocaleString()) +
      " · " + (selectedMatch.competition?.name || "") + "</span>" + estNote;
    setStatus("Datos cargados. Puedes ajustar valores y calcular.");
    renderResult(getTeam("A"), getTeam("B"), selectedMatch);
  } catch (e) { setStatus("Error al cargar análisis: " + e.message, true); }
}

document.getElementById("load-matches-btn").addEventListener("click", loadMatches);
document.getElementById("match-search").addEventListener("input", renderMatches);
document.getElementById("stats-form").addEventListener("submit", function(e) {
  e.preventDefault();
  renderResult(getTeam("A"), getTeam("B"), selectedMatch);
});

bindManualFlags();
loadCompetitions();
