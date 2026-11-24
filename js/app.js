// NosSoireesJeu — application principale (navigation, écrans, formulaires).
import { CONFIG } from "./config.js";
import { createDemoStore } from "./store-demo.js";
import { icon } from "./icons.js";
import {
  esc, uuid, today, fmtDate, fmtShort, fmtDateTime, monthLabel, monthShort, fmtNum, fmtPct, fmtHours, fmtScore,
  plural, debounce, initials, toast, confirmDialog, guessFrenchName, PLAYER_COLORS, MODES, STATUS, SCORE_RULES,
} from "./util.js";
import {
  globalStats, gameStats, playerStats, filterPlays, PERIODS, autoRanks, isComp, MIN_SAMPLE, monthsBack,
} from "./stats.js";

const VERSION = "1.0.5 (lot 1)";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const S = {
  store: null,
  data: null,
  ui: { period: "all", gameQuery: "", gameStatus: "all", playQuery: "" },
  form: null,       // brouillon de partie en cours
  gameDraft: null,  // brouillon de jeu (ajout / modification)
  importer: null,   // état de l'import de collection
  pendingAuth: null,
};

// ---------- Accès aux données ----------------------------------------
const isAdmin = () => S.data?.me?.role === "admin";
const game = (id) => S.data.games.find((g) => g.id === id);
const player = (id) => S.data.players.find((p) => p.id === id);
const profile = (id) => S.data.profiles.find((p) => p.id === id);
const baseGames = () => S.data.games.filter((g) => !g.base_game_id).sort((a, b) => a.name.localeCompare(b.name, "fr"));
const expansionsOf = (id) => S.data.games.filter((g) => g.base_game_id === id).sort((a, b) => a.name.localeCompare(b.name, "fr"));
const activePlayers = () => S.data.players.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name, "fr"));
const playsSorted = () => [...S.data.plays].sort((a, b) => b.played_at.localeCompare(a.played_at) || String(b.created_at).localeCompare(String(a.created_at)));

// ---------- Démarrage --------------------------------------------------
async function boot() {
  const forceDemo = new URLSearchParams(location.search).has("demo");
  const hash = new URLSearchParams(location.hash.slice(1));
  if (["invite", "recovery"].includes(hash.get("type"))) S.pendingAuth = hash.get("type");
  if (hash.get("error_description")) toast(hash.get("error_description").replace(/\+/g, " "), "error");

  const native = !!window.Capacitor?.isNativePlatform?.();
  if (!forceDemo && native) {
    try {
      const { createICloudStore, icloudAvailable } = await import("./store-icloud.js");
      if (!icloudAvailable()) throw new Error("Module iCloud absent de l'app");
      S.store = await createICloudStore();
    } catch (e) {
      $("#main").innerHTML = `<div class="empty"><p>Impossible d'accéder à iCloud.</p><p class="muted">${esc(e.message)}</p>
        <button class="btn primary" onclick="location.reload()">Réessayer</button></div>`;
      return;
    }
  } else if (!forceDemo && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    try {
      const { createSupabaseStore } = await import("./store-supabase.js");
      S.store = await createSupabaseStore();
    } catch (e) {
      $("#main").innerHTML = `<div class="empty"><p>Impossible de joindre le serveur.</p><p class="muted">${esc(e.message)}</p>
        <button class="btn primary" onclick="location.reload()">Réessayer</button></div>`;
      return;
    }
  } else {
    S.store = createDemoStore();
  }
  document.body.classList.toggle("demo", S.store.mode === "demo");

  const { session } = await S.store.init();
  S.store.onAuth(async (event, detail) => {
    if (event === "PASSWORD_RECOVERY") { S.pendingAuth = "recovery"; render(); }
    if (event === "SIGNED_OUT") { S.data = null; render(); }
    if (event === "SIGNED_IN" && !S.data) await reload();
    if (event === "SPACE_CHANGED") { if (S.store.status()?.space) await reload(); else { S.data = null; render(); } }
    if (event === "SHARING_ERROR") toast(detail || "Le partage a échoué", "error");
  });
  if (session) await reload();
  else render();
  if (location.hash.includes("access_token")) history.replaceState(null, "", location.pathname + location.search + "#/");
}

async function reload() {
  try {
    S.data = await S.store.loadAll();
  } catch (e) {
    toast(e.message, "error");
  }
  render();
}

// ---------- Navigation --------------------------------------------------
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean), query: new URLSearchParams(qs || "") };
}
const go = (path) => { location.hash = path; };
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

function render() {
  const main = $("#main");
  const nav = $("#nav");
  if (!S.store) return;
  if (S.pendingAuth && S.store.mode === "cloud") { nav.hidden = true; main.innerHTML = viewSetPassword(); return; }
  if (!S.data) {
    nav.hidden = true;
    main.innerHTML = S.store.mode === "cloud" ? viewLogin() : S.store.mode === "icloud" ? viewICloudSetup() : `<div class="loading">Chargement…</div>`;
    return;
  }
  nav.hidden = false;
  const { parts, query } = route();
  const [a, b, c] = parts;
  let html;
  try {
    if (!a) html = viewHome();
    else if (a === "plays" && b === "new") html = viewPlayForm(null, query);
    else if (a === "plays" && b === "deleted") html = viewDeletedPlays();
    else if (a === "plays" && b && c === "edit") html = viewPlayForm(b, query);
    else if (a === "plays" && b) html = viewPlay(b);
    else if (a === "plays") html = viewPlays();
    else if (a === "games" && b === "new") html = viewGameAdd(query);
    else if (a === "games" && b === "import") html = viewImport();
    else if (a === "games" && b && c === "edit") html = viewGameForm(b);
    else if (a === "games" && b) html = viewGame(b);
    else if (a === "games") html = viewGames();
    else if (a === "players" && b === "new") html = viewPlayerForm(null);
    else if (a === "players" && b && c === "edit") html = viewPlayerForm(b);
    else if (a === "players" && b) html = viewPlayer(b);
    else if (a === "players") html = viewPlayers();
    else if (a === "more") html = viewMore();
    else html = notFound();
  } catch (e) {
    console.error(e);
    html = `<div class="empty"><p>Une erreur est survenue.</p><p class="muted">${esc(e.message)}</p></div>`;
  }
  main.innerHTML = html;
  const tab = a === "plays" ? "plays" : a === "games" ? "games" : a === "players" ? "players" : a === "more" ? "more" : "home";
  $$("#nav a").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  afterRender(a, b, c);
}

function afterRender(a, b, c) {
  if (a === "plays" && (b === "new" || c === "edit")) refreshRanks();
  if (a === "plays" && b && b !== "new" && b !== "deleted" && !c) loadHistory(b);
  if (a === "plays" && b === "deleted") loadDeleted();
  const focus = $("[data-autofocus]");
  if (focus && !matchMedia("(hover: none)").matches) focus.focus();
}

const notFound = () => `<div class="empty"><p>Page introuvable.</p><a class="btn" href="#/">Retour à l'accueil</a></div>`;

// ---------- Composants communs -----------------------------------------
function header(title, { back, actions = "", sub = "" } = {}) {
  return `<header class="top">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Retour">${icon("back", 22)}</a>` : ""}
    <div class="top-title"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>
    <div class="top-actions">${actions}</div>
  </header>`;
}

function gameThumb(g, size = 48) {
  if (!g) return `<div class="thumb" style="width:${size}px;height:${size}px"></div>`;
  const src = g.thumbnail_url || g.image_url;
  return src
    ? `<img class="thumb" src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="thumb ph" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.8)}px">${esc(initials(g.name))}</div>`;
}

const dot = (p) => `<span class="pdot" style="background:${esc(p?.color || "#888")}"></span>`;
const pname = (id) => esc(player(id)?.name || "Joueur supprimé");

function periodChips() {
  return `<div class="chips" role="group" aria-label="Période">${Object.entries(PERIODS).map(([k, v]) =>
    `<button class="chip ${S.ui.period === k ? "on" : ""}" data-action="period" data-v="${k}">${v}</button>`).join("")}</div>`;
}

function kpi(label, value, note = "") {
  return `<div class="kpi"><div class="kpi-v">${value}</div><div class="kpi-l">${label}</div>${note ? `<div class="kpi-n">${note}</div>` : ""}</div>`;
}

// Diagramme en barres (une série), en HTML pour garder un texte net ; info-bulle au survol / toucher.
function barChart(rows, { label = (r) => r.label, height = 150 } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const top = rows.reduce((m, r, i) => (r.value > rows[m].value ? i : m), 0);
  return `<div class="bars" style="--h:${height}px" role="img" aria-label="${esc(rows.map((r) => r.tip).join(" ; "))}">
    ${rows.map((r, i) => `<div class="bcol" data-tip="${esc(r.tip)}">
      <div class="bwrap">${i === top && r.value > 0 ? `<span class="bval">${r.value}</span>` : ""}
        <div class="bfill" style="height:${(r.value / max) * 100}%"></div></div>
      <span class="blbl">${esc(label(r))}</span></div>`).join("")}</div>`;
}

