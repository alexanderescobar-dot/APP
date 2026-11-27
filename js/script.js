function num(id) {
  var v = document.getElementById(id).value;
  return v === "" ? null : Number(v);
}
function text(id) { return document.getElementById(id).value.trim(); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function setVal(id, value) { var el = document.getElementById(id); if (el) el.value = value ?? ""; }

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
    pos: num("pos" + prefix),
    yc: num("yc" + prefix)
  };
}

function strength(t) {
  var gdFactor = clamp((t.avgGF - t.avgGA + 3) / 6, 0, 1);
  var winFactor = t.played ? t.wins / t.played : 0;
  return (winFactor * 0.45) + (gdFactor * 0.35) + (t.form.ratio * 0.20);
}

function calcProb(a, b) {
  var sa = strength(a) + 0.03; // leve ventaja local
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

function fmt(n, digits) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toFixed(digits === undefined ? 2 : digits);
}

function addRow(body, label, va, vb) {
  var tr = document.createElement("tr");
  tr.innerHTML = "<td>" + label + "</td><td>" + va + "</td><td>" + vb + "</td>";
  body.appendChild(tr);
}

function buildSummary(a, b, p, matchInfo) {
  var favorite = p.home > p.away ? a.name : b.name;
  var diff = Math.abs(p.home - p.away);
  var balance = diff < 8 ? "un partido bastante equilibrado" : "una ventaja estimada para " + favorite;
  var betterAttack = a.avgGF === b.avgGF ? "ambos muestran promedio goleador similar" : (a.avgGF > b.avgGF ? a.name + " llega con mejor promedio ofensivo" : b.name + " llega con mejor promedio ofensivo");
  var betterDefense = a.avgGA === b.avgGA ? "ambas defensas reciben goles en promedio similar" : (a.avgGA < b.avgGA ? a.name + " concede menos goles" : b.name + " concede menos goles");
  var matchLine = matchInfo ? ("Partido: " + matchInfo.homeTeam.name + " (Local) vs " + matchInfo.awayTeam.name + " (Visitante). ") : "";
  return matchLine + "Según los datos analizados, el modelo estima " + balance + ". " +
    betterAttack + " (" + fmt(a.avgGF) + " vs " + fmt(b.avgGF) + " goles a favor por partido). " +
    betterDefense + " (" + fmt(a.avgGA) + " vs " + fmt(b.avgGA) + " goles en contra por partido). " +
    "Forma reciente: " + a.name + " " + a.form.display + ", " + b.name + " " + b.form.display + ". " +
    "Probabilidad estimada: " + a.name + " " + fmt(p.home,1) + "%, Empate " + fmt(p.draw,1) + "%, " + b.name + " " + fmt(p.away,1) + "%. " +
    "Esta es una estimación matemática basada en estadísticas; no garantiza el resultado.";
}

