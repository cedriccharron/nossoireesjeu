// Stockage iCloud (CloudKit), utilisé par l'app iPhone. Même interface que store-supabase.js / store-demo.js.
//
// Le module natif « CloudStore » (app-ios/ios/App/App/CloudStore.swift) ne sait que lire tous les
// enregistrements, écrire/supprimer de façon atomique et gérer le partage. Toute la logique métier
// (historique, restauration, règles) est ici, sur le modèle de store-demo.js.
//
// Enregistrements CloudKit (champ unique « json ») :
//   Player  <uuid>        Game <uuid>        Play <uuid> (joueurs et extensions embarqués)
//   History h-<id>        Member m-<identifiant iCloud> (nom affiché, fiche joueur liée)
import { uuid } from "./util.js";
import { snapshot } from "./store-demo.js";
import { CONFIG } from "./config.js";

const native = () => window.Capacitor?.Plugins?.CloudStore;
export const icloudAvailable = () => !!(window.Capacitor?.isNativePlatform?.() && native());

const GAME_LOCAL_FIELDS = ["names", "expansion", "base_bgg_ids", "cooperative", "solo_only"];
const BATCH = 300; // CloudKit accepte 400 enregistrements par opération

export async function createICloudStore() {
  const CS = native();
  let st = null;        // état du compte : { account, user, space: { owner, permission } }
  let db = null;        // { players, games, plays, history, members }
  let participants = [];
  const listeners = [];

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const nowIso = () => new Date().toISOString();
  // Numéros d'historique strictement croissants (l'ordre du journal en dépend), même au sein d'une milliseconde.
  let lastHistoryId = 0;
  const newHistoryId = () => {
    const max = Math.max(lastHistoryId, ...(db?.history || []).map((h) => h.id));
    lastHistoryId = Math.max(Date.now() * 1000 + Math.floor(Math.random() * 100), max + 1);
    return lastHistoryId;
  };
  const canWrite = () => st?.space && (st.space.owner || st.space.permission === "readWrite");
  const requireAdmin = () => { if (!canWrite()) throw new Error("Action réservée aux gestionnaires"); };

  const rec = (type, name, obj) => ({ type, name, json: JSON.stringify(obj) });
  const playRec = (p) => rec("Play", p.id, p);
  const histRec = (h) => rec("History", `h-${h.id}`, h);
  async function write(save = [], remove = []) {
    for (let i = 0; i < Math.max(save.length, remove.length, 1); i += BATCH)
      await CS.modify({ save: save.slice(i, i + BATCH), remove: remove.slice(i, i + BATCH) });
  }

  async function refreshStatus() {
    st = await CS.status();
    return st;
  }

  async function fetchAll() {
    const { records } = await CS.fetchAll();
    const out = { players: [], games: [], plays: [], history: [], members: [] };
    const key = { Player: "players", Game: "games", Play: "plays", History: "history", Member: "members" };
    for (const r of records) {
      const k = key[r.type];
      if (!k) continue;
      try { out[k].push(JSON.parse(r.json)); } catch { /* enregistrement illisible : ignoré */ }
    }
    db = out;
    try { participants = (await CS.participants()).participants || []; } catch { participants = []; }
  }

  function profiles() {
    const member = (u) => db.members.find((m) => m.id === u) || {};
    // iCloud désigne parfois l'utilisateur courant par « __defaultOwner__ » : on le ramène à son vrai identifiant.
    const realId = (u) => (u === "__defaultOwner__" || !u ? st.user : u);
    const list = participants.length
      ? participants.map((p) => ({ ...p, user: realId(p.user) }))
      : [{ user: st.user, name: "", email: "", owner: st.space?.owner, permission: st.space?.permission, accepted: true }];
    const seen = new Set();
    return list.filter((p) => p.user && !seen.has(p.user) && seen.add(p.user)).map((p) => ({
      id: p.user,
      email: p.email || "",
      display_name: member(p.user).display_name || p.name || (p.owner ? "Propriétaire" : "Invité"),
      role: p.owner || p.permission === "readWrite" ? "admin" : "viewer",
      player_id: member(p.user).player_id || null,
      owner: !!p.owner,
      pending: !p.accepted,
    }));
  }

  function logDelete(p) {
    return { id: newHistoryId(), play_id: p.id, action: "delete", actor: st.user, at: nowIso(), before: snapshot(p), after: null };
  }

  const store = {
    mode: "icloud",

    // ----- Compte et espace -----
    async init() {
      CS.addListener("spaceChanged", async () => { await refreshStatus(); listeners.forEach((cb) => cb("SPACE_CHANGED")); });
      CS.addListener("sharingError", (e) => listeners.forEach((cb) => cb("SHARING_ERROR", e?.message)));
      await refreshStatus();
      return { session: st.account === "available" && st.space ? { user: { id: st.user } } : null, status: st };
    },
    onAuth(cb) { listeners.push(cb); },
    status: () => st,
    refreshStatus,
    async createSpace() { await CS.createSpace(); await refreshStatus(); },
    async manageSharing() { await CS.manageSharing(); },
    async leaveSpace() { await CS.leaveSpace(); db = null; await refreshStatus(); },
    async signIn() {}, async signOut() {}, async resetPassword() {}, async setPassword() {},

    async loadAll() {
      if (!st?.space) await refreshStatus();
      await fetchAll();
      const all = profiles();
      const me = all.find((p) => p.id === st.user) || {
        id: st.user, email: "", display_name: "", role: canWrite() ? "admin" : "viewer", player_id: null, owner: !!st.space?.owner,
      };
      me.role = canWrite() ? "admin" : "viewer";
      return clone({ me, profiles: all, players: db.players, games: db.games, plays: db.plays });
    },

    // ----- Jeux -----
    async saveGame(game) {
      requireAdmin();
      if (game.bgg_id && db.games.some((g) => g.bgg_id === game.bgg_id && g.id !== game.id)) throw new Error("Ce jeu est déjà dans la ludothèque");
      const i = game.id ? db.games.findIndex((g) => g.id === game.id) : -1;
      const g = { ...(i >= 0 ? db.games[i] : { created_at: nowIso() }), ...game, id: i >= 0 ? db.games[i].id : uuid() };
      GAME_LOCAL_FIELDS.forEach((f) => delete g[f]);
      await write([rec("Game", g.id, g)]);
      if (i >= 0) db.games[i] = g; else db.games.push(g);
      return clone(g);
    },
    async saveGames(list) {
      requireAdmin();
      const out = [];
      for (const game of list) {
        if (game.bgg_id && [...db.games, ...out].some((g) => g.bgg_id === game.bgg_id)) continue;
        const g = { created_at: nowIso(), ...game, id: uuid() };
        GAME_LOCAL_FIELDS.forEach((f) => delete g[f]);
        out.push(g);
      }
      await write(out.map((g) => rec("Game", g.id, g)));
      db.games.push(...out);
      return clone(out);
    },
    async deleteGame(id) {
      requireAdmin();
      const ids = new Set([id, ...db.games.filter((g) => g.base_game_id === id).map((g) => g.id)]);
      const gone = db.plays.filter((p) => ids.has(p.game_id));
      const touched = db.plays.filter((p) => !ids.has(p.game_id) && (p.expansions || []).some((e) => ids.has(e)))
        .map((p) => ({ ...p, expansions: p.expansions.filter((e) => !ids.has(e)) }));
      const logs = gone.map(logDelete);
      await write([...logs.map(histRec), ...touched.map(playRec)], [...gone.map((p) => p.id), ...ids]);
      db.history.push(...logs);
      db.plays = db.plays.filter((p) => !ids.has(p.game_id)).map((p) => touched.find((t) => t.id === p.id) || p);
      db.games = db.games.filter((g) => !ids.has(g.id));
    },

    // ----- Joueurs -----
    async savePlayer(player) {
      requireAdmin();
      const i = player.id ? db.players.findIndex((p) => p.id === player.id) : -1;
      const p = { ...(i >= 0 ? db.players[i] : { archived: false, created_at: nowIso() }), ...player, id: i >= 0 ? db.players[i].id : uuid() };
      await write([rec("Player", p.id, p)]);
      if (i >= 0) db.players[i] = p; else db.players.push(p);
      return clone(p);
    },
    async deletePlayer(id) {
      requireAdmin();
      if (db.plays.some((p) => p.players.some((x) => x.player_id === id))) throw new Error("Ce joueur a des parties : archive-le plutôt");
      const unlinked = db.members.filter((m) => m.player_id === id).map((m) => ({ ...m, player_id: null }));
      await write(unlinked.map((m) => rec("Member", `m-${m.id}`, m)), [id]);
      db.players = db.players.filter((p) => p.id !== id);
      unlinked.forEach((m) => { db.members.find((x) => x.id === m.id).player_id = null; });
    },

    // ----- Parties (partie + historique dans la même opération atomique) -----
    async savePlay(play) {
      requireAdmin();
      if (!play.players?.length) throw new Error("Une partie doit compter au moins un joueur");
      const i = db.plays.findIndex((p) => p.id === play.id);
      const now = nowIso();
      if (i >= 0) {
        const before = snapshot(db.plays[i]);
        const next = { ...db.plays[i], ...play, updated_at: now };
        const after = snapshot(next);
        const h = JSON.stringify(before) !== JSON.stringify(after)
          ? { id: newHistoryId(), play_id: next.id, action: "update", actor: st.user, at: now, before, after } : null;
        await write([playRec(next), ...(h ? [histRec(h)] : [])]);
        db.plays[i] = next; if (h) db.history.push(h);
        return next.id;
      }
      const p = { ...play, id: play.id || uuid(), created_by: st.user, created_at: now, updated_at: now };
      const h = { id: newHistoryId(), play_id: p.id, action: "create", actor: st.user, at: now, before: null, after: snapshot(p) };
      await write([playRec(p), histRec(h)]);
      db.plays.push(p); db.history.push(h);
      return p.id;
    },
    async deletePlay(id) {
      requireAdmin();
      const p = db.plays.find((x) => x.id === id);
      if (!p) return;
      const h = logDelete(p);
      await write([histRec(h)], [id]);
      db.history.push(h);
      db.plays = db.plays.filter((x) => x.id !== id);
    },
    async restorePlay(historyId) {
      requireAdmin();
      const h = db.history.find((x) => x.id === historyId && x.action === "delete");
      if (!h) throw new Error("Suppression introuvable");
      if (db.plays.some((p) => p.id === h.play_id)) throw new Error("Cette partie existe déjà");
      if (!db.games.some((g) => g.id === h.before.game_id)) throw new Error("Le jeu de cette partie a été supprimé");
      const now = nowIso();
      const p = { ...clone(h.before), id: h.play_id, created_by: st.user, created_at: now, updated_at: now };
      const r = { id: newHistoryId(), play_id: p.id, action: "restore", actor: st.user, at: now, before: null, after: snapshot(p) };
      await write([playRec(p), histRec(r)]);
      db.plays.push(p); db.history.push(r);
      return p.id;
    },
    async history(playId) { return clone(db.history.filter((h) => h.play_id === playId).sort((a, b) => b.id - a.id)); },
    async deletedPlays() {
      const alive = new Set(db.plays.map((p) => p.id));
      const latest = new Map();
      [...db.history].sort((a, b) => a.id - b.id).forEach((h) => latest.set(h.play_id, h));
      return clone([...latest.values()].filter((h) => h.action === "delete" && !alive.has(h.play_id)).sort((a, b) => b.id - a.id));
    },

    // ----- Comptes (les droits se gèrent dans l'écran de partage d'Apple) -----
    async updateProfile(id, patch) {
      requireAdmin();
      if ("role" in patch) throw new Error("Les droits se changent dans « Inviter et gérer les droits »");
      const m = { ...(db.members.find((x) => x.id === id) || { id }), ...patch };
      await write([rec("Member", `m-${id}`, m)]);
      db.members = [...db.members.filter((x) => x.id !== id), m];
    },
    async updateMyName(name) {
      if (!canWrite()) throw new Error("Demande à un gestionnaire de changer ton nom affiché");
      await store.updateProfile(st.user, { display_name: name });
    },
    // role : "viewer" (lecture seule) ou "admin" (modifications autorisées) ; l'autorisation est fixée par l'app.
    async invite({ role } = {}) { await CS.invite({ role: role === "admin" ? "readWrite" : "readOnly" }); return { ok: true }; },

    // ----- Import d'un export Supabase (supabase/export.sql) -----
    async importExport(tables) {
      if (!st?.space?.owner) throw new Error("Seul le propriétaire de l'espace peut importer");
      await fetchAll();
      if (db.plays.length || db.games.length || db.players.length) throw new Error("L'espace contient déjà des données : import annulé");
      const plays = (tables.plays || []).map(({ location, ...p }) => ({
        ...p, location: location ?? null,
        players: (tables.play_players || []).filter((x) => x.play_id === p.id)
          .map(({ play_id, ...x }) => ({ ...x, score: x.score == null ? null : Number(x.score) })),
        expansions: (tables.play_expansions || []).filter((x) => x.play_id === p.id).map((x) => x.game_id),
      }));
      const games = (tables.games || []).map((g) => ({ ...g, weight: g.weight == null ? null : Number(g.weight) }));
      const members = (tables.profiles || []).map((p) => ({ id: `supabase:${p.id}`, email: p.email, display_name: p.display_name, player_id: p.player_id, old_role: p.role }));
      const save = [
        ...(tables.players || []).map((p) => rec("Player", p.id, p)),
        ...games.map((g) => rec("Game", g.id, g)),
        ...plays.map(playRec),
        ...(tables.play_history || []).map((h) => histRec({ ...h, id: Number(h.id) })),
        ...members.map((m) => rec("Member", `m-${m.id}`, m)),
      ];
      await write(save);
      await fetchAll();
      return { players: db.players.length, games: db.games.length, plays: db.plays.length, history: db.history.length };
    },

    // ----- BoardGameGeek : relais Supabase, protégé par une clé propre à l'app -----
    bgg: {
      search: (q) => bggCall({ q }),
      things: (ids) => bggCall({ ids }),
      collection: (user) => bggCall({ collection: user }),
    },
  };
  return store;
}

