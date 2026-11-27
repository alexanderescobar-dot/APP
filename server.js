import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const AF_KEY = process.env.API_FOOTBALL_KEY;
const FD_BASE = "https://api.football-data.org/v4";
const AF_BASE = "https://v3.football.api-sports.io";
const AF_LIGAPRO_ID = 242;
const AF_LIGAPRO_SEASON = Number(process.env.API_FOOTBALL_SEASON) || 2024;

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

const COMP_DEFAULTS = {
  PL:  { shots: 13.5, corners: 5.2, yellow: 1.8, red: 0.08 },
  PD:  { shots: 12.5, corners: 4.8, yellow: 2.3, red: 0.12 },
  SA:  { shots: 13.0, corners: 5.0, yellow: 2.1, red: 0.10 },
  BL1: { shots: 14.0, corners: 5.3, yellow: 1.9, red: 0.09 },
  FL1: { shots: 12.8, corners: 4.9, yellow: 1.9, red: 0.11 },
  DED: { shots: 14.5, corners: 5.5, yellow: 1.7, red: 0.08 },
  PPL: { shots: 12.5, corners: 4.7, yellow: 2.4, red: 0.13 },
  ELC: { shots: 12.5, corners: 5.1, yellow: 1.9, red: 0.09 },
  BSA: { shots: 12.0, corners: 4.8, yellow: 2.3, red: 0.12 },
  CL:  { shots: 13.5, corners: 5.0, yellow: 1.9, red: 0.09 },
  EC:  { shots: 12.0, corners: 4.8, yellow: 2.0, red: 0.10 },
  WC:  { shots: 12.5, corners: 4.9, yellow: 1.8, red: 0.09 },
  LIGAPRO: { shots: 12.2, corners: 4.9, yellow: 2.4, red: 0.12 },
  DEFAULT: { shots: 12.8, corners: 5.0, yellow: 2.0, red: 0.10 }
};
function getDefaults(compCode) { return COMP_DEFAULTS[compCode] || COMP_DEFAULTS.DEFAULT; }

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { cache.delete(key); return null; }
  return hit.value;
}
function setCache(key, value) { cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS }); }

async function fd(pathname) {
  const key = `fd:${pathname}`;
  const cached = getCache(key);
  if (cached) return cached;
  const res = await fetch(`${FD_BASE}${pathname}`, { headers: { "X-Auth-Token": TOKEN } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) { const err = new Error(data.message || data.error || `football-data.org ${res.status}`); err.status = res.status; err.details = data; throw err; }
  setCache(key, data);
  return data;
}

async function af(pathname) {
  const key = `af:${pathname}`;
  const cached = getCache(key);
  if (cached) return cached;
  const res = await fetch(`${AF_BASE}${pathname}`, { headers: { "x-apisports-key": AF_KEY } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) { const err = new Error(data.message || `api-football ${res.status}`); err.status = res.status; err.details = data; throw err; }
  if (data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length)) {
    const msg = typeof data.errors === "object" && !Array.isArray(data.errors) ? Object.values(data.errors).join("; ") : JSON.stringify(data.errors);
    const err = new Error(msg || "Error API-Football"); err.status = 502; err.details = data.errors; throw err;
  }
  setCache(key, data);
  return data;
}

app.use(express.static(__dirname));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, hasFDToken: !!TOKEN && TOKEN !== "PEGA_AQUI_TU_TOKEN", hasAFKey: !!AF_KEY && AF_KEY !== "PEGA_AQUI_TU_KEY" }));

function ensureFD(res) {
  if (!TOKEN || TOKEN === "PEGA_AQUI_TU_TOKEN") { res.status(500).json({ error: "Falta FOOTBALL_DATA_TOKEN en .env" }); return false; }
  return true;
}
function ensureAF(res) {
  if (!AF_KEY || AF_KEY === "PEGA_AQUI_TU_KEY") { res.status(500).json({ error: "Falta API_FOOTBALL_KEY en .env para LigaPro" }); return false; }
  return true;
}

