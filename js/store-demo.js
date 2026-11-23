// Stockage du mode démo : tout reste dans le navigateur (localStorage).
// Même interface que store-supabase.js.
import { uuid, PLAYER_COLORS, guessFrenchName } from "./util.js";

const KEY = "nsj-demo-v1";
const ME = "demo-user";

// Catalogue fictif pour simuler la recherche BGG en mode démo.
const CATALOG = [
  { bgg_id: 900001, bgg_name: "Azul", names: ["Azul"], year: 2017, types: ["Abstrait", "Famille"], categories: ["Abstract Strategy"], mechanics: ["Pattern Building", "Tile Placement"], designers: ["Michael Kiesling"], publisher: "Plan B Games", min_players: 2, max_players: 4, min_time: 30, max_time: 45, weight: 1.76, cooperative: false },
  { bgg_id: 900002, bgg_name: "The Castles of Burgundy", names: ["The Castles of Burgundy", "Les Châteaux de Bourgogne"], year: 2011, types: ["Stratégie"], categories: ["Dice", "Medieval", "Territory Building"], mechanics: ["Dice Rolling", "Tile Placement"], designers: ["Stefan Feld"], publisher: "alea", min_players: 1, max_players: 4, min_time: 30, max_time: 90, weight: 3.0, cooperative: false },
  { bgg_id: 900003, bgg_name: "Carcassonne", names: ["Carcassonne"], year: 2000, types: ["Famille"], categories: ["City Building", "Medieval"], mechanics: ["Tile Placement", "Area Majority"], designers: ["Klaus-Jürgen Wrede"], publisher: "Hans im Glück", min_players: 2, max_players: 5, min_time: 30, max_time: 45, weight: 1.9, cooperative: false },
  { bgg_id: 900004, bgg_name: "7 Wonders Duel", names: ["7 Wonders Duel"], year: 2015, types: ["Stratégie"], categories: ["Ancient", "Card Game"], mechanics: ["Card Drafting", "Set Collection"], designers: ["Antoine Bauza", "Bruno Cathala"], publisher: "Repos Production", min_players: 2, max_players: 2, min_time: 30, max_time: 30, weight: 2.2, cooperative: false },
  { bgg_id: 900005, bgg_name: "The Crew: Mission Deep Sea", names: ["The Crew: Mission Deep Sea", "The Crew : Mission sous-marine"], year: 2021, types: ["Famille"], categories: ["Card Game", "Space Exploration"], mechanics: ["Cooperative Game", "Trick-taking"], designers: ["Thomas Sing"], publisher: "Kosmos", min_players: 2, max_players: 5, min_time: 20, max_time: 20, weight: 2.1, cooperative: true },
  { bgg_id: 900006, bgg_name: "Codenames", names: ["Codenames", "Code Names"], year: 2015, types: ["Ambiance"], categories: ["Deduction", "Party Game", "Word Game"], mechanics: ["Team-Based Game"], designers: ["Vlaada Chvátil"], publisher: "Czech Games Edition", min_players: 2, max_players: 8, min_time: 15, max_time: 15, weight: 1.3, cooperative: false },
  { bgg_id: 900007, bgg_name: "Eclipse: Second Dawn for the Galaxy", names: ["Eclipse: Second Dawn for the Galaxy"], year: 2020, types: ["Stratégie", "Thématique"], categories: ["Civilization", "Science Fiction", "Space Exploration"], mechanics: ["Dice Rolling", "Hexagon Grid"], designers: ["Touko Tahkokallio"], publisher: "Lautapelit.fi", min_players: 2, max_players: 6, min_time: 60, max_time: 200, weight: 3.6, cooperative: false },
  { bgg_id: 900008, bgg_name: "Azul: Crystal Mosaic", names: ["Azul: Crystal Mosaic", "Azul : Mosaïque éclatante"], year: 2023, expansion: true, base_bgg_ids: [900001], types: [], categories: ["Abstract Strategy"], mechanics: ["Pattern Building"], designers: ["Michael Kiesling"], publisher: "Plan B Games", min_players: 2, max_players: 4, min_time: 30, max_time: 45, weight: 1.9, cooperative: false },
  { bgg_id: 900009, bgg_name: "Wingspan", names: ["Wingspan"], year: 2019, types: ["Stratégie"], categories: ["Animals", "Card Game"], mechanics: ["Engine Building", "Set Collection"], designers: ["Elizabeth Hargrave"], publisher: "Stonemaier Games", min_players: 1, max_players: 5, min_time: 40, max_time: 70, weight: 2.45, cooperative: false },
  { bgg_id: 900010, bgg_name: "Pandemic", names: ["Pandemic", "Pandémie"], year: 2008, types: ["Famille"], categories: ["Medical"], mechanics: ["Cooperative Game", "Hand Management"], designers: ["Matt Leacock"], publisher: "Z-Man Games", min_players: 2, max_players: 4, min_time: 45, max_time: 45, weight: 2.4, cooperative: true },
];