async function bggCall(body) {
  let key = "";
  try { key = (await import("./secrets.js")).BGG_APP_KEY || ""; } catch { /* clé absente */ }
  if (!CONFIG.SUPABASE_URL || !key) throw new Error("Recherche BoardGameGeek indisponible pour l'instant");
  const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/bgg`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_ANON_KEY, "x-app-key": key },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Erreur BoardGameGeek (${res.status})`);
  return data;
}

// ----- Lecture d'un export CSV de Supabase (supabase/export.sql) -----
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const first = text.split("\n", 1)[0];
  const sep = first.includes(";") && !first.includes(",") ? ";" : ",";
  const rows = []; let field = "", row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function tablesFromExport(text) {
  const [head, ...rows] = parseCsv(text);
  const ti = head?.indexOf("table"), di = head?.indexOf("donnees");
  if (ti == null || ti < 0 || di < 0) throw new Error("Ce fichier n'est pas un export C-Party (colonnes « table » et « donnees » absentes)");
  const tables = {};
  rows.forEach((r, i) => {
    try { (tables[r[ti]] ??= []).push(JSON.parse(r[di])); }
    catch { throw new Error(`Ligne ${i + 2} illisible dans le fichier`); }
  });
  if (!tables.plays && !tables.games) throw new Error("Le fichier ne contient ni parties ni jeux");
  return tables;
}