function hbars(items) { // liste avec barres horizontales (top jeux)
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<ul class="hbars">${items.map((i) => `<li>
    <a href="${i.href}"><span class="hb-name">${esc(i.label)}</span>
    <span class="hb-track"><span class="hb-fill" style="width:${(i.value / max) * 100}%"></span></span>
    <span class="hb-val">${i.value}</span></a></li>`).join("")}</ul>`;
}

function rate(x, n) {
  return `<span class="${n < MIN_SAMPLE ? "thin" : ""}" ${n < MIN_SAMPLE ? `title="Moins de ${MIN_SAMPLE} parties : peu significatif"` : ""}>${fmtPct(x)}</span>`;
}

function playResultLine(p) {
  if (p.mode === "coop" || p.mode === "solo") {
    const who = p.mode === "solo" ? pname(p.players[0]?.player_id) + " · " : "";
    return p.coop_result === "win" ? `${who}<span class="ok">Victoire</span>` : p.coop_result === "loss" ? `${who}<span class="ko">Défaite</span>` : who;
  }
  const w = p.players.filter((x) => x.is_winner);
  if (!w.length) return `<span class="muted">Pas de gagnant</span>`;
  if (p.mode === "teams") return `${icon("trophy", 14, "tr")} ${esc(w[0].team || "")} · ${w.map((x) => pname(x.player_id)).join(", ")}`;
  return `${icon("trophy", 14, "tr")} ${w.map((x) => pname(x.player_id)).join(", ")}`;
}

function playCard(p) {
  const g = game(p.game_id);
  return `<a class="card play" href="#/plays/${p.id}">
    ${gameThumb(g, 44)}
    <div class="pc-body">
      <div class="pc-top"><strong>${esc(g?.name || "Jeu supprimé")}</strong><span class="muted small">${fmtShort(p.played_at)}</span></div>
      <div class="pc-res">${playResultLine(p)}</div>
      <div class="pc-meta muted small">${plural(p.players.length, "joueur", "joueurs")}${p.mode !== "competitive" ? ` · ${MODES[p.mode]}` : ""}${p.is_learning ? ` · <span class="tag">Apprentissage</span>` : ""}</div>
    </div></a>`;
}

const fab = (href, label) => isAdmin() ? `<a class="fab" href="${href}" aria-label="${esc(label)}">${icon("plus", 26)}</a>` : "";

// ---------- Accueil ------------------------------------------------------
function chartMonths(period) {
  const y = new Date().getFullYear();
  if (period === "year") return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
  if (period === "lastyear") return Array.from({ length: 12 }, (_, i) => `${y - 1}-${String(i + 1).padStart(2, "0")}`);
  return monthsBack(12);
}
function monthRows(plays, period) {
  return chartMonths(period).map((ym) => {
    const n = plays.filter((p) => p.played_at.startsWith(ym)).length;
    return { label: monthShort(ym), value: n, tip: `${monthLabel(ym)} : ${plural(n, "partie", "parties")}` };
  });
}

function viewHome() {
  const plays = filterPlays(S.data.plays, { period: S.ui.period });
  const st = globalStats(S.data, plays);
  const recent = playsSorted().slice(0, 5);
  if (!S.data.plays.length) {
    return header("C-Party") + `<div class="empty">
      <p><strong>Aucune partie pour l'instant.</strong></p>
      ${isAdmin() ? `<p class="muted">Commence par ajouter tes jeux, puis enregistre une première partie.</p>
        <div class="row-gap"><a class="btn" href="#/games/import">Importer ma collection BGG</a><a class="btn primary" href="#/plays/new">Nouvelle partie</a></div>`
        : `<p class="muted">Les parties apparaîtront ici dès qu'un gestionnaire les aura saisies.</p>`}
    </div>` + fab("#/plays/new", "Nouvelle partie");
  }
  const myPlayer = S.data.me.player_id && player(S.data.me.player_id);
  return header("C-Party", { sub: myPlayer ? `Bonjour ${esc(myPlayer.name)}` : "" }) + `
    ${periodChips()}
    <section class="kpis">
      ${kpi("parties", fmtNum(st.count), st.learning ? `dont ${st.learning} d'apprentissage` : "")}
      ${kpi("de jeu", fmtHours(st.minutes))}
      ${kpi("jeux joués", fmtNum(st.gamesPlayed))}
      ${kpi("joueurs", fmtNum(st.playersActive))}
    </section>
    <section class="panel">
      <h2>Parties par mois</h2>
      ${barChart(monthRows(plays, S.ui.period))}
    </section>
    <section class="panel">
      <h2>Classement</h2>
      ${st.leaderboard.length ? `<table class="tbl">
        <thead><tr><th>Joueur</th><th class="n">Parties</th><th class="n">Victoires</th><th class="n">Taux</th></tr></thead>
        <tbody>${st.leaderboard.map((l, i) => `<tr data-href="#/players/${l.player.id}">
          <td><span class="rk">${i + 1}</span>${dot(l.player)}${esc(l.player.name)}</td>
          <td class="n">${l.plays}</td><td class="n">${l.wins}</td><td class="n">${rate(l.rate, l.comp)}</td></tr>`).join("")}
        </tbody></table>
        <p class="foot muted small">Victoires et taux portent sur les parties compétitives et par équipes, hors apprentissage.</p>` : `<p class="muted">Aucune partie sur cette période.</p>`}
      ${st.coop.plays ? `<p class="coopline">Coopératif et solo : <strong>${plural(st.coop.wins, "réussite", "réussites")}</strong> sur ${st.coop.plays} (${fmtPct(st.coop.wins / st.coop.plays)})</p>` : ""}
    </section>
    ${st.topGames.length ? `<section class="panel"><h2>Jeux les plus joués</h2>
      ${hbars(st.topGames.slice(0, 6).map((t) => ({ label: t.game.name, value: t.count, href: `#/games/${t.game.id}` })))}</section>` : ""}
    <section class="panel">
      <div class="panel-head"><h2>Dernières parties</h2><a href="#/plays" class="small">Tout voir</a></div>
      <div class="list">${recent.map(playCard).join("")}</div>
    </section>
    ${fab("#/plays/new", "Nouvelle partie")}`;
}

// ---------- Parties : liste --------------------------------------------
function viewPlays() {
  const q = S.ui.playQuery.trim().toLowerCase();
  let plays = playsSorted();
  if (q) plays = plays.filter((p) => (game(p.game_id)?.name || "").toLowerCase().includes(q)
    || p.players.some((x) => (player(x.player_id)?.name || "").toLowerCase().includes(q)));
  const groups = new Map();
  plays.forEach((p) => {
    const k = p.played_at.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  });
  return header("Parties", { sub: plural(S.data.plays.length, "partie enregistrée", "parties enregistrées") }) + `
    <div class="search">${icon("search", 18)}<input type="search" placeholder="Jeu ou joueur" value="${esc(S.ui.playQuery)}" data-input="playQuery" aria-label="Rechercher une partie"></div>
    ${plays.length ? [...groups.entries()].map(([ym, ps]) => `<section class="group">
      <h2 class="group-h">${monthLabel(ym)} <span class="muted">· ${ps.length}</span></h2>
      <div class="list">${ps.map(playCard).join("")}</div></section>`).join("")
      : `<div class="empty"><p class="muted">${q ? "Aucune partie ne correspond." : "Aucune partie enregistrée."}</p></div>`}
    ${isAdmin() ? `<p class="center"><a href="#/plays/deleted" class="small muted">${icon("trash", 14)} Parties supprimées</a></p>` : ""}
    ${fab("#/plays/new", "Nouvelle partie")}`;
}

// ---------- Partie : détail + historique --------------------------------
function viewPlay(id) {
  const p = S.data.plays.find((x) => x.id === id);
  if (!p) return header("Partie", { back: "#/plays" }) + `<div class="empty"><p>Cette partie n'existe plus.</p></div>`;
  const g = game(p.game_id);
  const actions = isAdmin() ? `<a class="icon-btn" href="#/plays/${p.id}/edit" aria-label="Modifier">${icon("edit")}</a>
    <button class="icon-btn" data-action="delete-play" data-id="${p.id}" aria-label="Supprimer">${icon("trash")}</button>` : "";
  let results;
  if (p.mode === "coop" || p.mode === "solo") {
    results = `<div class="banner ${p.coop_result === "win" ? "win" : "loss"}">${p.coop_result === "win" ? icon("trophy", 20) + " Victoire" : "Défaite"}${p.mode === "coop" ? " collective" : ""}</div>
      <ul class="results">${p.players.map((x) => `<li>${dot(player(x.player_id))}<a href="#/players/${x.player_id}">${pname(x.player_id)}</a>${x.score != null ? `<span class="sc">${fmtScore(x.score)}</span>` : ""}</li>`).join("")}</ul>`;
  } else if (p.mode === "teams") {
    const teams = new Map();
    p.players.forEach((x) => { const t = x.team || "Sans équipe"; if (!teams.has(t)) teams.set(t, []); teams.get(t).push(x); });
    results = [...teams.entries()].sort((a, b) => (a[1][0].rank ?? 99) - (b[1][0].rank ?? 99)).map(([t, xs]) => `
      <div class="team ${xs[0].is_winner ? "won" : ""}"><div class="team-h"><span class="rk">${xs[0].rank ?? "–"}</span><strong>${esc(t)}</strong>
      ${xs[0].score != null ? `<span class="sc">${fmtScore(xs[0].score)}</span>` : ""}${xs[0].is_winner ? icon("trophy", 16, "tr") : ""}</div>
      <div class="muted">${xs.map((x) => `<a href="#/players/${x.player_id}">${pname(x.player_id)}</a>`).join(", ")}</div></div>`).join("");
  } else {
    results = `<ul class="results">${[...p.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((x) => `
      <li class="${x.is_winner ? "won" : ""}"><span class="rk">${x.rank ?? "–"}</span>${dot(player(x.player_id))}
      <a href="#/players/${x.player_id}">${pname(x.player_id)}</a>${x.is_winner ? icon("trophy", 16, "tr") : ""}
      <span class="sc">${fmtScore(x.score)}</span></li>`).join("")}</ul>`;
  }
  const exps = (p.expansions || []).map(game).filter(Boolean);
  const creator = profile(p.created_by);
  return header(g?.name || "Jeu supprimé", { back: "#/plays", actions, sub: `${fmtDate(p.played_at)} · ${MODES[p.mode]}${p.is_learning ? " · Apprentissage" : ""}` }) + `
    <section class="panel">${results}</section>
    <section class="panel facts">
      ${p.duration_min ? `<div>${icon("clock", 16)} ${p.duration_min} min</div>` : ""}
      ${exps.length ? `<div>${icon("puzzle", 16)} ${exps.map((e) => esc(e.name)).join(", ")}</div>` : ""}
      ${p.notes ? `<div class="note">${esc(p.notes)}</div>` : ""}
      ${g ? `<div><a href="#/games/${g.id}">Voir la fiche du jeu</a></div>` : ""}
    </section>
    <section class="panel">
      <h2>${icon("history", 18)} Historique</h2>
      <p class="muted small">Saisie${p.created_at ? ` le ${fmtDateTime(p.created_at)}` : ""}${creator ? ` par ${esc(creator.display_name || creator.email)}` : ""}</p>
      <div id="history" class="history"><p class="muted small">Chargement…</p></div>
    </section>`;
}

const FIELD_LABELS = { game_id: "Jeu", played_at: "Date", mode: "Mode", coop_result: "Résultat", is_learning: "Apprentissage", duration_min: "Durée", notes: "Commentaire" };
function fieldValue(k, v) {
  if (v == null || v === "") return "—";
  if (k === "game_id") return game(v)?.name || "jeu supprimé";
  if (k === "played_at") return fmtDate(v);
  if (k === "mode") return MODES[v] || v;
  if (k === "coop_result") return v === "win" ? "victoire" : "défaite";
  if (k === "is_learning") return v ? "oui" : "non";
  if (k === "duration_min") return `${v} min`;
  return String(v);
}
function diffLines(before, after) {
  const out = [];
  for (const k of Object.keys(FIELD_LABELS))
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
      out.push(`${FIELD_LABELS[k]} : ${esc(fieldValue(k, before[k]))} → ${esc(fieldValue(k, after[k]))}`);
  const bp = new Map(before.players.map((x) => [x.player_id, x]));
  const ap = new Map(after.players.map((x) => [x.player_id, x]));
  for (const [id, x] of ap) {
    const o = bp.get(id);
    if (!o) { out.push(`Joueur ajouté : ${pname(id)}`); continue; }
    if (Number(o.score ?? NaN) !== Number(x.score ?? NaN) && !(o.score == null && x.score == null))
      out.push(`Score de ${pname(id)} : ${fmtScore(o.score)} → ${fmtScore(x.score)}`);
    if ((o.rank ?? null) !== (x.rank ?? null)) out.push(`Rang de ${pname(id)} : ${o.rank ?? "—"} → ${x.rank ?? "—"}`);
    if ((o.team ?? null) !== (x.team ?? null)) out.push(`Équipe de ${pname(id)} : ${esc(o.team ?? "—")} → ${esc(x.team ?? "—")}`);
  }
  for (const id of bp.keys()) if (!ap.has(id)) out.push(`Joueur retiré : ${pname(id)}`);
  const be = new Set(before.expansions || []), ae = new Set(after.expansions || []);
  for (const e of ae) if (!be.has(e)) out.push(`Extension ajoutée : ${esc(game(e)?.name || "?")}`);
  for (const e of be) if (!ae.has(e)) out.push(`Extension retirée : ${esc(game(e)?.name || "?")}`);
  return out;
}
const ACTIONS = { create: "Création", update: "Modification", delete: "Suppression", restore: "Restauration" };

async function loadHistory(playId) {
  const box = $("#history");
  if (!box) return;
  try {
    const rows = await S.store.history(playId);
    if (!$("#history")) return;
    box.innerHTML = rows.length ? `<ol>${rows.map((h) => {
      const who = profile(h.actor);
      const lines = h.action === "update" && h.before && h.after ? diffLines(h.before, h.after) : [];
      return `<li><div><strong>${ACTIONS[h.action]}</strong> <span class="muted small">le ${fmtDateTime(h.at)}${who ? ` par ${esc(who.display_name || who.email)}` : ""}</span></div>
        ${lines.length ? `<ul class="diff">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}</li>`;
    }).join("")}</ol>` : `<p class="muted small">Aucune modification enregistrée.</p>`;
  } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
}

function viewDeletedPlays() {
  return header("Parties supprimées", { back: "#/plays" }) + `<p class="muted pad">Une partie supprimée par erreur peut être restaurée, avec ses scores et ses joueurs.</p>
    <div id="deleted" class="list"><p class="muted pad">Chargement…</p></div>`;
}
async function loadDeleted() {
  const box = $("#deleted");
  try {
    const rows = await S.store.deletedPlays();
    if (!$("#deleted")) return;
    box.innerHTML = rows.length ? rows.map((h) => {
      const g = game(h.before?.game_id);
      const who = profile(h.actor);
      return `<div class="card play">${gameThumb(g, 44)}<div class="pc-body">
        <div class="pc-top"><strong>${esc(g?.name || "Jeu supprimé")}</strong><span class="muted small">${fmtShort(h.before.played_at)}</span></div>
        <div class="muted small">Supprimée le ${fmtDateTime(h.at)}${who ? ` par ${esc(who.display_name || who.email)}` : ""}</div>
        <div class="muted small">${h.before.players.map((x) => pname(x.player_id)).join(", ")}</div></div>
        ${isAdmin() && g ? `<button class="btn small" data-action="restore-play" data-id="${h.id}">${icon("restore", 16)} Restaurer</button>` : ""}</div>`;
    }).join("") : `<div class="empty"><p class="muted">Aucune partie supprimée.</p></div>`;
  } catch (e) { box.innerHTML = `<p class="muted pad">${esc(e.message)}</p>`; }
}

// ---------- Partie : formulaire -----------------------------------------
function newForm(query) {
  const gid = query.get("game") || "";
  const g = gid && game(gid);
  return {
    id: null, game_id: g ? g.id : "", played_at: today(), mode: g ? g.default_mode : "competitive",
    coop_result: "", is_learning: false, duration_min: "", notes: "",
    expansions: [], players: [], teams: [{ name: "Équipe 1", score: "", rank: "" }, { name: "Équipe 2", score: "", rank: "" }],
    manual: false,
  };
}
function formFromPlay(p) {
  const teamNames = [...new Set(p.players.map((x) => x.team).filter(Boolean))];
  const teams = teamNames.length ? teamNames.map((n) => {
    const x = p.players.find((y) => y.team === n);
    return { name: n, score: x.score ?? "", rank: x.rank ?? "" };
  }) : [{ name: "Équipe 1", score: "", rank: "" }, { name: "Équipe 2", score: "", rank: "" }];
  return {
    id: p.id, game_id: p.game_id, played_at: p.played_at, mode: p.mode, coop_result: p.coop_result || "",
    is_learning: !!p.is_learning, duration_min: p.duration_min ?? "", location: p.location || null, notes: p.notes || "",
    expansions: [...(p.expansions || [])],
    players: p.players.map((x) => ({ player_id: x.player_id, score: x.score ?? "", rank: x.rank ?? "", team: x.team || "" })),
    teams, manual: true,
  };
}

function viewPlayForm(id, query) {
  if (!isAdmin()) return header("Partie", { back: "#/plays" }) + `<div class="empty"><p>Réservé aux gestionnaires.</p></div>`;
  const key = id || "new:" + (query.get("game") || "");
  if (!S.form || S.form._key !== key) {
    if (id) {
      const p = S.data.plays.find((x) => x.id === id);
      if (!p) return notFound();
      S.form = formFromPlay(p);
    } else S.form = newForm(query);
    S.form._key = key;
  }
  const f = S.form;
  const g = game(f.game_id);
  const games = baseGames();
  if (!games.length) return header("Nouvelle partie", { back: "#/plays" }) + `<div class="empty"><p>Ajoute d'abord un jeu à la ludothèque.</p>
    <a class="btn primary" href="#/games/new">Ajouter un jeu</a></div>`;
  const recentIds = [...new Set(playsSorted().map((p) => p.game_id))].slice(0, 5).filter((x) => game(x));
  const exps = g ? expansionsOf(g.id) : [];
  const rule = g?.score_rule || "high";
  const selected = new Set(f.players.map((x) => x.player_id));

  let resultBlock = "";
  if (f.mode === "coop" || f.mode === "solo") {
    resultBlock = `<fieldset class="field"><legend>Résultat</legend><div class="seg">
      <button type="button" class="${f.coop_result === "win" ? "on" : ""}" data-action="f-result" data-v="win">Victoire</button>
      <button type="button" class="${f.coop_result === "loss" ? "on" : ""}" data-action="f-result" data-v="loss">Défaite</button></div></fieldset>`;
    if (f.mode === "solo" && f.players.length && rule !== "none") resultBlock += `<label class="field"><span>Score (facultatif)</span>
      <input type="number" inputmode="decimal" step="any" data-f-score="${f.players[0].player_id}" value="${esc(f.players[0].score)}"></label>`;
  } else if (f.mode === "teams") {
    resultBlock = `<fieldset class="field"><legend>Équipes ${rule !== "none" ? `<span class="muted small">· ${SCORE_RULES[rule].toLowerCase()}</span>` : ""}</legend>
      ${f.teams.map((t, i) => `<div class="team-row">
        <input class="team-name" value="${esc(t.name)}" data-f-teamname="${i}" aria-label="Nom de l'équipe ${i + 1}">
        ${rule !== "none" ? `<input type="number" inputmode="decimal" step="any" placeholder="Score" value="${esc(t.score)}" data-f-teamscore="${i}" aria-label="Score">` : ""}
        <label class="rank-in"><span>Rang</span><input type="number" min="1" inputmode="numeric" value="${esc(t.rank)}" data-f-teamrank="${i}"></label>
        <span class="win-mark" data-team-win="${i}"></span>
        ${f.teams.length > 2 ? `<button type="button" class="icon-btn" data-action="f-team-del" data-i="${i}" aria-label="Retirer l'équipe">${icon("x", 16)}</button>` : ""}
      </div>`).join("")}
      <button type="button" class="btn small ghost" data-action="f-team-add">${icon("plus", 16)} Équipe</button>
    </fieldset>`;
  }

  const playerRows = f.players.map((x) => {
    const pl = player(x.player_id);
    let inputs = "";
    if (f.mode === "competitive") {
      inputs = `${rule !== "none" ? `<input type="number" inputmode="decimal" step="any" placeholder="Score" value="${esc(x.score)}" data-f-score="${x.player_id}" aria-label="Score de ${esc(pl?.name)}">` : ""}
        <label class="rank-in"><span>Rang</span><input type="number" min="1" inputmode="numeric" value="${esc(x.rank)}" data-f-rank="${x.player_id}"></label>
        <span class="win-mark" data-win="${x.player_id}"></span>`;
    } else if (f.mode === "teams") {
      inputs = `<select data-f-team="${x.player_id}" aria-label="Équipe de ${esc(pl?.name)}">${f.teams.map((t) => `<option ${t.name === x.team ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`;
    }
    return `<div class="prow">${dot(pl)}<span class="pr-name">${esc(pl?.name || "?")}</span>${inputs}</div>`;
  }).join("");

  return header(id ? "Modifier la partie" : "Nouvelle partie", { back: id ? `#/plays/${id}` : "#/plays" }) + `
  <form class="form" data-form="play" novalidate>
    <label class="field"><span>Jeu</span>
      <select data-f="game_id" required>
        <option value="">Choisir un jeu…</option>
        ${recentIds.length ? `<optgroup label="Joués récemment">${recentIds.map((x) => `<option value="${x}" ${x === f.game_id ? "selected" : ""}>${esc(game(x).name)}</option>`).join("")}</optgroup>` : ""}
        <optgroup label="Tous les jeux">${games.map((x) => `<option value="${x.id}" ${x.id === f.game_id && !recentIds.includes(x.id) ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup>
      </select></label>
    <div class="grid2">
      <label class="field"><span>Date</span><input type="date" data-f="played_at" value="${esc(f.played_at)}" max="${today()}" required></label>
      <label class="field"><span>Durée (min)</span><input type="number" min="1" inputmode="numeric" data-f="duration_min" value="${esc(f.duration_min)}" placeholder="${g?.min_time ? `≈ ${g.min_time}${g.max_time && g.max_time !== g.min_time ? "–" + g.max_time : ""}` : ""}"></label>
    </div>
    <fieldset class="field"><legend>Mode</legend><div class="seg four">
      ${Object.entries(MODES).map(([k, v]) => `<button type="button" class="${f.mode === k ? "on" : ""}" data-action="f-mode" data-v="${k}">${v}</button>`).join("")}
    </div></fieldset>
    ${exps.length ? `<fieldset class="field"><legend>Extensions utilisées</legend><div class="chips wrap">
      ${exps.map((e) => `<button type="button" class="chip ${f.expansions.includes(e.id) ? "on" : ""}" data-action="f-exp" data-id="${e.id}">${esc(e.name)}</button>`).join("")}</div></fieldset>` : ""}
    <fieldset class="field"><legend>Joueurs présents ${f.mode === "solo" ? `<span class="muted small">· un seul</span>` : ""}</legend>
      <div class="chips wrap">
        ${activePlayers().map((p) => `<button type="button" class="chip pchip ${selected.has(p.id) ? "on" : ""}" data-action="f-player" data-id="${p.id}">${dot(p)}${esc(p.name)}</button>`).join("")}
        <button type="button" class="chip add" data-action="f-newplayer">${icon("plus", 14)} Nouveau</button>
      </div>
      <div id="newplayer" hidden class="inline-add"><input placeholder="Prénom du joueur" id="np-name" maxlength="40"><button type="button" class="btn small primary" data-action="f-newplayer-save">Ajouter</button></div>
    </fieldset>
    ${resultBlock}
    ${f.players.length && f.mode !== "coop" && f.mode !== "solo" ? `<fieldset class="field"><legend>${f.mode === "teams" ? "Composition des équipes" : `Scores et classement ${rule !== "none" ? `<span class="muted small">· ${SCORE_RULES[rule].toLowerCase()}</span>` : ""}`}</legend>
      <div class="prows">${playerRows}</div>
      ${f.mode === "competitive" && rule !== "none" ? `<p class="hint" id="rank-hint"></p>` : ""}
    </fieldset>` : ""}
    <label class="check"><input type="checkbox" data-f="is_learning" ${f.is_learning ? "checked" : ""}> Partie d'apprentissage <span class="muted small">(exclue des victoires)</span></label>
    <label class="field"><span>Commentaire</span><textarea data-f="notes" rows="2" maxlength="1000">${esc(f.notes)}</textarea></label>
    <p class="form-error" id="form-error" role="alert"></p>
    <div class="form-actions"><a class="btn ghost" href="${id ? `#/plays/${id}` : "#/plays"}">Annuler</a><button class="btn primary" type="submit">${id ? "Enregistrer" : "Enregistrer la partie"}</button></div>
  </form>`;
}

// Recalcule les rangs déduits des scores et met à jour l'affichage sans redessiner le formulaire.
function refreshRanks() {
  const f = S.form;
  if (!f) return;
  const g = game(f.game_id);
  const rule = g?.score_rule || "high";
  const hint = $("#rank-hint");
  if (f.mode === "competitive") {
    if (!f.manual) {
      const r = autoRanks(f.players.map((x) => ({ key: x.player_id, score: x.score })), rule);
      f.players.forEach((x) => { x.rank = r[x.player_id] ?? ""; const el = $(`[data-f-rank="${x.player_id}"]`); if (el) el.value = x.rank; });
    }
    f.players.forEach((x) => { const el = $(`[data-win="${x.player_id}"]`); if (el) el.innerHTML = Number(x.rank) === 1 ? icon("trophy", 18, "tr") : ""; });
    if (hint) hint.innerHTML = f.manual
      ? `Classement modifié à la main. <button type="button" class="linkish" data-action="f-auto">Recalculer depuis les scores</button>`
      : "Le classement se calcule à partir des scores. Les égalités donnent le même rang ; corrige un rang pour départager.";
  } else if (f.mode === "teams") {
    if (!f.manual) {
      const r = autoRanks(f.teams.map((t, i) => ({ key: i, score: t.score })), rule);
      f.teams.forEach((t, i) => { if (r[i] != null) { t.rank = r[i]; const el = $(`[data-f-teamrank="${i}"]`); if (el) el.value = t.rank; } });
    }
    f.teams.forEach((t, i) => { const el = $(`[data-team-win="${i}"]`); if (el) el.innerHTML = Number(t.rank) === 1 ? icon("trophy", 18, "tr") : ""; });
  }
}

function buildPlayPayload() {
  const f = S.form;
  const g = game(f.game_id);
  if (!g) throw new Error("Choisis un jeu.");
  if (!f.played_at) throw new Error("Indique la date.");
  if (!f.players.length) throw new Error("Sélectionne au moins un joueur.");
  if (f.mode === "solo" && f.players.length !== 1) throw new Error("Une partie solo compte un seul joueur.");
  const num = (v) => (v === "" || v == null ? null : Number(v));
  let players;
  let coop_result = null;
  if (f.mode === "coop" || f.mode === "solo") {
    if (!f.coop_result) throw new Error("Indique si la partie est gagnée ou perdue.");
    coop_result = f.coop_result;
    players = f.players.map((x) => ({ player_id: x.player_id, score: f.mode === "solo" ? num(x.score) : null, rank: null, team: null, is_winner: f.coop_result === "win" }));
  } else if (f.mode === "teams") {
    const used = new Set(f.players.map((x) => x.team));
    const teams = f.teams.filter((t) => used.has(t.name));
    if (teams.length < 2) throw new Error("Répartis les joueurs dans au moins deux équipes.");
    if (new Set(f.teams.map((t) => t.name.trim())).size !== f.teams.length) throw new Error("Deux équipes portent le même nom.");
    if (teams.some((t) => !Number(t.rank))) throw new Error("Indique le rang de chaque équipe (1 pour la gagnante).");
    players = f.players.map((x) => {
      const t = f.teams.find((y) => y.name === x.team);
      return { player_id: x.player_id, score: num(t.score), rank: Number(t.rank), team: t.name, is_winner: Number(t.rank) === 1 };
    });
  } else {
    if (f.players.some((x) => !Number(x.rank) || Number(x.rank) < 1)) throw new Error(g.score_rule === "none" ? "Indique le rang de chaque joueur (1 pour le gagnant)." : "Saisis le score de chaque joueur, ou indique les rangs à la main.");
    if (!f.players.some((x) => Number(x.rank) === 1)) throw new Error("Au moins un joueur doit être classé 1er.");
    players = f.players.map((x) => ({ player_id: x.player_id, score: num(x.score), rank: Number(x.rank), team: null, is_winner: Number(x.rank) === 1 }));
  }
  return {
    id: f.id || uuid(), game_id: f.game_id, played_at: f.played_at, mode: f.mode, coop_result,
    is_learning: !!f.is_learning, duration_min: num(f.duration_min), location: f.location || null,
    notes: f.notes.trim() || null, players, expansions: f.expansions.filter((e) => game(e)?.base_game_id === f.game_id),
  };
}

// ---------- Jeux : liste -------------------------------------------------
function viewGames() {
  const q = S.ui.gameQuery.trim().toLowerCase();
  const counts = new Map();
  S.data.plays.forEach((p) => counts.set(p.game_id, (counts.get(p.game_id) || 0) + 1));
  let games = baseGames();
  const total = games.length;
  if (S.ui.gameStatus !== "all") games = games.filter((g) => g.status === S.ui.gameStatus);
  if (q) games = games.filter((g) => g.name.toLowerCase().includes(q) || (g.bgg_name || "").toLowerCase().includes(q));
  const actions = isAdmin() ? `<a class="icon-btn" href="#/games/import" aria-label="Importer ma collection BGG">${icon("download")}</a>` : "";
  return header("Jeux", { sub: plural(total, "jeu", "jeux"), actions }) + `
    <div class="search">${icon("search", 18)}<input type="search" placeholder="Rechercher un jeu" value="${esc(S.ui.gameQuery)}" data-input="gameQuery" aria-label="Rechercher un jeu"></div>
    <div class="chips">${[["all", "Tous"], ...Object.entries(STATUS)].map(([k, v]) =>
      `<button class="chip ${S.ui.gameStatus === k ? "on" : ""}" data-action="game-status" data-v="${k}">${v}</button>`).join("")}</div>
    ${games.length ? `<div class="list">${games.map((g) => {
      const n = counts.get(g.id) || 0;
      const exps = expansionsOf(g.id).length;
      return `<a class="card game" href="#/games/${g.id}">${gameThumb(g, 56)}
        <div class="gc-body"><strong>${esc(g.name)}</strong>
        <div class="muted small gc-meta">${g.min_players ? `${icon("person", 13)} ${g.min_players}${g.max_players && g.max_players !== g.min_players ? `–${g.max_players}` : ""}` : ""}
          ${g.min_time ? ` ${icon("clock", 13)} ${g.min_time}${g.max_time && g.max_time !== g.min_time ? `–${g.max_time}` : ""} min` : ""}
          ${g.weight ? ` ${icon("weight", 13)} ${fmtNum(g.weight, 1)}/5` : ""}</div>
        <div class="small">${plural(n, "partie", "parties")}${exps ? ` · ${plural(exps, "extension", "extensions")}` : ""}${g.status === "lent" ? ` · <span class="tag">Prêté${g.lent_to ? " à " + esc(g.lent_to) : ""}</span>` : g.status === "elsewhere" ? ` · <span class="tag">Joué ailleurs</span>` : ""}</div>
        </div></a>`;
    }).join("")}</div>` : `<div class="empty"><p class="muted">${total ? "Aucun jeu ne correspond." : "La ludothèque est vide."}</p>
      ${!total && isAdmin() ? `<div class="row-gap"><a class="btn" href="#/games/import">Importer ma collection BGG</a><a class="btn primary" href="#/games/new">Ajouter un jeu</a></div>` : ""}</div>`}
    ${fab("#/games/new", "Ajouter un jeu")}`;
}

// ---------- Jeu : fiche + stats ------------------------------------------
function viewGame(id) {
  const g = game(id);
  if (!g) return header("Jeu", { back: "#/games" }) + `<div class="empty"><p>Ce jeu n'existe plus.</p></div>`;
  if (g.base_game_id) {
    const base = game(g.base_game_id);
    return header(g.name, { back: base ? `#/games/${base.id}` : "#/games", sub: base ? `Extension de ${esc(base.name)}` : "Extension",
      actions: isAdmin() ? `<a class="icon-btn" href="#/games/${g.id}/edit" aria-label="Modifier">${icon("edit")}</a><button class="icon-btn" data-action="delete-game" data-id="${g.id}" aria-label="Supprimer">${icon("trash")}</button>` : "" }) +
      gameFacts(g) + `<section class="panel"><p>Utilisée dans ${plural(S.data.plays.filter((p) => (p.expansions || []).includes(g.id)).length, "partie", "parties")}.</p></section>`;
  }
  const st = gameStats(S.data, g, S.data.plays);
  const exps = expansionsOf(g.id);
  const actions = isAdmin() ? `<a class="icon-btn" href="#/games/${g.id}/edit" aria-label="Modifier">${icon("edit")}</a>
    <button class="icon-btn" data-action="delete-game" data-id="${g.id}" aria-label="Supprimer">${icon("trash")}</button>` : "";
  const sub = [g.bgg_name && g.bgg_name !== g.name ? esc(g.bgg_name) : "", g.year || ""].filter(Boolean).join(" · ");
  return header(g.name, { back: "#/games", actions, sub }) + `
    ${g.image_url ? `<div class="hero"><img src="${esc(g.image_url)}" alt="Boîte de ${esc(g.name)}" referrerpolicy="no-referrer"></div>` : ""}
    ${gameFacts(g)}
    ${exps.length ? `<section class="panel"><h2>Extensions</h2><ul class="plain">${exps.map((e) => `<li><a href="#/games/${e.id}">${icon("puzzle", 14)} ${esc(e.name)}</a></li>`).join("")}</ul></section>` : ""}
    <section class="kpis">
      ${kpi("parties", fmtNum(st.count))}
      ${kpi("de jeu", fmtHours(st.minutes))}
      ${kpi("durée réelle moy.", st.avgDuration ? `${fmtNum(st.avgDuration)} min` : "—")}
      ${kpi("dernière partie", st.last ? fmtShort(st.last) : "—", st.last ? String(st.last.slice(0, 4)) : "")}
    </section>
    ${st.record ? `<section class="panel record">${icon("trophy", 22, "tr")}<div><div class="muted small">Record (${g.score_rule === "low" ? "score le plus bas" : "meilleur score"})</div>
      <strong>${fmtScore(st.record.score)}</strong> par ${pname(st.record.player_id)} <span class="muted small">le ${fmtDate(st.record.date)}</span>
      ${st.avgScore != null ? `<div class="muted small">Score moyen : ${fmtScore(Math.round(st.avgScore * 10) / 10)}</div>` : ""}</div></section>` : ""}
    ${st.byPlayer.length ? `<section class="panel"><h2>Par joueur</h2>
      <table class="tbl"><thead><tr><th>Joueur</th><th class="n">Parties</th><th class="n">Vict.</th><th class="n">Taux</th>${g.score_rule !== "none" ? `<th class="n">Meilleur</th>` : ""}</tr></thead>
      <tbody>${st.byPlayer.map((l) => `<tr data-href="#/players/${l.player.id}"><td>${dot(l.player)}${esc(l.player.name)}</td>
        <td class="n">${l.plays}</td><td class="n">${l.comp ? l.wins : "—"}</td><td class="n">${l.comp ? rate(l.rate, l.comp) : "—"}</td>
        ${g.score_rule !== "none" ? `<td class="n">${fmtScore(l.best)}</td>` : ""}</tr>`).join("")}</tbody></table>
      ${st.coop.plays ? `<p class="coopline">Coopératif et solo : <strong>${plural(st.coop.wins, "réussite", "réussites")}</strong> sur ${st.coop.plays} (${fmtPct(st.coop.wins / st.coop.plays)})</p>` : ""}
    </section>` : ""}
    ${st.count ? `<section class="panel"><h2>Parties sur 12 mois</h2>${barChart(st.byMonth.map((m) => ({ label: monthShort(m.ym), value: m.count, tip: `${monthLabel(m.ym)} : ${plural(m.count, "partie", "parties")}` })), { height: 120 })}</section>
      <section class="panel"><div class="panel-head"><h2>Dernières parties</h2></div><div class="list">${st.plays.slice(0, 5).map(playCard).join("")}</div></section>` : ""}
    ${isAdmin() ? `<p class="center"><a class="btn primary" href="#/plays/new?game=${g.id}">${icon("plus", 18)} Nouvelle partie de ce jeu</a></p>` : ""}
    ${g.bgg_id ? `<p class="center small muted">Source : <a href="https://boardgamegeek.com/boardgame/${g.bgg_id}" target="_blank" rel="noopener">BoardGameGeek</a></p>` : ""}`;
}

