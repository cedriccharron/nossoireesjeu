// Stockage en ligne : Supabase (comptes, base de données, fonctions serveur).
import { CONFIG } from "./config.js";

// Adresse du site pour les liens envoyés par e-mail (invitation, mot de passe oublié).
// Dans l'app iPhone (Capacitor), location vaut capacitor://localhost : on renvoie vers le site public.
const SITE_PUBLIC = "https://cedriccharron.github.io/nossoireesjeu/";
function webUrl() {
  return window.Capacitor?.isNativePlatform?.() ? SITE_PUBLIC : location.origin + location.pathname;
}

export async function createSupabaseStore() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.4");
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });

  const must = ({ data, error }) => {
    if (error) throw new Error(translate(error.message));
    return data;
  };

  async function fetchAll(table, select, order) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let q = sb.from(table).select(select).range(from, from + 999);
      if (order) q = q.order(order, { ascending: true });
      const rows = must(await q);
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  async function invokeFn(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* réponse non JSON */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  return {
    mode: "cloud",
    async init() {
      const { data } = await sb.auth.getSession();
      return { session: data.session };
    },
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) {
      must(await sb.auth.resetPasswordForEmail(email, { redirectTo: webUrl() }));
    },
    async setPassword(password) { must(await sb.auth.updateUser({ password })); },

    // Groupes (v1.3.0) : l'ancien site Supabase n'a qu'un seul groupe.
    async groups() { return [{ id: "main", name: "C-Party", emoji: "", owner: false, role: "admin", members: 1, current: true }]; },
    currentGroup: () => "main",
    async useGroup() {},
    async createGroup() { throw new Error("Les groupes sont disponibles dans l'app iPhone"); },
    async saveGroupInfo() { throw new Error("Les groupes sont disponibles dans l'app iPhone"); },
    async leaveGroup() { throw new Error("Les groupes sont disponibles dans l'app iPhone"); },
    async readGroup(id) { const d = await this.loadAll(); return { id, name: "C-Party", emoji: "", players: d.players, games: d.games, plays: d.plays, my_player_id: d.me.player_id || null }; },
    async setMyPlayer(playerId) { const { data: { user } } = await sb.auth.getUser(); must(await sb.from("profiles").update({ player_id: playerId || null }).eq("id", user.id)); },

    async loadAll() {
      const { data: { user } } = await sb.auth.getUser();
      const [profiles, players, games, plays] = await Promise.all([
        fetchAll("profiles", "*", "created_at"),
        fetchAll("players", "*", "created_at"),
        fetchAll("games", "*", "created_at"),
        fetchAll("plays", "*, play_players(player_id, score, rank, team, is_winner), play_expansions(game_id)", "played_at"),
      ]);
      const me = profiles.find((p) => p.id === user.id) || { id: user.id, email: user.email, role: "viewer" };
      return {
        group: { id: "main", name: "C-Party", emoji: "", owner: me.role === "admin" }, me, profiles, players, games,
        plays: plays.map(({ play_players, play_expansions, ...p }) => ({
          ...p,
          players: play_players.map((x) => ({ ...x, score: x.score == null ? null : Number(x.score) })),
          expansions: play_expansions.map((e) => e.game_id),
        })),
      };
    },

    async saveGame(game) {
      const row = { ...game };
      delete row.cover; delete row.names; delete row.expansion; delete row.base_bgg_ids; delete row.cooperative; delete row.solo_only;
      if (row.id) return must(await sb.from("games").update(row).eq("id", row.id).select().single());
      delete row.id;
      return must(await sb.from("games").insert(row).select().single());
    },
    async saveGames(list) {
      const rows = list.map((g) => {
        const r = { ...g };
        delete r.names; delete r.expansion; delete r.base_bgg_ids; delete r.cooperative; delete r.solo_only;
        return r;
      });
      return must(await sb.from("games").insert(rows).select());
    },
    async deleteGame(id) {
      // Trace dans l'historique chaque partie supprimée avec le jeu.
      const plays = must(await sb.from("plays").select("id").eq("game_id", id));
      for (const p of plays) must(await sb.rpc("delete_play", { p_id: p.id }));
      must(await sb.from("games").delete().eq("id", id));
    },

    async savePlayer(player) {
      if (player.id) return must(await sb.from("players").update(player).eq("id", player.id).select().single());
      const row = { ...player }; delete row.id;
      return must(await sb.from("players").insert(row).select().single());
    },
    async deletePlayer(id) {
      const used = must(await sb.from("play_players").select("play_id").eq("player_id", id).limit(1));
      if (used.length) throw new Error("Ce joueur a des parties : archive-le plutôt");
      must(await sb.from("players").delete().eq("id", id));
    },

    async savePlay(play) { return must(await sb.rpc("save_play", { p: play })); },
    async deletePlay(id) { must(await sb.rpc("delete_play", { p_id: id })); },
    async restorePlay(historyId) { return must(await sb.rpc("restore_play", { p_history_id: historyId })); },
    async history(playId) {
      return must(await sb.from("play_history").select("*").eq("play_id", playId).order("id", { ascending: false }));
    },
    async deletedPlays() {
      const rows = must(await sb.from("play_history").select("*").in("action", ["delete", "restore", "create"]).order("id", { ascending: false }).limit(500));
      const seen = new Set();
      return rows.filter((h) => {
        if (seen.has(h.play_id)) return false;
        seen.add(h.play_id);
        return h.action === "delete";
      });
    },

    // Photos : uniquement dans l'app iPhone (iCloud). Le site Supabase n'en gère pas.
    async photos() { return []; },
    async photoFull() { return null; },
    async addPhotos() { throw new Error("Les photos sont disponibles dans l'app iPhone"); },
    async deletePhoto() { throw new Error("Les photos sont disponibles dans l'app iPhone"); },

    async updateProfile(id, patch) { must(await sb.from("profiles").update(patch).eq("id", id)); },
    async updateMyName(name) { must(await sb.rpc("update_my_name", { new_name: name })); },
    async invite(payload) {
      return invokeFn("invite", { ...payload, redirect_to: webUrl() });
    },

    bgg: {
      search: (q) => invokeFn("bgg", { q }),
      things: (ids) => invokeFn("bgg", { ids }),
      collection: (user) => invokeFn("bgg", { collection: user }),
    },
  };
}

function translate(msg) {
  const map = {
    "Invalid login credentials": "E-mail ou mot de passe incorrect",
    "Email not confirmed": "Adresse e-mail pas encore confirmée",
    "duplicate key value violates unique constraint \"games_bgg_id_uq\"": "Ce jeu est déjà dans la ludothèque",
    "Password should be at least 6 characters.": "Le mot de passe doit compter au moins 6 caractères",
  };
  return map[msg] || msg;
}
