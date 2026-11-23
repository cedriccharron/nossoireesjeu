// Calcul des statistiques — tout est recalculé à partir des parties.
// Les parties d'apprentissage comptent dans le volume (parties, heures)
// mais jamais dans les victoires.

export const isComp = (p) => (p.mode === "competitive" || p.mode === "teams") && !p.is_learning;
export const isCoop = (p) => (p.mode === "coop" || p.mode === "solo") && !p.is_learning;
export const MIN_SAMPLE = 3; // en dessous, l'indicateur est affiché grisé

export function playMinutes(p, game) {
  if (p.duration_min) return p.duration_min;
  if (!game) return 0;
  const a = game.min_time || game.max_time, b = game.max_time || game.min_time;
  return a && b ? (a + b) / 2 : 0;
}

export function periodRange(period) {
  const now = new Date();
  const y = now.getFullYear();
  const iso = (d) => d.toISOString().slice(0, 10);
  switch (period) {
    case "year": return [`${y}-01-01`, `${y}-12-31`];
    case "lastyear": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case "12m": { const d = new Date(now); d.setFullYear(y - 1); d.setDate(d.getDate() + 1); return [iso(d), iso(now)]; }
    default: return [null, null];
  }
}
export const PERIODS = { all: "Tout", year: "Cette année", "12m": "12 derniers mois", lastyear: "L'an dernier" };

export function filterPlays(plays, { period = "all" } = {}) {
  const [from, to] = periodRange(period);
  return plays.filter((p) => (!from || p.played_at >= from) && (!to || p.played_at <= to));
}

// Classement déduit des scores (égalité = même rang).
export function autoRanks(entries, rule) {
  const out = {};
  if (rule === "none") return out;
  const scored = entries.filter((e) => e.score !== null && e.score !== "" && !Number.isNaN(Number(e.score)));
  if (scored.length !== entries.length) return out;
  for (const e of entries) {
    const s = Number(e.score);
    out[e.key] = 1 + entries.filter((o) => (rule === "low" ? Number(o.score) < s : Number(o.score) > s)).length;
  }
  return out;
}