function gameFacts(g) {
  const range = (a, b, unit = "") => (a ? `${a}${b && b !== a ? `–${b}` : ""}${unit}` : "—");
  return `<section class="panel">
    ${g.types?.length ? `<div class="chips wrap static">${g.types.map((t) => `<span class="chip on">${esc(t)}</span>`).join("")}</div>` : ""}
    <dl class="facts-grid">
      <div><dt>Joueurs</dt><dd>${range(g.min_players, g.max_players)}</dd></div>
      <div><dt>Durée</dt><dd>${range(g.min_time, g.max_time, " min")}</dd></div>
      <div><dt>Difficulté</dt><dd>${g.weight ? `${fmtNum(g.weight, 1)} / 5 <span class="meter"><span style="width:${(g.weight / 5) * 100}%"></span></span>` : "—"}</dd></div>
      <div><dt>Statut</dt><dd>${STATUS[g.status] || "—"}${g.status === "lent" && g.lent_to ? ` à ${esc(g.lent_to)}` : ""}</dd></div>
      <div><dt>Mode</dt><dd>${MODES[g.default_mode]}</dd></div>
      <div><dt>Score</dt><dd>${SCORE_RULES[g.score_rule]}</dd></div>
    </dl>
    ${g.mechanics?.length ? `<p class="small"><span class="muted">Mécaniques :</span> ${g.mechanics.map(esc).join(", ")}</p>` : ""}
    ${g.categories?.length ? `<p class="small"><span class="muted">Catégories :</span> ${g.categories.map(esc).join(", ")}</p>` : ""}
    ${g.designers?.length ? `<p class="small"><span class="muted">Auteur${g.designers.length > 1 ? "s" : ""} :</span> ${g.designers.map(esc).join(", ")}${g.publisher ? ` · <span class="muted">Éditeur :</span> ${esc(g.publisher)}` : ""}</p>` : ""}
    ${g.notes ? `<p class="note">${esc(g.notes)}</p>` : ""}
  </section>`;
}

