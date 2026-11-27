(function(){
  function num(id){ var v=document.getElementById(id).value; return v===""?null:Number(v); }
  function text(id){ return document.getElementById(id).value.trim(); }
  function setVal(id,v){ var el=document.getElementById(id); if(el) el.value = v ?? ""; }
  function fmt(n,d){ if(n==null||isNaN(n)) return "-"; return Number(n).toFixed(d==null?1:d); }
  function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
  function markEst(id, est){ var el=document.getElementById("est-"+id); if(!el) return; el.textContent = est?"estimado":"manual"; el.className="badge-est"+(est?"":" manual"); }

  var API_BASE = (window.location.protocol === "file:" || window.location.port !== "3002") ? "http://localhost:3002" : "";
  var currentGames = []; var selectedGame = null;

  function setStatus(msg, err){ var el=document.getElementById("nba-status"); el.textContent=msg||""; el.className="status"+(err?" error":""); }
  async function fetchJson(url){
    var res; try { res = await fetch(API_BASE + url); } catch(e){ throw new Error("No se pudo conectar al servidor local. Inicia FutbolStats.bat o npm.cmd start."); }
    var data = await res.json().catch(function(){return {};});
    if(!res.ok) throw new Error(data.error || ("Error HTTP "+res.status));
    return data;
  }

  function normalCDF(x, mean, sd){
    var z = (x-mean)/(sd*Math.sqrt(2));
    var t = 1/(1+0.3275911*Math.abs(z));
    var a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429;
    var erf = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-z*z);
    var sign = z < 0 ? -1 : 1;
    return 0.5*(1+sign*erf);
  }

  function getTeam(prefix){
    var played=num("nba-played"+prefix)||1, wins=num("nba-wins"+prefix)||0, losses=num("nba-losses"+prefix)||0;
    return {
      name: text("nba-name"+prefix)||("Equipo "+prefix),
      played, wins, losses,
      avgPF: num("nba-pf"+prefix)||112,
      avgPA: num("nba-pa"+prefix)||112,
      threePT: num("nba-3pt"+prefix)||12.5,
      steals: num("nba-stl"+prefix)||7.5
    };
  }

  function calc(a,b){
    var expHome = (a.avgPF + b.avgPA)/2;
    var expAway = (b.avgPF + a.avgPA)/2;
    var diff = expHome - expAway;
    var sd = 12;
    var homeWin = clamp(normalCDF(diff/sd,0,1/Math.sqrt(2))*100, 1, 99);
    var awayWin = 100-homeWin;
    return { expHome, expAway, total: expHome+expAway, homeWin, awayWin };
  }

  function render(a,b){
    var p = calc(a,b);
    var linePts=num("nba-linePts")??220.5, line3=num("nba-line3")??24.5, lineStl=num("nba-lineStl")??14.5;
    var sdTotal=16, sd3=4, sdStl=3;
    var overPts=(1-normalCDF(linePts,p.total,sdTotal))*100;
    var total3=a.threePT+b.threePT, totalStl=a.steals+b.steals;
    var over3=(1-normalCDF(line3,total3,sd3))*100;
    var overStl=(1-normalCDF(lineStl,totalStl,sdStl))*100;

    document.getElementById("nba-labelA").textContent="Local: "+a.name;
    document.getElementById("nba-labelB").textContent="Visitante: "+b.name;
    document.getElementById("nba-probability").innerHTML =
      '<div class="prob-box"><div>'+a.name+' gana</div><div class="value">'+fmt(p.homeWin,1)+'%</div></div>' +
      '<div class="prob-box"><div>Total pts esperado</div><div class="value">'+fmt(p.total,1)+'</div></div>' +
      '<div class="prob-box"><div>'+b.name+' gana</div><div class="value">'+fmt(p.awayWin,1)+'%</div></div>';

    var mb=document.getElementById("nba-markets-body"); mb.innerHTML="";
    function row(m,r,pr){ var tr=document.createElement("tr"); tr.innerHTML="<td>"+m+"</td><td>"+r+"</td><td><strong>"+pr+"</strong></td>"; mb.appendChild(tr); }
    row("Ganador", a.name, fmt(p.homeWin,1)+"%");
    row("Ganador", b.name, fmt(p.awayWin,1)+"%");
    row("Puntos esperados", a.name+" / "+b.name+" / Total", fmt(p.expHome,1)+" / "+fmt(p.expAway,1)+" / "+fmt(p.total,1));
    row("Total puntos (línea "+fmt(linePts,1)+")", "Más de "+fmt(linePts,1), fmt(overPts,1)+"%");
    row("Total puntos (línea "+fmt(linePts,1)+")", "Menos de "+fmt(linePts,1), fmt(100-overPts,1)+"%");
    row("Total 3PT (est.)", "Esperado", fmt(total3,1));
    row("Total 3PT (línea "+fmt(line3,1)+")", "Más de "+fmt(line3,1), fmt(over3,1)+"%");
    row("Total 3PT (línea "+fmt(line3,1)+")", "Menos de "+fmt(line3,1), fmt(100-over3,1)+"%");
    row("Total robos (est.)", "Esperado", fmt(totalStl,1));
    row("Total robos (línea "+fmt(lineStl,1)+")", "Más de "+fmt(lineStl,1), fmt(overStl,1)+"%");
    row("Total robos (línea "+fmt(lineStl,1)+")", "Menos de "+fmt(lineStl,1), fmt(100-overStl,1)+"%");

    var fav = p.homeWin>=p.awayWin ? a.name : b.name;
    document.getElementById("nba-summary-text").textContent =
      (selectedGame ? (selectedGame.homeTeam.name+" (Local) vs "+selectedGame.awayTeam.name+" (Visitante). ") : "") +
      "El modelo estima favorito a "+fav+". Puntos esperados: "+fmt(p.expHome,1)+"-"+fmt(p.expAway,1)+" (total "+fmt(p.total,1)+"). "+
      "Total 3PT estimado: "+fmt(total3,1)+", total robos estimado: "+fmt(totalStl,1)+". "+
      "3PT y robos son estimados por defecto y editables; la probabilidad es heurística, no garantía.";
    document.getElementById("nba-results").hidden = false;
  }

  function renderGames(){
    var q = text("nba-search").toLowerCase();
    var list = document.getElementById("nba-games-list"); list.innerHTML="";
    var filtered = currentGames.filter(function(g){ return !q || (g.homeTeam.name+" "+g.awayTeam.name).toLowerCase().indexOf(q)!==-1; });
    if(!filtered.length){ list.innerHTML='<div class="status">No hay juegos para ese filtro.</div>'; return; }
    filtered.forEach(function(g){
      var item=document.createElement("div"); item.className="match-item";
      var d=new Date(g.utcDate); var ds=isNaN(d)?g.utcDate:d.toLocaleString();
      item.innerHTML='<div><div class="match-teams">'+g.homeTeam.name+' (Local) vs '+g.awayTeam.name+' (Visitante)</div><div class="match-meta">'+ds+' · NBA</div></div><button type="button" class="secondary">Analizar</button>';
      item.querySelector("button").addEventListener("click", function(){ selectGame(g.id); });
      list.appendChild(item);
    });
  }

  async function loadGames(){
    setStatus("Cargando juegos NBA...");
    try {
      var data = await fetchJson("/api/nba/games");
      currentGames = data.games || [];
      renderGames();
      setStatus(currentGames.length ? ("Se cargaron "+currentGames.length+" juegos.") : "No se encontraron juegos próximos.");
    } catch(e){ setStatus("Error: "+e.message, true); }
  }

  async function selectGame(id){
    setStatus("Cargando análisis NBA...");
    try {
      var data = await fetchJson("/api/nba/game-analysis?eventId="+encodeURIComponent(id));
      selectedGame = data.game;
      var h=data.home, a=data.away, est=data.estimated;
      setVal("nba-nameA",h.name); setVal("nba-playedA",h.played||5); setVal("nba-winsA",h.wins||0); setVal("nba-lossesA",h.losses||0); setVal("nba-pfA",fmt(h.avgPF,1)); setVal("nba-paA",fmt(h.avgPA,1));
      setVal("nba-nameB",a.name); setVal("nba-playedB",a.played||5); setVal("nba-winsB",a.wins||0); setVal("nba-lossesB",a.losses||0); setVal("nba-pfB",fmt(a.avgPF,1)); setVal("nba-paB",fmt(a.avgPA,1));
      setVal("nba-3ptA", est.home.threePT); setVal("nba-stlA", est.home.steals); setVal("nba-3ptB", est.away.threePT); setVal("nba-stlB", est.away.steals);
      ["nba3A","nbastlA","nba3B","nbastlB"].forEach(function(k){ markEst(k,true); });
      var box=document.getElementById("nba-selected"); var d=new Date(selectedGame.utcDate);
      box.hidden=false; box.innerHTML="<strong>Juego seleccionado:</strong> "+h.name+" (Local) vs "+a.name+" (Visitante)<br><span class='hint' style='color:#bbf7d0'>"+(isNaN(d)?selectedGame.utcDate:d.toLocaleString())+" · NBA</span><br><span class='hint' style='color:#fcd34d'>"+(est.note||"")+"</span>";
      setStatus("Datos cargados. Puedes editar y calcular.");
      render(getTeam("A"), getTeam("B"));
    } catch(e){ setStatus("Error: "+e.message, true); }
  }

  ["nba-3ptA","nba-stlA","nba-3ptB","nba-stlB"].forEach(function(id, i){
    var keys=["nba3A","nbastlA","nba3B","nbastlB"];
    var el=document.getElementById(id); if(el) el.addEventListener("input", function(){ markEst(keys[i], false); });
  });

  document.getElementById("nba-load-btn").addEventListener("click", loadGames);
  document.getElementById("nba-search").addEventListener("input", renderGames);
  document.getElementById("nba-form").addEventListener("submit", function(e){ e.preventDefault(); render(getTeam("A"), getTeam("B")); });

  document.querySelectorAll(".tab").forEach(function(btn){
    btn.addEventListener("click", function(){
      document.querySelectorAll(".tab").forEach(function(b){ b.classList.remove("active"); });
      btn.classList.add("active");
      var tab = btn.getAttribute("data-tab");
      document.getElementById("module-futbol").hidden = tab !== "futbol";
      document.getElementById("module-nba").hidden = tab !== "nba";
    });
  });
})();
