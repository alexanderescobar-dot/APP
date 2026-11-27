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
const API_BASE = "https://api.football-data.org/v4";

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
  const key = pathname;
  const cached = getCache(key);
  if (cached) return cached;
  const res = await fetch(`${API_BASE}${pathname}`, { headers: { "X-Auth-Token": TOKEN } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) { const err = new Error(data.message || data.error || `football-data.org ${res.status}`); err.status = res.status; err.details = data; throw err; }
  setCache(key, data);
  return data;
}

app.use(express.static(__dirname));
app.use((req, res, next) => { // CORS for file:// / local index.html
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, hasToken: !!TOKEN && TOKEN !== "PEGA_AQUI_TU_TOKEN" }));

function ensureToken(res) {
  if (!TOKEN || TOKEN === "PEGA_AQUI_TU_TOKEN") {
    res.status(500).json({ error: "Falta FOOTBALL_DATA_TOKEN en .env. Crea el archivo .env en la carpeta APP." });
    return false;
  }
  return true;
}

app.get("/api/competitions", async (req, res) => {
  try {
    if (!ensureToken(res)) return;
    const data = await fd("/competitions");
    const allowed = new Set(["TIER_ONE"]);
    const comps = (data.competitions || []).filter(c => allowed.has(c.plan) && c.type === "LEAGUE");
    res.json({ competitions: comps.map(c => ({ id: c.id, name: c.name, code: c.code, area: c.area?.name, emblem: c.emblem })) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get("/api/matches", async (req, res) => {
  try {
    if (!ensureToken(res)) return;
    const { competition, status = "SCHEDULED", days = "14" } = req.query;
    if (!competition) return res.status(400).json({ error: "competition requerida" });
    const d = Math.max(1, Math.min(30, parseInt(days, 10) || 14));
    const today = new Date();
    const from = today.toISOString().slice(0,10);
    const toDate = new Date(today); toDate.setDate(toDate.getDate() + d);
    const to = toDate.toISOString().slice(0,10);
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

function computeTeamStats(teamId, matches, teamName) {
  const finished = (matches || []).filter(m => m.status === "FINISHED" || m.status === "AWARDED");
  const last = finished.slice(-5);
  let wins=0, draws=0, losses=0, gf=0, ga=0;
  const form = [];
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
  return {
    name: teamName, played, wins, draws, losses, gf, ga,
    avgGF: played ? gf / played : 0, avgGA: played ? ga / played : 0,
    winPct: played ? (wins / played) * 100 : 0, drawPct: played ? (draws / played) * 100 : 0, lossPct: played ? (losses / played) * 100 : 0,
    form: form.join("-") || "N/A", sourceMatches: played
  };
}

app.get("/api/match-analysis", async (req, res) => {
  try {
    if (!ensureToken(res)) return;
    const { matchId } = req.query;
    if (!matchId) return res.status(400).json({ error: "matchId requerido" });
    const raw = await fd(`/matches/${encodeURIComponent(matchId)}`);
    const m = raw.match || raw;
    const comp = m.competition?.code || m.competition?.id;
    const homeId = m.homeTeam?.id;
    const awayId = m.awayTeam?.id;
    const homeName = m.homeTeam?.name || m.homeTeam?.shortName || "Local";
    const awayName = m.awayTeam?.name || m.awayTeam?.shortName || "Visitante";
    if (!comp || !homeId || !awayId) return res.status(404).json({ error: "No se pudo resolver el partido" });
    const [homeData, awayData] = await Promise.all([
      fd(`/teams/${homeId}/matches?competitions=${encodeURIComponent(comp)}&status=FINISHED&limit=20`),
      fd(`/teams/${awayId}/matches?competitions=${encodeURIComponent(comp)}&status=FINISHED&limit=20`)
    ]);
    const home = computeTeamStats(homeId, homeData.matches || [], homeName);
    const away = computeTeamStats(awayId, awayData.matches || [], awayName);
    const defaults = getDefaults(m.competition?.code);
    res.json({
      match: { id: m.id, utcDate: m.utcDate, status: m.status, venue: m.venue, competition: m.competition, homeTeam: m.homeTeam, awayTeam: m.awayTeam },
      home, away,
      estimated: { source: "estimated", competitionCode: m.competition?.code || "DEFAULT", note: "Valores estimados por promedio de competición. Editables manualmente.", home: { ...defaults }, away: { ...defaults } }
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, details: e.details }); }
});

app.listen(PORT, () => { console.log(`FutbolStats Calc corriendo en http://localhost:${PORT}`); });