// ---------- Jeu : ajout (recherche BGG) ------------------------------------
function viewGameAdd(query) {
  if (!isAdmin()) return notFound();
  return header("Ajouter un jeu", { back: "#/games" }) + `
    <div class="search">${icon("search", 18)}<input type="search" id="bgg-q" placeholder="Nom du jeu sur BoardGameGeek" data-autofocus aria-label="Rechercher sur BoardGameGeek"></div>
    <div id="bgg-results" class="list"></div>
    <p class="center small"><button class="linkish" data-action="game-manual">Jeu absent de BGG ? Saisie manuelle</button></p>
    ${S.store.mode === "demo" ? `<p class="center small muted">Mode démo : recherche dans un petit catalogue fictif (essaie « Pandémie », « Wingspan »).</p>` : ""}`;
}

const searchBgg = debounce(async (q) => {
  const box = $("#bgg-results");
  if (!box) return;
  if (q.trim().length < 2) { box.innerHTML = ""; return; }
  box.innerHTML = `<p class="muted pad">Recherche…</p>`;
  try {
    const res = await S.store.bgg.search(q.trim());
    if (!$("#bgg-results")) return;
    const owned = new Set(S.data.games.map((g) => g.bgg_id));
    box.innerHTML = res.length ? res.map((r) => `<button class="card result" data-action="bgg-pick" data-id="${r.id}" ${owned.has(r.id) ? "disabled" : ""}>
      <div><strong>${esc(r.name)}</strong> <span class="muted small">${r.year || ""}</span></div>
      <div class="small">${r.expansion ? `<span class="tag">Extension</span>` : ""}${owned.has(r.id) ? `<span class="tag">Déjà dans la ludothèque</span>` : ""}</div>
    </button>`).join("") : `<p class="muted pad">Aucun résultat.</p>`;
  } catch (e) { box.innerHTML = `<p class="form-error pad">${esc(e.message)}</p>`; }
}, 450);

