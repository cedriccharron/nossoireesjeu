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

// Filtres des statistiques : période, nombre de joueurs (5 = « 5 et plus »),
// type ou mécanique du jeu (« t:Famille » / « m:Tile Placement », données BGG).
export function filterPlays(plays, { period = "all", nbPlayers = 0, kind = "", games = [] } = {}) {
  const [from, to] = periodRange(period);
  const byId = new Map(games.map((g) => [g.id, g]));
  const [k, v] = kind ? [kind.slice(0, 1), kind.slice(2)] : [];
  return plays.filter((p) => (!from || p.played_at >= from) && (!to || p.played_at <= to)
    && (!nbPlayers || (nbPlayers >= 5 ? p.players.length >= 5 : p.players.length === nbPlayers))
    && (!kind || ((k === "t" ? byId.get(p.game_id)?.types : byId.get(p.game_id)?.mechanics) || []).includes(v)));
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
    perf: expected ? wins / expected : null, expected,
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


// ---------- Face-à-face, némésis, Elo ----------------------------------------
// Place d'un joueur dans une partie compétitive (plus petit = meilleur) : le rang saisi,
// sinon gagnant = 1 et les autres = 2. En équipes, deux coéquipiers ne s'affrontent pas.
const placeOf = (x) => x.rank ?? (x.is_winner ? 1 : 2);
const opposed = (p, a, b) => p.mode !== "teams" || (a.team || a.player_id) !== (b.team || b.player_id);
const chrono = (plays) => [...plays].sort((a, b) => a.played_at.localeCompare(b.played_at) || String(a.created_at).localeCompare(String(b.created_at)));

// Bilan de chaque adversaire d'un joueur : parties compétitives communes (hors apprentissage).
export function headToHead(plays, playerId) {
  const out = new Map();
  for (const p of plays) {
    if (!isComp(p)) continue;
    const me = p.players.find((x) => x.player_id === playerId);
    if (!me) continue;
    for (const o of p.players) {
      if (o.player_id === playerId || !opposed(p, me, o)) continue;
      const r = out.get(o.player_id) || { player_id: o.player_id, plays: 0, ahead: 0, behind: 0, ties: 0 };
      r.plays++;
      const d = placeOf(me) - placeOf(o);
      if (d < 0) r.ahead++; else if (d > 0) r.behind++; else r.ties++;
      out.set(o.player_id, r);
    }
  }
  return [...out.values()].sort((a, b) => b.plays - a.plays || b.ahead - a.ahead);
}

// Némésis : l'adversaire (au moins MIN_SAMPLE parties communes) qui finit le plus souvent devant,
// à condition qu'il soit devant dans plus de la moitié des parties communes.
export function nemesis(plays, playerId) {
  return headToHead(plays, playerId).filter((r) => r.plays >= MIN_SAMPLE && r.behind / r.plays > 0.5)
    .sort((a, b) => b.behind / b.plays - a.behind / a.plays || b.plays - a.plays)[0] || null;
}
// Victime favorite : l'inverse (on finit devant elle le plus souvent).
export function favouriteVictim(plays, playerId) {
  return headToHead(plays, playerId).filter((r) => r.plays >= MIN_SAMPLE && r.ahead / r.plays > 0.5)
    .sort((a, b) => b.ahead / b.plays - a.ahead / a.plays || b.plays - a.plays)[0] || null;
}

// Elo d'un jeu : départ 1000, K = 32 réparti en duels (chaque paire d'adversaires compte pour
// K / (nombre d'adversaires)). En équipes, une équipe joue avec la moyenne de ses joueurs.
export const ELO_START = 1000, ELO_K = 32;
export function eloForGame(plays, gameId) {
  const elo = new Map(), count = new Map(), deltas = new Map(); // deltas : play_id -> { player_id: delta }
  const get = (id) => elo.get(id) ?? ELO_START;
  for (const p of chrono(plays.filter((x) => x.game_id === gameId && isComp(x) && x.players.length > 1))) {
    // côtés : un joueur, ou une équipe
    const sides = new Map();
    for (const x of p.players) {
      const k = p.mode === "teams" ? (x.team || x.player_id) : x.player_id;
      if (!sides.has(k)) sides.set(k, { members: [], place: placeOf(x) });
      sides.get(k).members.push(x.player_id);
    }
    const list = [...sides.values()].map((sd) => ({ ...sd, rating: sd.members.reduce((t, id) => t + get(id), 0) / sd.members.length }));
    if (list.length < 2) continue;
    const k = ELO_K / (list.length - 1);
    const d = {};
    for (const a of list) {
      let delta = 0;
      for (const b of list) {
        if (a === b) continue;
        const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
        const score = a.place < b.place ? 1 : a.place > b.place ? 0 : 0.5;
        delta += k * (score - expected);
      }
      a.members.forEach((id) => { d[id] = delta; });
    }
    for (const [id, v] of Object.entries(d)) { elo.set(id, get(id) + v); count.set(id, (count.get(id) || 0) + 1); }
    deltas.set(p.id, d);
  }
  const ranking = [...elo.entries()].map(([player_id, rating]) => ({ player_id, rating, plays: count.get(player_id) }))
    .sort((a, b) => b.rating - a.rating);
  return { ranking, deltas };
}
