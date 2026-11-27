function num(id) {
  var v = document.getElementById(id).value;
  return v === "" ? null : Number(v);
}
function text(id) {
  return document.getElementById(id).value.trim();
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function parseForm(formStr) {
  var parts = formStr.toUpperCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
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
    played: played, wins: wins, draws: draws, losses: losses, gf: gf, ga: ga,
    avgGF: played ? gf / played : 0,
    avgGA: played ? ga / played : 0,
    winPct: played ? (wins / played) * 100 : 0,
    drawPct: played ? (draws / played) * 100 : 0,
    lossPct: played ? (losses / played) * 100 : 0,
    form: form,
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
  var sa = strength(a);
  var sb = strength(b);
  var avgDraw = ((a.played ? a.draws / a.played : 0) + (b.played ? b.draws / b.played : 0)) / 2;
  var drawProb = clamp(avgDraw * 100, 18, 35);
  var remaining = 100 - drawProb;
  var total = sa + sb || 1;
  var homeProb = remaining * (sa / total);
  var awayProb = remaining - homeProb;
  var sum = homeProb + drawProb + awayProb;
  return {
    home: (homeProb / sum) * 100,
    draw: (drawProb / sum) * 100,
    away: (awayProb / sum) * 100
  };
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

function buildSummary(a, b, p) {
  var favorite = p.home > p.away ? a.name : b.name;
  var diff = Math.abs(p.home - p.away);
  var balance = diff < 8 ? "un partido bastante equilibrado" : "una ligera ventaja para " + favorite;
  var betterAttack = a.avgGF === b.avgGF ? "ambos tienen promedio goleador similar" : (a.avgGF > b.avgGF ? a.name + " tiene mejor promedio ofensivo" : b.name + " tiene mejor promedio ofensivo");
  var betterDefense = a.avgGA === b.avgGA ? "ambas defensas reciben goles en promedio similar" : (a.avgGA < b.avgGA ? a.name + " recibe menos goles" : b.name + " recibe menos goles");
  return "Según los datos ingresados, el modelo estima " + balance + ". " +
    betterAttack + " (" + fmt(a.avgGF) + " vs " + fmt(b.avgGF) + " goles a favor por partido). " +
    betterDefense + " (" + fmt(a.avgGA) + " vs " + fmt(b.avgGA) + " goles en contra por partido). " +
    "Forma reciente: " + a.name + " " + a.form.display + ", " + b.name + " " + b.form.display + ". " +
    "Probabilidad estimada: " + a.name + " " + fmt(p.home,1) + "%, Empate " + fmt(p.draw,1) + "%, " + b.name + " " + fmt(p.away,1) + "%. " +
    "Esta es una estimación matemática basada en estadísticas, no una garantía del resultado.";
}

document.getElementById("stats-form").addEventListener("submit", function(e) {
  e.preventDefault();
  var a = getTeam("A");
  var b = getTeam("B");
  if (a.wins + a.draws + a.losses > a.played || b.wins + b.draws + b.losses > b.played) {
    alert("Revisa los datos: victorias + empates + derrotas no puede ser mayor que partidos jugados.");
    return;
  }
  var p = calcProb(a, b);
  document.getElementById("thA").textContent = a.name;
  document.getElementById("thB").textContent = b.name;

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

  document.getElementById("summary-text").textContent = buildSummary(a, b, p);
  document.getElementById("results").hidden = false;
});