function draftFromBgg(t) {
  const baseMatch = (t.base_bgg_ids || []).map((bid) => S.data.games.find((g) => g.bgg_id === bid && !g.base_game_id)).find(Boolean);
  return {
    id: null, name: guessFrenchName(t.bgg_name, t.names), bgg_name: t.bgg_name, bgg_id: t.bgg_id, year: t.year,
    image_url: t.image_url, thumbnail_url: t.thumbnail_url, types: t.types || [], categories: t.categories || [],
    mechanics: t.mechanics || [], designers: t.designers || [], publisher: t.publisher, min_players: t.min_players,
    max_players: t.max_players, min_time: t.min_time, max_time: t.max_time, weight: t.weight, status: "owned", lent_to: null,
    default_mode: t.cooperative ? "coop" : t.solo_only ? "solo" : "competitive", score_rule: t.cooperative ? "none" : "high",
    notes: null, base_game_id: t.expansion ? baseMatch?.id || "" : null, _isExpansion: !!t.expansion, _names: t.names || [], _baseBggIds: t.base_bgg_ids || [],
  };
}

// ---------- Jeu : formulaire ---------------------------------------------
function viewGameForm(id) {
  if (!isAdmin()) return notFound();
  if (id !== "draft") {
    const g = game(id);
    if (!g) return notFound();
    if (!S.gameDraft || S.gameDraft.id !== id) S.gameDraft = { ...g, _isExpansion: !!g.base_game_id };
  }
  const d = S.gameDraft;
  if (!d) { go("#/games/new"); return ""; }
  const back = d.id ? `#/games/${d.id}` : "#/games/new";
  const altNames = (d._names || []).filter((n) => n !== d.name);
  return header(d.id ? "Modifier le jeu" : "Nouveau jeu", { back, sub: d.bgg_id ? `BGG : ${esc(d.bgg_name)}${d.year ? ` (${d.year})` : ""}` : "Saisie manuelle" }) + `
  <form class="form" data-form="game" novalidate>
    ${d.thumbnail_url ? `<div class="center">${gameThumb(d, 96)}</div>` : ""}
    <label class="field"><span>Nom affiché</span><input name="name" value="${esc(d.name)}" required maxlength="120" list="altnames"></label>
    ${altNames.length ? `<datalist id="altnames">${altNames.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <p class="hint">Autres noms sur BGG : ${altNames.slice(0, 6).map(esc).join(" · ")}${altNames.length > 6 ? "…" : ""}</p>` : ""}
    ${d._isExpansion ? `<label class="field"><span>Extension de</span><select name="base_game_id" required>
      <option value="">Choisir le jeu de base…</option>${baseGames().filter((g) => g.id !== d.id).map((g) => `<option value="${g.id}" ${g.id === d.base_game_id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>` : ""}
    ${!d.bgg_id ? `<label class="field"><span>Année</span><input name="year" type="number" inputmode="numeric" value="${esc(d.year ?? "")}"></label>` : ""}
    <div class="grid2">
      <label class="field"><span>Joueurs min</span><input name="min_players" type="number" min="1" inputmode="numeric" value="${esc(d.min_players ?? "")}"></label>
      <label class="field"><span>Joueurs max</span><input name="max_players" type="number" min="1" inputmode="numeric" value="${esc(d.max_players ?? "")}"></label>
      <label class="field"><span>Durée min (min)</span><input name="min_time" type="number" min="1" inputmode="numeric" value="${esc(d.min_time ?? "")}"></label>
      <label class="field"><span>Durée max (min)</span><input name="max_time" type="number" min="1" inputmode="numeric" value="${esc(d.max_time ?? "")}"></label>
    </div>
    ${!d._isExpansion ? `
    <label class="field"><span>Mode par défaut</span><select name="default_mode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${k === d.default_mode ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="field"><span>Règle de score</span><select name="score_rule">${Object.entries(SCORE_RULES).map(([k, v]) => `<option value="${k}" ${k === d.score_rule ? "selected" : ""}>${v}</option>`).join("")}</select></label>` : ""}
    <div class="grid2">
      <label class="field"><span>Statut</span><select name="status" data-action-change="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === d.status ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="field" id="lent-field" ${d.status === "lent" ? "" : "hidden"}><span>Prêté à</span><input name="lent_to" value="${esc(d.lent_to ?? "")}" maxlength="60"></label>
    </div>
    ${d.bgg_id ? `<p class="hint">Difficulté ${d.weight ? fmtNum(d.weight, 1) + "/5" : "—"} · ${d.types?.length ? d.types.map(esc).join(", ") : "type non classé"} · ${d.mechanics?.length || 0} mécaniques — repris de BGG.</p>` : ""}
    <label class="field"><span>Notes</span><textarea name="notes" rows="2" maxlength="1000">${esc(d.notes ?? "")}</textarea></label>
    <p class="form-error" id="form-error" role="alert"></p>
    <div class="form-actions"><a class="btn ghost" href="${back}">Annuler</a><button class="btn primary" type="submit">Enregistrer</button></div>
  </form>`;
}

// ---------- Import de la collection BGG -------------------------------------
function viewImport() {
  if (!isAdmin()) return notFound();
  const im = S.importer || (S.importer = { step: "user", user: localStorage.getItem("nsj-bgg-user") || "", items: [], details: [], progress: "" });
  let body = "";
  if (im.step === "user" || im.step === "loading") {
    body = `<form class="form" data-form="import-user">
      <p class="muted">L'import récupère les jeux marqués « possédés » dans ta collection BoardGameGeek, puis leur fiche détaillée. Tu pourras vérifier la liste avant d'enregistrer.</p>
      <label class="field"><span>Ton pseudo BGG</span><input name="user" value="${esc(im.user)}" required autocapitalize="off" autocomplete="off" data-autofocus></label>
      <p class="hint">${esc(im.progress)}</p>
      <div class="form-actions"><button class="btn primary" type="submit" ${im.step === "loading" ? "disabled" : ""}>${im.step === "loading" ? "Récupération…" : "Récupérer ma collection"}</button></div>
    </form>`;
  } else if (im.step === "pick") {
    const owned = new Set(S.data.games.map((g) => g.bgg_id));
    const fresh = im.items.filter((i) => !owned.has(i.id));
    body = `<p class="pad">${plural(im.items.length, "jeu trouvé", "jeux trouvés")}, dont <strong>${fresh.length}</strong> pas encore dans la ludothèque.</p>
      ${fresh.length ? `<div class="pad row-gap"><button class="btn small ghost" data-action="imp-all" data-v="1">Tout cocher</button><button class="btn small ghost" data-action="imp-all" data-v="0">Tout décocher</button></div>
      <div class="list checks">${fresh.map((i) => `<label class="card check-row"><input type="checkbox" data-imp="${i.id}" ${i.checked !== false ? "checked" : ""}>
        <span>${esc(i.name)}</span>${i.expansion ? `<span class="tag">Extension</span>` : ""}</label>`).join("")}</div>
      <div class="form-actions sticky"><button class="btn ghost" data-action="imp-restart">Changer de pseudo</button><button class="btn primary" data-action="imp-details">Récupérer les fiches</button></div>`
      : `<div class="center"><a class="btn" href="#/games">Retour aux jeux</a></div>`}`;
  } else if (im.step === "details") {
    body = `<div class="empty"><p>Récupération des fiches BGG…</p><p class="muted">${esc(im.progress)}</p></div>`;
  } else if (im.step === "review") {
    body = `<p class="pad">Vérifie le nom affiché de chaque jeu. BGG ne précise pas la langue des noms : le nom français est deviné.</p>
      <div class="list">${im.details.map((d, i) => `<div class="card review">${gameThumb(d, 44)}
        <div class="rv-body"><input value="${esc(d.name)}" data-imp-name="${i}" aria-label="Nom affiché" list="alt-${i}">
        <datalist id="alt-${i}">${(d._names || []).map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        <div class="muted small">${esc(d.bgg_name)}${d.year ? ` · ${d.year}` : ""}${d._isExpansion ? ` · <span class="tag">Extension${d._baseName ? " de " + esc(d._baseName) : " (jeu de base absent : ignorée)"}</span>` : ""}</div></div></div>`).join("")}</div>
      <div class="form-actions sticky"><button class="btn ghost" data-action="imp-restart">Recommencer</button><button class="btn primary" data-action="imp-save">Importer ${plural(im.details.filter((d) => !d._isExpansion || d._baseName).length, "jeu", "jeux")}</button></div>`;
  }
  return header("Importer ma collection", { back: "#/games" }) + body;
}

async function importFetchCollection(user) {
  const im = S.importer;
  im.user = user.trim();
  localStorage.setItem("nsj-bgg-user", im.user);
  im.step = "loading";
  im.progress = "Interrogation de BoardGameGeek…";
  render();
  try {
    for (let attempt = 1; attempt <= 8; attempt++) {
      const res = await S.store.bgg.collection(im.user);
      if (!res.pending) {
        im.items = res.items.map((i) => ({ ...i, checked: true }));
        im.step = "pick";
        im.progress = "";
        return render();
      }
      im.progress = `BGG prépare ta collection (essai ${attempt}/8)… Cela peut prendre une minute la première fois.`;
      render();
      await new Promise((ok) => setTimeout(ok, 5000));
    }
    throw new Error("BGG n'a pas répondu à temps. Réessaie dans quelques minutes.");
  } catch (e) {
    im.step = "user"; im.progress = ""; render(); toast(e.message, "error");
  }
}

async function importFetchDetails() {
  const im = S.importer;
  const ids = im.items.filter((i) => i.checked !== false && !S.data.games.some((g) => g.bgg_id === i.id)).map((i) => i.id);
  if (!ids.length) return toast("Aucun jeu coché.");
  im.step = "details"; im.details = []; render();
  try {
    for (let i = 0; i < ids.length; i += 20) {
      im.progress = `${Math.min(i + 20, ids.length)} / ${ids.length}`;
      const box = $(".empty .muted"); if (box) box.textContent = im.progress;
      const things = await S.store.bgg.things(ids.slice(i, i + 20));
      im.details.push(...things.map(draftFromBgg));
      if (i + 20 < ids.length) await new Promise((ok) => setTimeout(ok, 1200)); // ménage l'API BGG
    }
    // Rattache les extensions : jeu de base déjà présent ou importé en même temps.
    const importedBases = new Map(im.details.filter((d) => !d._isExpansion).map((d) => [d.bgg_id, d]));
    for (const d of im.details.filter((x) => x._isExpansion)) {
      const existing = d.base_game_id ? game(d.base_game_id) : null;
      const viaImport = (d._baseBggIds || []).map((b) => importedBases.get(b)).find(Boolean);
      d._baseName = existing?.name || viaImport?.name || null;
    }
    im.step = "review";
  } catch (e) {
    im.step = "pick"; toast(e.message, "error");
  }
  render();
}

// ---------- Joueurs ------------------------------------------------------
function viewPlayers() {
  const counts = new Map();
  S.data.plays.forEach((p) => p.players.forEach((x) => counts.set(x.player_id, (counts.get(x.player_id) || 0) + 1)));
  const stats = new Map(globalStats(S.data, S.data.plays).leaderboard.map((l) => [l.player.id, l]));
  const row = (p) => {
    const l = stats.get(p.id);
    return `<a class="card player" href="#/players/${p.id}"><span class="avatar" style="background:${esc(p.color)}">${esc(initials(p.name))}</span>
      <div class="gc-body"><strong>${esc(p.name)}</strong>
      <div class="muted small">${plural(counts.get(p.id) || 0, "partie", "parties")}${l?.comp ? ` · ${plural(l.wins, "victoire", "victoires")} · ${fmtPct(l.rate)}` : ""}</div></div></a>`;
  };
  const archived = S.data.players.filter((p) => p.archived);
  return header("Joueurs", { sub: plural(activePlayers().length, "joueur", "joueurs") }) + `
    <div class="list">${activePlayers().map(row).join("") || `<div class="empty"><p class="muted">Aucun joueur.</p></div>`}</div>
    ${archived.length ? `<details class="pad"><summary class="muted">Joueurs archivés (${archived.length})</summary><div class="list">${archived.map(row).join("")}</div></details>` : ""}
    ${fab("#/players/new", "Ajouter un joueur")}`;
}

function viewPlayer(id) {
  const p = player(id);
  if (!p) return header("Joueur", { back: "#/players" }) + `<div class="empty"><p>Ce joueur n'existe plus.</p></div>`;
  const st = playerStats(S.data, p, S.data.plays);
  const account = S.data.profiles.find((x) => x.player_id === p.id);
  const actions = isAdmin() ? `<a class="icon-btn" href="#/players/${p.id}/edit" aria-label="Modifier">${icon("edit")}</a>` : "";
  return header(p.name, { back: "#/players", actions, sub: `${account ? `Compte : ${esc(account.display_name || account.email)}` : "Sans compte"}${p.archived ? " · Archivé" : ""}` }) + `
    <section class="kpis">
      ${kpi("parties", fmtNum(st.plays.length))}
      ${kpi("de jeu", fmtHours(st.minutes))}
      ${kpi("victoires", fmtNum(st.wins), st.comp ? `sur ${st.comp} compétitives` : "")}
      ${kpi("taux de victoire", st.comp ? rate(st.rate, st.comp) : "—")}
    </section>
    ${st.perf != null ? `<section class="panel perf"><div><div class="muted small">Indice de performance</div><strong class="big">${fmtNum(st.perf, 2)}</strong></div>
      <p class="small muted">Victoires obtenues divisées par les victoires attendues au hasard (1 sur le nombre de joueurs). Au-dessus de 1, ${esc(p.name)} gagne plus que prévu.</p></section>` : ""}
    ${st.coop ? `<p class="coopline pad">Coopératif et solo : <strong>${plural(st.coopWins, "réussite", "réussites")}</strong> sur ${st.coop} (${fmtPct(st.coopRate)})</p>` : ""}
    ${st.plays.length ? `<section class="panel"><h2>Parties sur 12 mois</h2>${barChart(st.byMonth.map((m) => ({ label: monthShort(m.ym), value: m.count, tip: `${monthLabel(m.ym)} : ${plural(m.count, "partie", "parties")}` })), { height: 120 })}</section>
    <section class="panel"><h2>Par jeu</h2><table class="tbl"><thead><tr><th>Jeu</th><th class="n">Parties</th><th class="n">Vict.</th><th class="n">Taux</th><th class="n">Meilleur</th></tr></thead>
      <tbody>${st.games.map((l) => `<tr data-href="#/games/${l.game.id}"><td>${esc(l.game.name)}</td><td class="n">${l.plays}</td>
        <td class="n">${l.comp ? l.wins : l.coop ? `${l.coopWins}<span class="muted small">/${l.coop}</span>` : "—"}</td><td class="n">${l.comp ? rate(l.rate, l.comp) : l.coop ? rate(l.coopRate, l.coop) : "—"}</td>
        <td class="n">${fmtScore(l.best)}</td></tr>`).join("")}</tbody></table>
      <p class="foot muted small">En coopératif et solo, les colonnes indiquent les réussites.</p></section>
    <section class="panel"><h2>Dernières parties</h2><div class="list">${st.plays.slice(0, 6).map(playCard).join("")}</div></section>`
    : `<div class="empty"><p class="muted">Aucune partie pour l'instant.</p></div>`}`;
}

function viewPlayerForm(id) {
  if (!isAdmin()) return notFound();
  const p = id ? player(id) : { name: "", color: PLAYER_COLORS[S.data.players.length % PLAYER_COLORS.length], archived: false };
  if (!p) return notFound();
  const used = S.data.plays.some((x) => x.players.some((y) => y.player_id === id));
  return header(id ? "Modifier le joueur" : "Nouveau joueur", { back: id ? `#/players/${id}` : "#/players" }) + `
  <form class="form" data-form="player" data-id="${id || ""}" novalidate>
    <label class="field"><span>Prénom ou surnom</span><input name="name" value="${esc(p.name)}" required maxlength="40" data-autofocus></label>
    <fieldset class="field"><legend>Couleur</legend><div class="swatches">
      ${PLAYER_COLORS.map((c) => `<label class="sw"><input type="radio" name="color" value="${c}" ${c === p.color ? "checked" : ""}><span style="background:${c}"></span></label>`).join("")}
    </div></fieldset>
    ${id ? `<label class="check"><input type="checkbox" name="archived" ${p.archived ? "checked" : ""}> Archivé <span class="muted small">(masqué de la saisie, stats conservées)</span></label>` : ""}
    <p class="form-error" id="form-error" role="alert"></p>
    <div class="form-actions">${id && !used ? `<button type="button" class="btn danger ghost" data-action="delete-player" data-id="${id}">Supprimer</button>` : ""}
      <a class="btn ghost" href="${id ? `#/players/${id}` : "#/players"}">Annuler</a><button class="btn primary" type="submit">Enregistrer</button></div>
  </form>`;
}

// ---------- Plus : compte, comptes, démo, installation ----------------------
function viewMore() {
  const me = S.data.me;
  const players = activePlayers();
  const profiles = [...S.data.profiles].sort((a, b) => (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "", "fr"));
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return header("Plus") + `
    ${S.store.mode === "demo" ? `<section class="panel demo-panel"><h2>Mode démo</h2>
      <p class="small">Les données sont fictives et restent dans ce navigateur. Elles ne sont partagées avec personne.</p>
      <div class="seg"><button class="${me.role === "admin" ? "on" : ""}" data-action="demo-role" data-v="admin">Vue gestionnaire</button><button class="${me.role === "viewer" ? "on" : ""}" data-action="demo-role" data-v="viewer">Vue joueur</button></div>
      <p class="center"><button class="btn small ghost" data-action="demo-reset">Réinitialiser les données de démo</button></p></section>` : ""}
    <section class="panel"><h2>Mon compte</h2>
      <form class="form compact" data-form="myname">
        <label class="field"><span>Nom affiché</span><input name="name" value="${esc(me.display_name || "")}" maxlength="60"></label>
        <p class="small muted">${esc(me.email || "")}${me.email ? " · " : ""}${me.owner ? "Propriétaire · " : ""}${me.role === "admin" ? "Gestionnaire" : "Joueur (consultation)"}${me.player_id && player(me.player_id) ? ` · fiche « ${esc(player(me.player_id).name)} »` : ""}</p>
        <div class="form-actions"><button class="btn small" type="submit">Enregistrer</button></div>
      </form></section>
    ${S.store.mode === "icloud" ? viewICloudAccounts(profiles) : ""}
    ${isAdmin() && S.store.mode !== "icloud" ? `<section class="panel"><h2>Comptes</h2>
      <ul class="accounts">${profiles.map((p) => `<li>
        <div><strong>${esc(p.display_name || p.email)}</strong><div class="muted small">${esc(p.email || "")}</div></div>
        <select data-profile-role="${p.id}" aria-label="Rôle"><option value="admin" ${p.role === "admin" ? "selected" : ""}>Gestionnaire</option><option value="viewer" ${p.role === "viewer" ? "selected" : ""}>Joueur</option></select>
        <select data-profile-player="${p.id}" aria-label="Fiche joueur liée"><option value="">Aucune fiche</option>${S.data.players.map((x) => `<option value="${x.id}" ${x.id === p.player_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      </li>`).join("")}</ul>
      <h3>Inviter quelqu'un</h3>
      <form class="form compact" data-form="invite" novalidate>
        <label class="field"><span>E-mail</span><input name="email" type="email" required autocapitalize="off"></label>
        <div class="grid2">
          <label class="field"><span>Nom affiché</span><input name="display_name" maxlength="60"></label>
          <label class="field"><span>Rôle</span><select name="role"><option value="viewer">Joueur (consultation)</option><option value="admin">Gestionnaire</option></select></label>
        </div>
        <label class="field"><span>Fiche joueur liée</span><select name="player_id"><option value="">Aucune</option>${players.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label>
        <p class="form-error" id="form-error" role="alert"></p>
        <div class="form-actions"><button class="btn primary" type="submit">${icon("mail", 18)} Envoyer l'invitation</button></div>
      </form></section>` : ""}
    ${!standalone && S.store.mode !== "icloud" ? `<section class="panel"><h2>Installer sur l'iPhone</h2>
      <ol class="small steps"><li>Ouvre cette page dans <strong>Safari</strong>.</li><li>Touche le bouton <strong>Partager</strong> ${icon("share", 16)}.</li>
      <li>Choisis <strong>Sur l'écran d'accueil</strong>, puis <strong>Ajouter</strong>.</li></ol></section>` : ""}
    <section class="panel small"><h2>À propos</h2>
      <p>C-Party · version ${VERSION}</p>
      <p class="muted">Données de jeux : <a href="https://boardgamegeek.com" target="_blank" rel="noopener">BoardGameGeek</a>, usage non commercial.</p></section>
    ${S.store.mode === "cloud" ? `<p class="center"><button class="btn ghost" data-action="logout">${icon("logout", 18)} Se déconnecter</button></p>` : ""}`;
}

function viewICloudAccounts(profiles) {
  const me = S.data.me;
  const empty = !S.data.plays.length && !S.data.games.length && !S.data.players.length;
  return `${isAdmin() ? `<section class="panel"><h2>Membres du groupe</h2>
      <ul class="accounts">${profiles.map((p) => `<li>
        <div><strong>${esc(p.display_name)}</strong><div class="muted small">${p.owner ? "Propriétaire" : p.role === "admin" ? "Gestionnaire" : "Joueur"}${p.pending ? " · invitation en attente" : ""}${p.email ? ` · ${esc(p.email)}` : ""}</div></div>
        <select data-profile-player="${p.id}" aria-label="Fiche joueur liée"><option value="">Aucune fiche</option>${S.data.players.map((x) => `<option value="${x.id}" ${x.id === p.player_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      </li>`).join("")}</ul>
      ${me.owner ? `<p class="small muted">Invite les joueurs par Messages ou par e-mail. Choisis « Lecture seule » pour un joueur, « Modifications autorisées » pour un gestionnaire.</p>
      <div class="form-actions"><button class="btn primary" data-action="icloud-share">${icon("share", 18)} Inviter et gérer les droits</button></div>`
      : `<p class="small muted">Seul le propriétaire du groupe peut inviter ou changer les droits.</p>`}</section>` : ""}
    ${me.owner && empty ? `<section class="panel"><h2>Importer les anciennes données</h2>
      <p class="small">Choisis le fichier CSV exporté de Supabase (supabase/export.sql). L'import n'est possible que dans un espace vide.</p>
      <label class="btn block">${icon("download", 18)} Choisir le fichier CSV<input type="file" accept=".csv,text/csv" data-import-csv hidden></label>
      <p class="small muted" id="import-status"></p></section>` : ""}
    <section class="panel"><h2>${me.owner ? "Supprimer le groupe" : "Quitter le groupe"}</h2>
      <p class="small">${me.owner ? "Supprime définitivement l'espace C-Party de ton iCloud : toutes les parties, jeux et joueurs, pour tous les membres." : "Tu n'auras plus accès aux parties de ce groupe. Les données du groupe ne sont pas supprimées."}</p>
      <div class="form-actions"><button class="btn danger ghost" data-action="icloud-leave">${me.owner ? "Supprimer le groupe et ses données" : "Quitter le groupe"}</button></div></section>`;
}

// ---------- Connexion ------------------------------------------------------
function viewLogin() {
  return `<div class="auth"><img src="icons/icon-192.png" alt="" width="84" height="84"><h1>C-Party</h1>
    <form class="form" data-form="login">
      <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="username" required autocapitalize="off"></label>
      <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="current-password" required></label>
      <p class="form-error" id="form-error" role="alert"></p>
      <button class="btn primary block" type="submit">Se connecter</button>
      <p class="center small"><button type="button" class="linkish" data-action="forgot">Mot de passe oublié ?</button></p>
      <p class="center small muted">L'accès se fait sur invitation d'un gestionnaire.</p>
    </form></div>`;
}
function viewSetPassword() {
  return `<div class="auth"><img src="icons/icon-192.png" alt="" width="84" height="84">
    <h1>${S.pendingAuth === "invite" ? "Bienvenue !" : "Nouveau mot de passe"}</h1>
    <form class="form" data-form="setpw">
      <p class="muted">${S.pendingAuth === "invite" ? "Choisis un mot de passe pour activer ton compte." : "Choisis ton nouveau mot de passe."}</p>
      <label class="field"><span>Mot de passe (8 caractères minimum)</span><input name="pw" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="field"><span>Confirmation</span><input name="pw2" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="form-error" id="form-error" role="alert"></p>
      <button class="btn primary block" type="submit">Valider</button>
    </form></div>`;
}

function viewICloudSetup() {
  const st = S.store.status() || {};
  const head = `<div class="auth"><img src="icons/icon-192.png" alt="" width="84" height="84"><h1>C-Party</h1>`;
  if (st.account !== "available") return head + `
    <p class="muted center">C-Party enregistre vos parties dans <strong>iCloud</strong>.</p>
    <ol class="small steps"><li>Ouvre <strong>Réglages</strong> sur ton iPhone.</li><li>Touche ton nom en haut, puis <strong>iCloud</strong>.</li>
      <li>Connecte-toi avec ton identifiant Apple, puis reviens ici.</li></ol>
    <button class="btn primary block" data-action="icloud-retry">Réessayer</button></div>`;
  return head + `
    <p class="muted center">Bienvenue ! Pour commencer :</p>
    <section class="panel"><h2>Tu as reçu une invitation ?</h2>
      <p class="small">Touche le lien reçu par Messages ou par e-mail : C-Party s'ouvrira sur les parties de ton groupe.</p></section>
    <section class="panel"><h2>Tu crées le groupe ?</h2>
      <p class="small">Les données seront rangées dans ton iCloud. Tu pourras ensuite inviter les autres joueurs.</p>
      <button class="btn primary block" data-action="icloud-create">Créer l'espace de mon groupe</button></section>
    <p class="center"><button class="btn small ghost" data-action="icloud-retry">Actualiser</button></p></div>`;
}

// ---------- Actions (clics) -------------------------------------------------
const formError = (msg) => { const el = $("#form-error"); if (el) el.textContent = msg; else toast(msg, "error"); };

const actions = {
  period: (el) => { S.ui.period = el.dataset.v; render(); },
  "game-status": (el) => { S.ui.gameStatus = el.dataset.v; render(); },

  // Formulaire de partie
  "f-mode": (el) => {
    const f = S.form; f.mode = el.dataset.v;
    if (f.mode === "solo" && f.players.length > 1) f.players = f.players.slice(0, 1);
    if (f.mode === "teams") f.players.forEach((x, i) => { if (!f.teams.some((t) => t.name === x.team)) x.team = f.teams[i % f.teams.length].name; });
    render();
  },
  "f-result": (el) => { S.form.coop_result = el.dataset.v; render(); },
  "f-exp": (el) => {
    const f = S.form, id = el.dataset.id;
    f.expansions = f.expansions.includes(id) ? f.expansions.filter((x) => x !== id) : [...f.expansions, id];
    el.classList.toggle("on");
  },
  "f-player": (el) => {
    const f = S.form, id = el.dataset.id;
    if (f.players.some((x) => x.player_id === id)) f.players = f.players.filter((x) => x.player_id !== id);
    else {
      if (f.mode === "solo") f.players = [];
      const counts = f.teams.map((t) => f.players.filter((x) => x.team === t.name).length);
      f.players.push({ player_id: id, score: "", rank: "", team: f.teams[counts.indexOf(Math.min(...counts))].name });
    }
    render();
  },
  "f-newplayer": () => { const b = $("#newplayer"); b.hidden = !b.hidden; if (!b.hidden) $("#np-name").focus(); },
  "f-newplayer-save": async () => {
    const name = $("#np-name").value.trim();
    if (!name) return;
    try {
      const p = await S.store.savePlayer({ name, color: PLAYER_COLORS[S.data.players.length % PLAYER_COLORS.length], archived: false });
      S.data.players.push(p);
      actions["f-player"]({ dataset: { id: p.id } });
      toast(`${name} ajouté`);
    } catch (e) { toast(e.message, "error"); }
  },
  "f-team-add": () => { const f = S.form; let n = f.teams.length + 1; while (f.teams.some((t) => t.name === `Équipe ${n}`)) n++; f.teams.push({ name: `Équipe ${n}`, score: "", rank: "" }); render(); },
  "f-team-del": (el) => {
    const f = S.form, t = f.teams[Number(el.dataset.i)];
    f.teams.splice(Number(el.dataset.i), 1);
    f.players.forEach((x) => { if (x.team === t.name) x.team = f.teams[0].name; });
    render();
  },
  "f-auto": () => { S.form.manual = false; refreshRanks(); },

  "delete-play": async (el) => {
    if (!(await confirmDialog("Supprimer cette partie ? Elle restera dans le journal des suppressions et pourra être restaurée.", "Supprimer"))) return;
    try { await S.store.deletePlay(el.dataset.id); toast("Partie supprimée"); await reload(); go("#/plays"); } catch (e) { toast(e.message, "error"); }
  },
  "restore-play": async (el) => {
    try { const id = await S.store.restorePlay(Number(el.dataset.id)); toast("Partie restaurée"); await reload(); go(`#/plays/${id}`); } catch (e) { toast(e.message, "error"); }
  },

  // Jeux
  "bgg-pick": async (el) => {
    el.disabled = true;
    try {
      const [t] = await S.store.bgg.things([Number(el.dataset.id)]);
      if (!t) throw new Error("Fiche introuvable sur BGG");
      S.gameDraft = draftFromBgg(t);
      go("#/games/draft/edit");
    } catch (e) { el.disabled = false; toast(e.message, "error"); }
  },
  "game-manual": () => {
    const q = $("#bgg-q")?.value.trim() || "";
    S.gameDraft = { id: null, name: q, bgg_id: null, bgg_name: null, types: [], categories: [], mechanics: [], designers: [], status: "owned", default_mode: "competitive", score_rule: "high", base_game_id: null, _isExpansion: false };
    go("#/games/draft/edit");
  },
  "delete-game": async (el) => {
    const g = game(el.dataset.id);
    const n = S.data.plays.filter((p) => p.game_id === g.id).length;
    const ex = expansionsOf(g.id).length;
    const msg = `Supprimer « ${g.name} » ?${ex ? ` Ses ${ex} extension(s) seront aussi supprimées.` : ""}${n ? ` Ses ${n} partie(s) seront supprimées (restaurables tant que le jeu existe : réimporte-le d'abord).` : ""}`;
    if (!(await confirmDialog(msg, "Supprimer"))) return;
    try { await S.store.deleteGame(g.id); toast("Jeu supprimé"); await reload(); go("#/games"); } catch (e) { toast(e.message, "error"); }
  },

  // Import
  "imp-all": (el) => { S.importer.items.forEach((i) => (i.checked = el.dataset.v === "1")); render(); },
  "imp-restart": () => { S.importer = null; render(); },
  "imp-details": () => importFetchDetails(),
  "imp-save": async (el) => {
    const im = S.importer;
    el.disabled = true;
    try {
      const bases = im.details.filter((d) => !d._isExpansion);
      const clean = (d) => { const o = { ...d }; Object.keys(o).filter((k) => k.startsWith("_")).forEach((k) => delete o[k]); delete o.id; return o; };
      const saved = bases.length ? await S.store.saveGames(bases.map((d) => ({ ...clean(d), base_game_id: null }))) : [];
      const byBgg = new Map([...S.data.games, ...saved].filter((g) => !g.base_game_id).map((g) => [g.bgg_id, g.id]));
      const exps = im.details.filter((d) => d._isExpansion).map((d) => {
        const baseId = d.base_game_id || (d._baseBggIds || []).map((b) => byBgg.get(b)).find(Boolean);
        return baseId ? { ...clean(d), base_game_id: baseId } : null;
      }).filter(Boolean);
      if (exps.length) await S.store.saveGames(exps);
      toast(`${plural(saved.length + exps.length, "jeu importé", "jeux importés")}`);
      S.importer = null;
      await reload();
      go("#/games");
    } catch (e) { el.disabled = false; toast(e.message, "error"); }
  },

  "delete-player": async (el) => {
    if (!(await confirmDialog("Supprimer ce joueur ?", "Supprimer"))) return;
    try { await S.store.deletePlayer(el.dataset.id); toast("Joueur supprimé"); await reload(); go("#/players"); } catch (e) { toast(e.message, "error"); }
  },

  "demo-role": (el) => { S.store.setViewAs(el.dataset.v); reload(); },
  "demo-reset": async () => {
    if (!(await confirmDialog("Remettre les données de démo à zéro ?", "Réinitialiser"))) return;
    S.store.reset(); await reload(); go("#/");
  },
  "icloud-retry": async () => {
    try { const st = await S.store.refreshStatus(); if (st.space) await reload(); else render(); } catch (e) { toast(e.message, "error"); }
  },
  "icloud-create": async (el) => {
    el.disabled = true;
    try { await S.store.createSpace(); await reload(); toast("Espace créé"); go("#/more"); } catch (e) { el.disabled = false; toast(e.message, "error"); }
  },
  "icloud-share": async () => { try { await S.store.manageSharing(); } catch (e) { toast(e.message, "error"); } },
  "icloud-leave": async () => {
    const owner = S.data.me.owner;
    const ok = await confirmDialog(owner
      ? "Supprimer le groupe ? Toutes les parties, jeux et joueurs seront effacés de ton iCloud, pour tous les membres. C'est définitif."
      : "Quitter le groupe ? Tu pourras revenir seulement avec une nouvelle invitation.",
      owner ? "Supprimer définitivement" : "Quitter");
    if (!ok) return;
    try { await S.store.leaveSpace(); S.data = null; go("#/"); render(); toast(owner ? "Groupe supprimé" : "Tu as quitté le groupe"); } catch (e) { toast(e.message, "error"); }
  },
  logout: async () => { await S.store.signOut(); S.data = null; render(); },
  forgot: async () => {
    const email = $("[name=email]").value.trim();
    if (!email) return formError("Saisis d'abord ton e-mail.");
    try { await S.store.resetPassword(email); toast("E-mail de réinitialisation envoyé"); } catch (e) { formError(e.message); }
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (el && actions[el.dataset.action]) { e.preventDefault(); actions[el.dataset.action](el, e); return; }
  const row = e.target.closest("tr[data-href]");
  if (row && !e.target.closest("a")) go(row.dataset.href);
});

// ---------- Saisies (input / change) ----------------------------------------
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.input) {
    S.ui[t.dataset.input] = t.value;
    const pos = t.selectionStart;
    render();
    const again = $(`[data-input="${t.dataset.input}"]`);
    if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch { /* type search */ } }
    return;
  }
  if (t.id === "bgg-q") return searchBgg(t.value);
  const f = S.form;
  if (!f) return;
  if (t.dataset.f && t.type !== "checkbox" && t.tagName !== "SELECT") f[t.dataset.f] = t.value;
  if (t.dataset.fScore) { const x = f.players.find((y) => y.player_id === t.dataset.fScore); if (x) x.score = t.value; refreshRanks(); }
  if (t.dataset.fRank) { const x = f.players.find((y) => y.player_id === t.dataset.fRank); if (x) { x.rank = t.value; f.manual = true; } refreshRanks(); }
  if (t.dataset.fTeamscore) { f.teams[Number(t.dataset.fTeamscore)].score = t.value; refreshRanks(); }
  if (t.dataset.fTeamrank) { f.teams[Number(t.dataset.fTeamrank)].rank = t.value; f.manual = true; refreshRanks(); }
  if (t.dataset.impName) S.importer.details[Number(t.dataset.impName)].name = t.value;
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.imp) { const it = S.importer.items.find((i) => String(i.id) === t.dataset.imp); if (it) it.checked = t.checked; return; }
  if (t.dataset.actionChange === "status") { $("#lent-field").hidden = t.value !== "lent"; return; }
  if ("importCsv" in t.dataset && t.files?.[0]) {
    const out = $("#import-status");
    try {
      const { tablesFromExport } = await import("./store-icloud.js");
      const tables = tablesFromExport(await t.files[0].text());
      const n = (k) => (tables[k] || []).length;
      if (!(await confirmDialog(`Importer ${plural(n("plays"), "partie", "parties")}, ${plural(n("games"), "jeu", "jeux")} et ${plural(n("players"), "joueur", "joueurs")} dans iCloud ?`, "Importer"))) { t.value = ""; return; }
      if (out) out.textContent = "Import en cours… ne ferme pas l'app.";
      const r = await S.store.importExport(tables);
      toast(`Import terminé : ${plural(r.plays, "partie", "parties")}`);
      await reload();
    } catch (err) { if (out) out.textContent = ""; toast(err.message, "error"); }
    t.value = "";
    return;
  }
  if (t.dataset.profileRole || t.dataset.profilePlayer) {
    const id = t.dataset.profileRole || t.dataset.profilePlayer;
    const patch = t.dataset.profileRole ? { role: t.value } : { player_id: t.value || null };
    try { await S.store.updateProfile(id, patch); toast("Compte mis à jour"); await reload(); } catch (err) { toast(err.message, "error"); await reload(); }
    return;
  }
  const f = S.form;
  if (!f) return;
  if (t.dataset.f === "game_id") {
    const g = game(t.value);
    f.game_id = t.value; f.expansions = [];
    if (g) { f.mode = g.default_mode; if (f.mode === "solo" && f.players.length > 1) f.players = f.players.slice(0, 1); }
    f.manual = false;
    render(); return;
  }
  if (t.dataset.f === "is_learning") { f.is_learning = t.checked; return; }
  if (t.dataset.fTeam) { const x = f.players.find((y) => y.player_id === t.dataset.fTeam); if (x) x.team = t.value; return; }
  if (t.dataset.fTeamname) {
    const i = Number(t.dataset.fTeamname), old = f.teams[i].name, name = t.value.trim() || old;
    f.teams[i].name = name; f.players.forEach((x) => { if (x.team === old) x.team = name; }); render();
  }
});

// ---------- Envois de formulaires --------------------------------------------
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const fd = Object.fromEntries(new FormData(form));
  const btn = form.querySelector("[type=submit]");
  const busy = (on) => { if (btn) btn.disabled = on; };
  busy(true);
  try {
    if (kind === "play") {
      const payload = buildPlayPayload();
      const id = await S.store.savePlay(payload);
      S.form = null;
      toast("Partie enregistrée");
      await reload();
      go(`#/plays/${id || payload.id}`);
    } else if (kind === "game") {
      const d = S.gameDraft;
      const int = (v) => (v === "" || v == null ? null : parseInt(v, 10));
      if (!fd.name?.trim()) throw new Error("Le nom est obligatoire.");
      if (d._isExpansion && !fd.base_game_id) throw new Error("Choisis le jeu de base de cette extension.");
      const g = {
        ...Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("_"))),
        name: fd.name.trim(), min_players: int(fd.min_players), max_players: int(fd.max_players),
        min_time: int(fd.min_time), max_time: int(fd.max_time), status: fd.status,
        lent_to: fd.status === "lent" ? (fd.lent_to || "").trim() || null : null, notes: (fd.notes || "").trim() || null,
      };
      if (!d.bgg_id) g.year = int(fd.year);
      if (d._isExpansion) { g.base_game_id = fd.base_game_id; } else { g.default_mode = fd.default_mode; g.score_rule = fd.score_rule; }
      if (g.min_players && g.max_players && g.min_players > g.max_players) throw new Error("Le nombre de joueurs minimum dépasse le maximum.");
      const saved = await S.store.saveGame(g);
      S.gameDraft = null;
      toast("Jeu enregistré");
      await reload();
      go(`#/games/${saved.id}`);
    } else if (kind === "player") {
      const id = form.dataset.id || null;
      if (!fd.name?.trim()) throw new Error("Le nom est obligatoire.");
      const saved = await S.store.savePlayer({ ...(id ? { id } : {}), name: fd.name.trim(), color: fd.color || PLAYER_COLORS[0], archived: !!fd.archived });
      toast("Joueur enregistré");
      await reload();
      go(`#/players/${saved.id}`);
    } else if (kind === "import-user") {
      if (!fd.user?.trim()) throw new Error("Indique ton pseudo BGG.");
      await importFetchCollection(fd.user);
    } else if (kind === "myname") {
      await S.store.updateMyName((fd.name || "").trim());
      toast("Nom mis à jour");
      await reload();
    } else if (kind === "invite") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fd.email || "")) throw new Error("Adresse e-mail invalide.");
      await S.store.invite({ email: fd.email.trim(), display_name: (fd.display_name || "").trim(), role: fd.role, player_id: fd.player_id || null });
      toast(S.store.mode === "demo" ? "Mode démo : compte ajouté (aucun e-mail envoyé)" : `Invitation envoyée à ${fd.email}`);
      await reload();
    } else if (kind === "login") {
      await S.store.signIn(fd.email.trim(), fd.password);
      await reload();
    } else if (kind === "setpw") {
      if ((fd.pw || "").length < 8) throw new Error("8 caractères minimum.");
      if (fd.pw !== fd.pw2) throw new Error("Les deux mots de passe ne correspondent pas.");
      await S.store.setPassword(fd.pw);
      S.pendingAuth = null;
      toast("Mot de passe enregistré");
      history.replaceState(null, "", location.pathname + "#/");
      await reload();
    }
  } catch (err) {
    formError(err.message);
  } finally {
    busy(false);
  }
});

// ---------- Info-bulles des graphiques ------------------------------------
const tip = document.getElementById("tip");
document.addEventListener("pointerover", (e) => {
  const g = e.target.closest("[data-tip]");
  if (!g) { tip.hidden = true; return; }
  tip.textContent = g.dataset.tip;
  tip.hidden = false;
  const r = g.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${r.top + window.scrollY - tip.offsetHeight - 6}px`;
});
document.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

// ---------- PWA ------------------------------------------------------------
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