function rng(seed) { // pseudo-aléatoire déterministe pour un jeu de données stable
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function fromCatalog(c, extra = {}) {
  return {
    id: uuid(), name: guessFrenchName(c.bgg_name, c.names), bgg_name: c.bgg_name, bgg_id: c.bgg_id,
    base_game_id: null, year: c.year, image_url: null, thumbnail_url: null, types: c.types, categories: c.categories,
    mechanics: c.mechanics, designers: c.designers, publisher: c.publisher, min_players: c.min_players,
    max_players: c.max_players, min_time: c.min_time, max_time: c.max_time, weight: c.weight, status: "owned",
    lent_to: null, default_mode: c.cooperative ? "coop" : "competitive", score_rule: "high", notes: null,
    created_at: new Date().toISOString(), ...extra,
  };
}

function seed() {
  const r = rng(42);
  const players = ["Alex", "Camille", "Sam", "Léa", "Noah"].map((name, i) => ({
    id: uuid(), name, color: PLAYER_COLORS[i], archived: false, created_at: new Date().toISOString(),
  }));
  const g = {};
  g.azul = fromCatalog(CATALOG[0]);
  g.chateaux = fromCatalog(CATALOG[1]);
  g.carca = fromCatalog(CATALOG[2]);
  g.duel = fromCatalog(CATALOG[3]);
  g.crew = fromCatalog(CATALOG[4], { default_mode: "coop", score_rule: "none" });
  g.codenames = fromCatalog(CATALOG[5], { default_mode: "teams", score_rule: "none", status: "elsewhere" });
  g.eclipse = fromCatalog(CATALOG[6], { status: "lent", lent_to: "Noah" });
  g.azulExp = fromCatalog(CATALOG[7], { base_game_id: g.azul.id });
  const games = Object.values(g);

  const plays = [];
  const history = [];
  const now = new Date();
  const pick = (arr, n) => [...arr].sort(() => r() - 0.5).slice(0, n);
  for (let i = 0; i < 46; i++) {
    const daysAgo = Math.floor(r() * 360);
    const d = new Date(now.getTime() - daysAgo * 864e5).toISOString().slice(0, 10);
    const kind = r();
    let game, mode, ps, coop_result = null;
    if (kind < 0.25) { game = g.azul; mode = "competitive"; ps = pick(players, 2 + Math.floor(r() * 3)); }
    else if (kind < 0.42) { game = g.chateaux; mode = "competitive"; ps = pick(players, 2 + Math.floor(r() * 2)); }
    else if (kind < 0.58) { game = g.carca; mode = "competitive"; ps = pick(players, 2 + Math.floor(r() * 3)); }
    else if (kind < 0.72) { game = g.duel; mode = "competitive"; ps = pick(players.slice(0, 3), 2); }
    else if (kind < 0.86) { game = g.crew; mode = "coop"; ps = pick(players, 3 + Math.floor(r() * 2)); coop_result = r() < 0.55 ? "win" : "loss"; }
    else if (kind < 0.96) { game = g.codenames; mode = "teams"; ps = pick(players, 4); }
    else { game = g.chateaux; mode = "solo"; ps = pick(players, 1); coop_result = r() < 0.5 ? "win" : "loss"; }
    // Le premier joueur de la liste « réussit » un peu plus souvent : stats plus parlantes.
    const skill = (p) => 1 + (players.indexOf(p) === 0 ? 0.25 : 0) - players.indexOf(p) * 0.04;
    let pp;
    if (mode === "competitive") {
      const base = game === g.azul ? 55 : game === g.chateaux ? 170 : game === g.carca ? 95 : 60;
      const scored = ps.map((p) => ({ p, s: Math.round(base * skill(p) * (0.7 + r() * 0.6)) }));
      scored.sort((a, b) => b.s - a.s);
      pp = scored.map((x) => ({ player_id: x.p.id, score: x.s, rank: 1 + scored.filter((y) => y.s > x.s).length, team: null, is_winner: false }));
      pp.forEach((x) => (x.is_winner = x.rank === 1));
    } else if (mode === "teams") {
      const win = r() < 0.5 ? "Équipe 1" : "Équipe 2";
      pp = ps.map((p, j) => { const team = j % 2 ? "Équipe 2" : "Équipe 1"; return { player_id: p.id, score: null, rank: team === win ? 1 : 2, team, is_winner: team === win }; });
    } else {
      pp = ps.map((p) => ({ player_id: p.id, score: null, rank: null, team: null, is_winner: coop_result === "win" }));
    }
    const play = {
      id: uuid(), game_id: game.id, played_at: d, mode, coop_result, is_learning: i === 45,
      duration_min: r() < 0.6 ? Math.round((game.min_time + (game.max_time - game.min_time) * r()) / 5) * 5 : null,
      location: null,
      notes: null, created_by: ME, created_at: `${d}T21:30:00Z`, updated_at: `${d}T21:30:00Z`,
      players: pp, expansions: game === g.azul && r() < 0.3 ? [g.azulExp.id] : [],
    };
    plays.push(play);
    history.push({ id: history.length + 1, play_id: play.id, action: "create", actor: ME, at: play.created_at, before: null, after: snapshot(play) });
  }
  return {
    profiles: [
      { id: ME, email: "demo@nossoireesjeu.app", display_name: "Vous (démo)", role: "admin", player_id: players[0].id },
      { id: "demo-2", email: "camille@exemple.be", display_name: "Camille", role: "viewer", player_id: players[1].id },
    ],
    players, games, plays, history, viewAs: "admin",
  };
}

function snapshot(p) {
  return {
    game_id: p.game_id, played_at: p.played_at, mode: p.mode, coop_result: p.coop_result,
    is_learning: !!p.is_learning, duration_min: p.duration_min ?? null, location: p.location ?? null, notes: p.notes ?? null,
    players: [...p.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || String(a.player_id).localeCompare(b.player_id))
      .map((x) => ({ player_id: x.player_id, score: x.score ?? null, rank: x.rank ?? null, team: x.team ?? null, is_winner: !!x.is_winner })),
    expansions: [...(p.expansions || [])].sort(),
  };
}

export function createDemoStore() {
  let db;
  const load = () => {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
    if (!db) { db = seed(); save(); }
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* stockage indisponible */ } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const requireAdmin = () => { if (db.viewAs !== "admin") throw new Error("Action réservée aux gestionnaires"); };
  const delay = (v) => new Promise((ok) => setTimeout(() => ok(v), 120));

  return {
    mode: "demo",
    async init() { load(); return { session: { user: { id: ME } } }; },
    onAuth() {},
    async signIn() {}, async signOut() {}, async resetPassword() {}, async setPassword() {},

    async loadAll() {
      load();
      const me = { ...db.profiles.find((p) => p.id === ME), role: db.viewAs };
      return clone({ me, profiles: db.profiles.map((p) => (p.id === ME ? me : p)), players: db.players, games: db.games, plays: db.plays });
    },

    // Démo uniquement : basculer entre vue gestionnaire et vue joueur, réinitialiser.
    setViewAs(role) { db.viewAs = role; save(); },
    reset() { localStorage.removeItem(KEY); load(); },

    async saveGame(game) {
      requireAdmin();
      if (game.bgg_id && db.games.some((g) => g.bgg_id === game.bgg_id && g.id !== game.id)) throw new Error("Ce jeu est déjà dans la ludothèque");
      const i = game.id ? db.games.findIndex((g) => g.id === game.id) : -1;
      const g = { ...(i >= 0 ? db.games[i] : { created_at: new Date().toISOString() }), ...game, id: i >= 0 ? db.games[i].id : uuid() };
      if (i >= 0) db.games[i] = g; else db.games.push(g);
      save(); return delay(clone(g));
    },
    async saveGames(list) { const out = []; for (const g of list) out.push(await this.saveGame(g)); return out; },
    async deleteGame(id) {
      requireAdmin();
      const ids = new Set([id, ...db.games.filter((g) => g.base_game_id === id).map((g) => g.id)]);
      db.plays.filter((p) => ids.has(p.game_id)).forEach((p) => this._logDelete(p));
      db.plays = db.plays.filter((p) => !ids.has(p.game_id));
      db.plays.forEach((p) => (p.expansions = (p.expansions || []).filter((e) => !ids.has(e))));
      db.games = db.games.filter((g) => !ids.has(g.id));
      save(); return delay();
    },

    async savePlayer(player) {
      requireAdmin();
      const i = player.id ? db.players.findIndex((p) => p.id === player.id) : -1;
      const p = { ...(i >= 0 ? db.players[i] : { archived: false, created_at: new Date().toISOString() }), ...player, id: i >= 0 ? db.players[i].id : uuid() };
      if (i >= 0) db.players[i] = p; else db.players.push(p);
      save(); return delay(clone(p));
    },
    async deletePlayer(id) {
      requireAdmin();
      if (db.plays.some((p) => p.players.some((x) => x.player_id === id))) throw new Error("Ce joueur a des parties : archive-le plutôt");
      db.players = db.players.filter((p) => p.id !== id);
      db.profiles.forEach((p) => { if (p.player_id === id) p.player_id = null; });
      save(); return delay();
    },

    async savePlay(play) {
      requireAdmin();
      if (!play.players?.length) throw new Error("Une partie doit compter au moins un joueur");
      const i = db.plays.findIndex((p) => p.id === play.id);
      const nowIso = new Date().toISOString();
      if (i >= 0) {
        const before = snapshot(db.plays[i]);
        const next = { ...db.plays[i], ...play, updated_at: nowIso };
        const after = snapshot(next);
        db.plays[i] = next;
        if (JSON.stringify(before) !== JSON.stringify(after))
          db.history.push({ id: db.history.length + 1, play_id: next.id, action: "update", actor: ME, at: nowIso, before, after });
        save(); return delay(next.id);
      }
      const p = { ...play, id: play.id || uuid(), created_by: ME, created_at: nowIso, updated_at: nowIso };
      db.plays.push(p);
      db.history.push({ id: db.history.length + 1, play_id: p.id, action: "create", actor: ME, at: nowIso, before: null, after: snapshot(p) });
      save(); return delay(p.id);
    },
    _logDelete(p) {
      db.history.push({ id: db.history.length + 1, play_id: p.id, action: "delete", actor: ME, at: new Date().toISOString(), before: snapshot(p), after: null });
    },
    async deletePlay(id) {
      requireAdmin();
      const p = db.plays.find((x) => x.id === id);
      if (!p) return;
      this._logDelete(p);
      db.plays = db.plays.filter((x) => x.id !== id);
      save(); return delay();
    },
    async restorePlay(historyId) {
      requireAdmin();
      const h = db.history.find((x) => x.id === historyId && x.action === "delete");
      if (!h) throw new Error("Suppression introuvable");
      if (db.plays.some((p) => p.id === h.play_id)) throw new Error("Cette partie existe déjà");
      if (!db.games.some((g) => g.id === h.before.game_id)) throw new Error("Le jeu de cette partie a été supprimé");
      const nowIso = new Date().toISOString();
      const p = { ...clone(h.before), id: h.play_id, created_by: ME, created_at: nowIso, updated_at: nowIso };
      db.plays.push(p);
      db.history.push({ id: db.history.length + 1, play_id: p.id, action: "restore", actor: ME, at: nowIso, before: null, after: snapshot(p) });
      save(); return delay(p.id);
    },
    async history(playId) { return delay(clone(db.history.filter((h) => h.play_id === playId).sort((a, b) => b.id - a.id))); },
    async deletedPlays() {
      const alive = new Set(db.plays.map((p) => p.id));
      const latest = new Map();
      db.history.forEach((h) => latest.set(h.play_id, h));
      return delay(clone([...latest.values()].filter((h) => h.action === "delete" && !alive.has(h.play_id)).sort((a, b) => b.id - a.id)));
    },

    async updateProfile(id, patch) {
      requireAdmin();
      const p = db.profiles.find((x) => x.id === id);
      if (patch.role && patch.role !== "admin" && p.role === "admin" && db.profiles.filter((x) => x.role === "admin").length <= 1)
        throw new Error("Il doit rester au moins un compte gestionnaire.");
      Object.assign(p, patch); save(); return delay();
    },
    async updateMyName(name) { db.profiles.find((x) => x.id === ME).display_name = name; save(); return delay(); },
    async invite({ email, display_name, role, player_id }) {
      requireAdmin();
      db.profiles.push({ id: uuid(), email, display_name: display_name || email.split("@")[0], role, player_id: player_id || null });
      save(); return delay({ ok: true });
    },

    bgg: {
      async search(q) {
        const s = q.toLowerCase();
        return delay(CATALOG.filter((c) => c.names.some((n) => n.toLowerCase().includes(s)))
          .map((c) => ({ id: c.bgg_id, name: c.bgg_name, year: c.year, expansion: !!c.expansion })));
      },
      async things(ids) { return delay(clone(CATALOG.filter((c) => ids.includes(c.bgg_id)).map((c) => ({ expansion: false, base_bgg_ids: [], image_url: null, thumbnail_url: null, ...c })))); },
      async collection() { return delay({ items: CATALOG.map((c) => ({ id: c.bgg_id, name: c.bgg_name, expansion: !!c.expansion })) }); },
    },
  };
}

export { snapshot };