function renderResult(a, b, matchInfo) {
  if (a.wins + a.draws + a.losses > a.played || b.wins + b.draws + b.losses > b.played) {
    alert("Revisa los datos: victorias + empates + derrotas no puede ser mayor que partidos jugados.");
    return;
  }
  var p = calcProb(a, b);
  document.getElementById("thA").textContent = a.name + " (Local)";
  document.getElementById("thB").textContent = b.name + " (Visitante)";
  document.getElementById("labelA").textContent = "Local: " + a.name;
  document.getElementById("labelB").textContent = "Visitante: " + b.name;

  var prob = document.getElementById("probability");
  prob.innerHTML =
    '<div class="prob-box"><div>' + a.name + ' gana</div><div class="value">' + fmt(p.home,1) + '%</div></div>' +
    '<div class="prob-box"><div>Empate</div><div class="value">' + fmt(p.draw,1) + '%</div></div>' +
    '<div class="prob-box"><div>' + b.name + ' gana</div><div class="value">' + fmt(p.away,1) + '%</div></div>';

  var body = document.getElementById("results-body");
  body.innerHTML = "";
  addRow(body, "Promedio goles a favor", fmt(a.avgGF), fmt(b.avgGF));
  addRow(body, "Promedio goles en contra", fmt(a.avgGA), fmt(b.avgGA));
  addRow(body, "% Victorias", fmt(a.winPct,1) + "%", fmt(b.winPct,1) + "%");
  addRow(body, "% Empates", fmt(a.drawPct,1) + "%", fmt(b.drawPct,1) + "%");
  addRow(body, "% Derrotas", fmt(a.lossPct,1) + "%", fmt(b.lossPct,1) + "%");
  addRow(body, "Forma últimos 5", a.form.display + " (" + a.form.points + " pts)", b.form.display + " (" + b.form.points + " pts)");
  addRow(body, "Tiros promedio", fmt(a.shots), fmt(b.shots));
  addRow(body, "Posesión promedio", a.pos === null ? "-" : fmt(a.pos,1) + "%", b.pos === null ? "-" : fmt(b.pos,1) + "%");
  addRow(body, "Tarjetas amarillas prom.", fmt(a.yc), fmt(b.yc));

  document.getElementById("summary-text").textContent = buildSummary(a, b, p, matchInfo);
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
  var res = await fetch(url);
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
    setStatus("No se pudieron cargar competiciones. Verifica que el servidor esté corriendo y el token en .env. " + e.message, true);
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
  if (!filtered.length) {
    list.innerHTML = '<div class="status">No hay partidos para ese filtro.</div>';
    return;
  }
  filtered.forEach(function(m){
    var item = document.createElement("div");
    item.className = "match-item";
    var date = new Date(m.utcDate);
    var dateStr = isNaN(date) ? m.utcDate : date.toLocaleString();
    item.innerHTML =
      '<div><div class="match-teams">' + m.homeTeam.name + ' (Local) vs ' + m.awayTeam.name + ' (Visitante)</div>' +
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
  } catch (e) {
    setStatus("Error cargando partidos: " + e.message, true);
  }
}

function fillTeam(prefix, stats) {
  setVal("name" + prefix, stats.name || "");
  setVal("played" + prefix, stats.played ?? 0);
  setVal("wins" + prefix, stats.wins ?? 0);
  setVal("draws" + prefix, stats.draws ?? 0);
  setVal("losses" + prefix, stats.losses ?? 0);
  setVal("gf" + prefix, stats.gf ?? 0);
  setVal("ga" + prefix, stats.ga ?? 0);
  setVal("form" + prefix, stats.form || "");
}

async function selectMatch(matchId) {
  setStatus("Cargando estadísticas del partido...");
  try {
    var data = await fetchJson("/api/match-analysis?matchId=" + encodeURIComponent(matchId));
    selectedMatch = data.match;
    fillTeam("A", data.home);
    fillTeam("B", data.away);
    setVal("shotsA", ""); setVal("posA", ""); setVal("ycA", "");
    setVal("shotsB", ""); setVal("posB", ""); setVal("ycB", "");
    document.getElementById("labelA").textContent = "Local: " + data.home.name;
    document.getElementById("labelB").textContent = "Visitante: " + data.away.name;
    var box = document.getElementById("selected-match");
    var date = new Date(selectedMatch.utcDate);
    box.hidden = false;
    box.innerHTML = "<strong>Partido seleccionado:</strong> " + data.home.name + " (Local) vs " + data.away.name + " (Visitante)<br>" +
      "<span class='hint' style='color:#bbf7d0'>Fecha: " + (isNaN(date)?selectedMatch.utcDate:date.toLocaleString()) +
      " · " + (selectedMatch.competition?.name || "") + "</span>";
    setStatus("Datos cargados. Puedes ajustar valores y calcular.");
    renderResult(getTeam("A"), getTeam("B"), selectedMatch);
  } catch (e) {
    setStatus("Error al cargar análisis: " + e.message, true);
  }
}

document.getElementById("load-matches-btn").addEventListener("click", loadMatches);
document.getElementById("match-search").addEventListener("input", renderMatches);
document.getElementById("stats-form").addEventListener("submit", function(e) {
  e.preventDefault();
  renderResult(getTeam("A"), getTeam("B"), selectedMatch);
});

loadCompetitions();