app.get("/api/competitions", async (req, res) => {
  try {
    const result = [];
    if (TOKEN && TOKEN !== "PEGA_AQUI_TU_TOKEN") {
      const data = await fd("/competitions");
      const allowed = new Set(["TIER_ONE"]);
      for (const c of (data.competitions || [])) {
        if (allowed.has(c.plan) && (c.type === "LEAGUE" || c.type === "CUP")) {
          result.push({ id: String(c.code || c.id), name: c.name, code: c.code, area: c.area?.name, emblem: c.emblem, source: "fd" });
        }
      }
    }
    if (AF_KEY && AF_KEY !== "PEGA_AQUI_TU_KEY") {
      result.push({ id: "LIGAPRO", name: "LigaPro Serie A", code: "LIGAPRO", area: "Ecuador", emblem: null, source: "af" });
    }
    res.json({ competitions: result });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

function toDateStr(d) { return d.toISOString().slice(0,10); }

app.get("/api/matches", async (req, res) => {
  try {
    const { competition, status = "SCHEDULED", days = "14" } = req.query;
    if (!competition) return res.status(400).json({ error: "competition requerida" });
    const d = Math.max(1, Math.min(30, parseInt(days, 10) || 14));

    if (competition === "LIGAPRO") {
      if (!ensureAF(res)) return;
      const today = new Date();
      const from = toDateStr(today);
      const toDate = new Date(today); toDate.setDate(toDate.getDate() + d);
      const to = toDateStr(toDate);
      const data = await af(`/fixtures?league=${AF_LIGAPRO_ID}&season=${AF_LIGAPRO_SEASON}&from=${from}&to=${to}`);
      const wanted = new Set(["NS", "TBD", "1H", "2H", "HT", "ET", "P", "LIVE"]);
      const matches = (data.response || [])
        .filter(f => status === "SCHEDULED" ? ["NS","TBD"].includes(f.fixture?.status?.short) : wanted.has(f.fixture?.status?.short))
        .map(f => ({
          id: f.fixture.id,
          utcDate: f.fixture.date,
          status: f.fixture.status?.short === "NS" || f.fixture.status?.short === "TBD" ? "SCHEDULED" : f.fixture.status?.short,
          matchday: f.league?.round,
          competition: { name: "LigaPro Serie A", code: "LIGAPRO", id: AF_LIGAPRO_ID },
          homeTeam: { id: f.teams?.home?.id, name: f.teams?.home?.name, shortName: f.teams?.home?.name, crest: f.teams?.home?.logo },
          awayTeam: { id: f.teams?.away?.id, name: f.teams?.away?.name, shortName: f.teams?.away?.name, crest: f.teams?.away?.logo }
        }));
      return res.json({ matches });
    }

    if (!ensureFD(res)) return;
    const today = new Date();
    const from = toDateStr(today);
    const toDate = new Date(today); toDate.setDate(toDate.getDate() + d);
    const to = toDateStr(toDate);
    const data = await fd(`/competitions/${encodeURIComponent(competition)}/matches?status=${encodeURIComponent(status)}&dateFrom=${from}&dateTo=${to}`);
    const matches = (data.matches || []).map(m => ({
      id: m.id, utcDate: m.utcDate, status: m.status, matchday: m.matchday,
      competition: { name: m.competition?.name, code: m.competition?.code, id: m.competition?.id },
      homeTeam: { id: m.homeTeam?.id, name: m.homeTeam?.name, shortName: m.homeTeam?.shortName, crest: m.homeTeam?.crest },
      awayTeam: { id: m.awayTeam?.id, name: m.awayTeam?.name, shortName: m.awayTeam?.shortName, crest: m.awayTeam?.crest }
    }));
    res.json({ matches });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, details: e.details }); }
});

function computeTeamStatsFD(teamId, matches, teamName) {
  const finished = (matches || []).filter(m => m.status === "FINISHED" || m.status === "AWARDED");
  const last = finished.slice(-5);
  let wins=0, draws=0, losses=0, gf=0, ga=0; const form = [];
  for (const m of last) {
    const isHome = m.homeTeam?.id === teamId;
    const gFor = isHome ? m.score?.fullTime?.home : m.score?.fullTime?.away;
    const gAgainst = isHome ? m.score?.fullTime?.away : m.score?.fullTime?.home;
    if (gFor == null || gAgainst == null) continue;
    gf += gFor; ga += gAgainst;
    if (gFor > gAgainst) { wins++; form.push("G"); }
    else if (gFor < gAgainst) { losses++; form.push("P"); }
    else { draws++; form.push("E"); }
  }
  const played = wins + draws + losses;
  return { name: teamName, played, wins, draws, losses, gf, ga, avgGF: played ? gf/played:0, avgGA: played ? ga/played:0, winPct: played ? wins/played*100:0, drawPct: played ? draws/played*100:0, lossPct: played ? losses/played*100:0, form: form.join("-") || "N/A", sourceMatches: played };
}

function computeTeamStatsAF(teamId, fixtures, teamName) {
  const finished = (fixtures || []).filter(f => ["FT","AET","PEN"].includes(f.fixture?.status?.short)).sort((a,b)=> new Date(a.fixture.date)-new Date(b.fixture.date));
  const last = finished.slice(-5);
  let wins=0, draws=0, losses=0, gf=0, ga=0; const form = [];
  for (const f of last) {
    const isHome = f.teams?.home?.id === teamId;
    const gFor = isHome ? f.goals?.home : f.goals?.away;
    const gAgainst = isHome ? f.goals?.away : f.goals?.home;
    if (gFor == null || gAgainst == null) continue;
    gf += gFor; ga += gAgainst;
    if (gFor > gAgainst) { wins++; form.push("G"); }
    else if (gFor < gAgainst) { losses++; form.push("P"); }
    else { draws++; form.push("E"); }
  }
  const played = wins + draws + losses;
  return { name: teamName, played, wins, draws, losses, gf, ga, avgGF: played ? gf/played:0, avgGA: played ? ga/played:0, winPct: played ? wins/played*100:0, drawPct: played ? draws/played*100:0, lossPct: played ? losses/played*100:0, form: form.join("-") || "N/A", sourceMatches: played };
}

app.get("/api/match-analysis", async (req, res) => {
  try {
    const { matchId, competition } = req.query;
    if (!matchId) return res.status(400).json({ error: "matchId requerido" });

    if (competition === "LIGAPRO") {
      if (!ensureAF(res)) return;
      const fx = await af(`/fixtures?id=${encodeURIComponent(matchId)}`);
      const f = fx.response?.[0];
      if (!f) return res.status(404).json({ error: "Partido no encontrado en API-Football" });
      const homeId = f.teams?.home?.id; const awayId = f.teams?.away?.id;
      const homeName = f.teams?.home?.name || "Local"; const awayName = f.teams?.away?.name || "Visitante";
      const [homeFx, awayFx] = await Promise.all([
        af(`/fixtures?team=${homeId}&league=${AF_LIGAPRO_ID}&season=${AF_LIGAPRO_SEASON}&last=10`),
        af(`/fixtures?team=${awayId}&league=${AF_LIGAPRO_ID}&season=${AF_LIGAPRO_SEASON}&last=10`)
      ]);
      const home = computeTeamStatsAF(homeId, homeFx.response || [], homeName);
      const away = computeTeamStatsAF(awayId, awayFx.response || [], awayName);
      const defaults = getDefaults("LIGAPRO");
      return res.json({
        match: { id: f.fixture?.id, utcDate: f.fixture?.date, status: f.fixture?.status?.short, venue: f.fixture?.venue?.name, competition: { name: "LigaPro Serie A", code: "LIGAPRO" }, homeTeam: { id: homeId, name: homeName, crest: f.teams?.home?.logo }, awayTeam: { id: awayId, name: awayName, crest: f.teams?.away?.logo } },
        home, away,
        estimated: { source: "estimated", competitionCode: "LIGAPRO", note: "Valores estimados por promedio de competición. Editables manualmente.", home: { ...defaults }, away: { ...defaults } }
      });
    }

    if (!ensureFD(res)) return;
    const raw = await fd(`/matches/${encodeURIComponent(matchId)}`);
    const m = raw.match || raw;
    const comp = m.competition?.code || m.competition?.id;
    const homeId = m.homeTeam?.id; const awayId = m.awayTeam?.id;
    const homeName = m.homeTeam?.name || m.homeTeam?.shortName || "Local";
    const awayName = m.awayTeam?.name || m.awayTeam?.shortName || "Visitante";
    if (!comp || !homeId || !awayId) return res.status(404).json({ error: "No se pudo resolver el partido" });
    const [homeData, awayData] = await Promise.all([
      fd(`/teams/${homeId}/matches?competitions=${encodeURIComponent(comp)}&status=FINISHED&limit=20`),
      fd(`/teams/${awayId}/matches?competitions=${encodeURIComponent(comp)}&status=FINISHED&limit=20`)
    ]);
    const home = computeTeamStatsFD(homeId, homeData.matches || [], homeName);
    const away = computeTeamStatsFD(awayId, awayData.matches || [], awayName);
    const defaults = getDefaults(m.competition?.code);
    res.json({
      match: { id: m.id, utcDate: m.utcDate, status: m.status, venue: m.venue, competition: m.competition, homeTeam: m.homeTeam, awayTeam: m.awayTeam },
      home, away,
      estimated: { source: "estimated", competitionCode: m.competition?.code || "DEFAULT", note: "Valores estimados por promedio de competición. Editables manualmente.", home: { ...defaults }, away: { ...defaults } }
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, details: e.details }); }
});

const TSDB_BASE = "https://www.thesportsdb.com/api/v1/json/123";
const NBA_DEFAULTS = { pointsFor: 112, pointsAgainst: 112, threePT: 12.5, steals: 7.5 };

async function tsdb(pathname) {
  const key = `tsdb:${pathname}`;
  const cached = getCache(key);
  if (cached) return cached;
  const res = await fetch(`${TSDB_BASE}${pathname}`);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) { const err = new Error(data.message || `TheSportsDB ${res.status}`); err.status = res.status; throw err; }
  setCache(key, data);
  return data;
}