export function monthsBack(n, end = new Date()) {
  const out = [];
  const d = new Date(end.getFullYear(), end.getMonth(), 1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function monthly(plays, n = 12) {
  const months = monthsBack(n);
  const counts = Object.fromEntries(months.map((m) => [m, 0]));
  for (const p of plays) { const k = p.played_at.slice(0, 7); if (k in counts) counts[k]++; }
  return months.map((m) => ({ ym: m, count: counts[m] }));
}

function playerLine(playerId, plays) {
  let n = 0, comp = 0, wins = 0, coop = 0, coopWins = 0, expected = 0;
  for (const p of plays) {
    const me = p.players.find((x) => x.player_id === playerId);
    if (!me) continue;
    n++;
    if (isComp(p)) {
      comp++;
      if (me.is_winner) wins++;
      const sides = p.mode === "teams" ? new Set(p.players.map((x) => x.team || x.player_id)).size : p.players.length;
      expected += 1 / Math.max(1, sides);
    } else if (isCoop(p)) {
      coop++;
      if (p.coop_result === "win") coopWins++;
    }
  }
  return {
    plays: n, comp, wins, rate: comp ? wins / comp : null,
    perf: expected ? wins / expected : null,
    coop, coopWins, coopRate: coop ? coopWins / coop : null,
  };
}

export function globalStats(state, plays) {
  const gamesById = new Map(state.games.map((g) => [g.id, g]));
  const minutes = plays.reduce((s, p) => s + playMinutes(p, gamesById.get(p.game_id)), 0);
  const perGame = new Map();
  plays.forEach((p) => perGame.set(p.game_id, (perGame.get(p.game_id) || 0) + 1));
  const topGames = [...perGame.entries()].map(([id, count]) => ({ game: gamesById.get(id), count }))
    .filter((x) => x.game).sort((a, b) => b.count - a.count);
  const leaderboard = state.players
    .map((pl) => ({ player: pl, ...playerLine(pl.id, plays) }))
    .filter((x) => x.plays > 0)
    .sort((a, b) => (b.wins - a.wins) || ((b.rate ?? -1) - (a.rate ?? -1)) || (b.plays - a.plays));
  const coopPlays = plays.filter(isCoop);
  return {
    count: plays.length,
    minutes,
    gamesPlayed: perGame.size,
    playersActive: leaderboard.length,
    byMonth: monthly(plays),
    topGames,
    leaderboard,
    coop: { plays: coopPlays.length, wins: coopPlays.filter((p) => p.coop_result === "win").length },
    learning: plays.filter((p) => p.is_learning).length,
  };
}

export function gameStats(state, game, allPlays) {
  const plays = allPlays.filter((p) => p.game_id === game.id).sort((a, b) => b.played_at.localeCompare(a.played_at));
  const minutes = plays.reduce((s, p) => s + playMinutes(p, game), 0);
  const timed = plays.filter((p) => p.duration_min);
  const scores = [];
  for (const p of plays) if (!p.is_learning && p.mode !== "teams")
    for (const x of p.players) if (x.score != null) scores.push({ score: Number(x.score), player_id: x.player_id, date: p.played_at, play_id: p.id });
  const better = game.score_rule === "low" ? (a, b) => a.score - b.score : (a, b) => b.score - a.score;
  scores.sort(better);
  const byPlayer = state.players.map((pl) => {
    const line = playerLine(pl.id, plays);
    const mine = scores.filter((s) => s.player_id === pl.id);
    return {
      player: pl, ...line,
      best: mine[0]?.score ?? null,
      avg: mine.length ? mine.reduce((s, x) => s + x.score, 0) / mine.length : null,
    };
  }).filter((x) => x.plays > 0).sort((a, b) => (b.wins - a.wins) || ((b.rate ?? -1) - (a.rate ?? -1)) || (b.plays - a.plays));
  const coop = plays.filter(isCoop);
  return {
    plays, count: plays.length, minutes,
    avgDuration: timed.length ? timed.reduce((s, p) => s + p.duration_min, 0) / timed.length : null,
    last: plays[0]?.played_at ?? null,
    record: game.score_rule === "none" ? null : scores[0] ?? null,
    avgScore: scores.length ? scores.reduce((s, x) => s + x.score, 0) / scores.length : null,
    byPlayer,
    coop: { plays: coop.length, wins: coop.filter((p) => p.coop_result === "win").length },
    byMonth: monthly(plays),
  };
}

export function playerStats(state, player, allPlays) {
  const plays = allPlays.filter((p) => p.players.some((x) => x.player_id === player.id))
    .sort((a, b) => b.played_at.localeCompare(a.played_at));
  const gamesById = new Map(state.games.map((g) => [g.id, g]));
  const line = playerLine(player.id, plays);
  const minutes = plays.reduce((s, p) => s + playMinutes(p, gamesById.get(p.game_id)), 0);
  const perGame = new Map();
  for (const p of plays) {
    if (!perGame.has(p.game_id)) perGame.set(p.game_id, []);
    perGame.get(p.game_id).push(p);
  }
  const games = [...perGame.entries()].map(([gid, ps]) => {
    const g = gamesById.get(gid);
    const l = playerLine(player.id, ps);
    const sc = [];
    for (const p of ps) if (!p.is_learning && p.mode !== "teams") {
      const me = p.players.find((x) => x.player_id === player.id);
      if (me?.score != null) sc.push(Number(me.score));
    }
    const best = !sc.length || g?.score_rule === "none" ? null : g?.score_rule === "low" ? Math.min(...sc) : Math.max(...sc);
    return { game: g, ...l, best };
  }).filter((x) => x.game).sort((a, b) => b.plays - a.plays || b.wins - a.wins);
  return { ...line, count: line.plays, plays, minutes, games, byMonth: monthly(plays), last: plays[0]?.played_at ?? null };
}