function computeNBATeamStats(teamId, results, teamName) {
  const games = (results || []).filter(g => g.intHomeScore != null && g.intAwayScore != null).slice(0, 5);
  let wins=0, losses=0, pf=0, pa=0; const form = [];
  for (const g of games) {
    const isHome = String(g.idHomeTeam) === String(teamId);
    const ptsFor = Number(isHome ? g.intHomeScore : g.intAwayScore);
    const ptsAgainst = Number(isHome ? g.intAwayScore : g.intHomeScore);
    if (isNaN(ptsFor) || isNaN(ptsAgainst)) continue;
    pf += ptsFor; pa += ptsAgainst;
    if (ptsFor > ptsAgainst) { wins++; form.push("G"); }
    else { losses++; form.push("P"); }
  }
  const played = wins + losses;
  return {
    name: teamName, played, wins, losses, draws: 0, pf, pa,
    avgPF: played ? pf / played : NBA_DEFAULTS.pointsFor,
    avgPA: played ? pa / played : NBA_DEFAULTS.pointsAgainst,
    winPct: played ? (wins / played) * 100 : 50,
    form: form.join("-") || "N/A",
    sourceMatches: played
  };
}

app.get("/api/nba/games", async (req, res) => {
  try {
    const data = await tsdb("/eventsnextleague.php?id=4387");
    const games = (data.events || []).map(e => ({
      id: e.idEvent,
      utcDate: e.dateEvent + (e.strTime ? "T" + e.strTime : "T00:00:00Z"),
      status: "SCHEDULED",
      competition: { name: "NBA", code: "NBA" },
      homeTeam: { id: e.idHomeTeam, name: e.strHomeTeam },
      awayTeam: { id: e.idAwayTeam, name: e.strAwayTeam },
      season: e.strSeason
    }));
    res.json({ games });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get("/api/nba/game-analysis", async (req, res) => {
  try {
    const { eventId } = req.query;
    if (!eventId) return res.status(400).json({ error: "eventId requerido" });
    const ev = await tsdb(`/lookupevent.php?id=${encodeURIComponent(eventId)}`);
    const e = ev.events?.[0];
    if (!e) return res.status(404).json({ error: "Juego no encontrado" });
    const homeId = e.idHomeTeam, awayId = e.idAwayTeam;
    const homeName = e.strHomeTeam || "Local", awayName = e.strAwayTeam || "Visitante";
    const [homeLast, awayLast] = await Promise.all([
      tsdb(`/eventslast.php?id=${encodeURIComponent(homeId)}`),
      tsdb(`/eventslast.php?id=${encodeURIComponent(awayId)}`)
    ]);
    const home = computeNBATeamStats(homeId, homeLast.results || [], homeName);
    const away = computeNBATeamStats(awayId, awayLast.results || [], awayName);
    res.json({
      game: { id: e.idEvent, utcDate: e.dateEvent + (e.strTime ? "T" + e.strTime : "T00:00:00Z"), competition: { name: "NBA", code: "NBA" }, homeTeam: { id: homeId, name: homeName }, awayTeam: { id: awayId, name: awayName } },
      home, away,
      estimated: { source: "estimated", note: "3PT y robos son estimados por promedio NBA y editables. Puntos/forma se basan en últimos juegos cuando están disponibles.", home: { threePT: NBA_DEFAULTS.threePT, steals: NBA_DEFAULTS.steals }, away: { threePT: NBA_DEFAULTS.threePT, steals: NBA_DEFAULTS.steals } }
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.listen(PORT, () => { console.log(`FutbolStats Calc corriendo en http://localhost:${PORT}`); });



