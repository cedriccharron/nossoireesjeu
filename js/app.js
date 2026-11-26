// NosSoireesJeu — application principale (navigation, écrans, formulaires).
import { CONFIG } from "./config.js";
import { createDemoStore } from "./store-demo.js";
import { icon } from "./icons.js";
import {
  esc, uuid, today, fmtDate, fmtShort, fmtDateTime, monthLabel, monthShort, fmtNum, fmtPct, fmtHours, fmtScore,
  plural, debounce, initials, toast, confirmDialog, preparePhoto, prepareCover, guessFrenchName, PLAYER_COLORS, MODES, STATUS, SCORE_RULES,
} from "./util.js";
import {
  globalStats, gameStats, playerStats, filterPlays, PERIODS, autoRanks, isComp, MIN_SAMPLE, monthsBack,
  eloForGame, headToHead, nemesis, favouriteVictim, ELO_START, myStats,
} from "./stats.js";

const VERSION = "1.3.0 (groupes)";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const S = {
  store: null,
  data: null,
  ui: { period: "all", gameQuery: "", gameStatus: "all", playQuery: "", lbSort: "wins", nbPlayers: 0, gameSort: "name", statPlayers: 0, statKind: "" },
  form: null,       // brouillon de partie en cours
  gameDraft: null,  // brouillon de jeu (ajout / modification)
  importer: null,   // état de l'import de collection
  groups: null,     // liste de mes groupes (écran Groupes)
  cross: null,      // données de tous mes groupes (vue « Moi », copie de jeux)
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
  } else if (!forceDemo && CONFIG.WEB_SUPABASE && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
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
    S.webOnly = !native; // site web : simple vitrine, les vraies données sont dans l'app iPhone
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
    lastRefresh = Date.now();
  } catch (e) {
    toast(e.message, "error");
  }
  render();
}

// Actualisation discrète (iCloud) : au retour dans l'app et à l'ouverture de Plus, pour voir
// les invités qui viennent d'accepter, les parties saisies par un autre gestionnaire, etc.
let lastRefresh = Date.now(), refreshing = false;
async function quietRefresh(minGap = 5000) {
  if (S.store?.mode !== "icloud" || !S.data || refreshing || Date.now() - lastRefresh < minGap) return;
  refreshing = true;
  try {
    const data = await S.store.loadAll();
    lastRefresh = Date.now();
    const { parts } = route();
    const viewer = $("#viewer");
    const busy = parts[2] === "edit" || parts[1] === "new" || parts[1] === "draft" || (viewer && !viewer.hidden)
      || document.activeElement?.matches?.("input, textarea, select"); // ne pas effacer une saisie en cours
    if (JSON.stringify(data) === JSON.stringify(S.data)) return;
    S.data = data;
    if (!busy) { const y = window.scrollY; render(); window.scrollTo(0, y); }
  } catch { /* hors ligne : on garde l'affichage */ }
  finally { refreshing = false; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") quietRefresh(); });

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
    else if (a === "ranking") html = viewRanking();
    else if (a === "groups" && b === "new") html = viewGroupNew();
    else if (a === "groups") html = viewGroups();
    else if (a === "me") html = viewMe();
    else if (a === "plays" && b === "new") html = viewPlayForm(null, query);
    else if (a === "plays" && b === "deleted") html = viewDeletedPlays();
    else if (a === "plays" && b && c === "edit") html = viewPlayForm(b, query);
    else if (a === "plays" && b) html = viewPlay(b);
    else if (a === "plays") html = viewPlays();
    else if (a === "games" && b === "new") html = viewGameAdd(query);
    else if (a === "games" && b === "copy") html = viewGameCopy();
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
  if (a === "more") quietRefresh();
  if (a === "plays" && (b === "new" || c === "edit")) refreshRanks();
  if (a === "plays" && b && b !== "new" && b !== "deleted" && !c) { loadHistory(b); loadPhotos(b); }
  if (a === "plays" && b === "deleted") loadDeleted();
  if (a === "groups" && !b) loadGroups();
  if (a === "me" || (a === "games" && b === "copy")) loadCross();
  const focus = $("[data-autofocus]");
  if (focus && !matchMedia("(hover: none)").matches) focus.focus();
}

const notFound = () => `<div class="empty"><p>Page introuvable.</p><a class="btn" href="#/">Retour à l'accueil</a></div>`;

// ---------- Composants communs -----------------------------------------
function header(title, { back, actions = "", sub = "", above = "" } = {}) {
  return `<header class="top">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Retour">${icon("back", 22)}</a>` : ""}
    <div class="top-title">${above ? `<p class="sub-above">${above}</p>` : ""}<h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>
    <div class="top-actions">${actions}</div>
  </header>`;
}

function gameThumb(g, size = 48) {
  if (!g) return `<div class="thumb" style="width:${size}px;height:${size}px"></div>`;
  const src = g.cover || g.thumbnail_url || g.image_url; // pochette choisie par le groupe, sinon BGG
  return src
    ? `<img class="thumb" src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="thumb ph" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.8)}px">${esc(initials(g.name))}</div>`;
}

// Avatar rond à initiales, dans la couleur du joueur (style A).
const dot = (p, size) => `<span class="av" style="background:${esc(p?.color || "#8a8a8e")}${size ? `;--s:${size}px` : ""}" aria-hidden="true">${esc(initials(p?.name || "?"))}</span>`;
const pname = (id) => esc(player(id)?.name || "Joueur supprimé");

function periodChips() {
  return `<div class="chips" role="group" aria-label="Période">${Object.entries(PERIODS).map(([k, v]) =>
    `<button class="chip ${S.ui.period === k ? "on" : ""}" data-action="period" data-v="${k}">${v}</button>`).join("")}</div>`;
}

const ELO_EXPLAIN = `<p>Le classement <strong>Elo</strong> est celui des échecs : il mesure le niveau de chacun à ce jeu en tenant compte des adversaires.</p>
  <ul><li>Tout le monde démarre à <strong>${ELO_START}</strong> points.</li>
  <li>Après chaque partie, on compare chaque joueur à chacun de ses adversaires : finir devant rapporte des points, finir derrière en coûte.</li>
  <li>Battre un joueur mieux classé rapporte beaucoup ; battre un joueur moins bien classé rapporte peu. Perdre contre plus fort coûte peu.</li>
  <li>En équipes, chaque équipe compte pour la moyenne de ses joueurs, et tous ses membres gagnent ou perdent les mêmes points.</li></ul>
  <p>Exemple : Léa (1150) et Sam (950) jouent en duel. Si Sam gagne, il prend environ 24 points à Léa ; si c'est Léa, elle n'en prend qu'environ 8, car elle était favorite.</p>
  <p class="muted">Les parties d'apprentissage et coopératives ne comptent pas. Valeurs grisées : moins de ${MIN_SAMPLE} parties, niveau encore peu fiable.</p>`;
// Encadré « C'est quoi ? » repliable, pour expliquer un indicateur directement dans l'app.
const explain = (html, label = "C'est quoi ?") => `<details class="explain"><summary>${label}</summary><div class="small">${html}</div></details>`;
const fmtDuration = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}` : `${m} min`);
const fmt2 = (x) => x.toFixed(2).replace(".", ","); // indice : toujours 2 décimales
const signed = (v) => `${v >= 0 ? "+" : "−"}${fmtNum(Math.abs(Math.round(v)))}`;

// Filtres de l'accueil : nombre de joueurs + type / mécanique (données BGG des jeux joués).
function statFilters() {
  const played = new Set(S.data.plays.map((p) => p.game_id));
  const gs = S.data.games.filter((g) => played.has(g.id));
  const types = [...new Set(gs.flatMap((g) => g.types || []))].sort((a, b) => a.localeCompare(b, "fr"));
  const mechs = [...new Set(gs.flatMap((g) => g.mechanics || []))].sort((a, b) => a.localeCompare(b, "fr"));
  return `<div class="stat-filters">
    <div class="seg">${[0, 2, 3, 4, 5].map((k) => `<button type="button" class="${S.ui.statPlayers === k ? "on" : ""}" data-action="stat-players" data-v="${k}">${k === 0 ? "Tous" : k === 5 ? "5 +" : `${k} j.`}</button>`).join("")}</div>
    ${types.length || mechs.length ? `<select data-stat-kind aria-label="Type ou mécanique de jeu">
      <option value="">Tous les jeux</option>
      ${types.length ? `<optgroup label="Type">${types.map((t) => `<option value="t:${esc(t)}" ${S.ui.statKind === `t:${t}` ? "selected" : ""}>${esc(t)}</option>`).join("")}</optgroup>` : ""}
      ${mechs.length ? `<optgroup label="Mécanique (BGG)">${mechs.map((m) => `<option value="m:${esc(m)}" ${S.ui.statKind === `m:${m}` ? "selected" : ""}>${esc(m)}</option>`).join("")}</optgroup>` : ""}
    </select>` : ""}</div>`;
}

function kpi(label, value, note = "") {
  return `<div class="kpi"><div class="kpi-v">${value}</div><div class="kpi-l">${label}</div>${note ? `<div class="kpi-n">${note}</div>` : ""}</div>`;
}

// Diagramme en barres (une série), en HTML pour garder un texte net ; info-bulle au survol / toucher.
function barChart(rows, { label = (r) => r.label, height = 150 } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const top = rows.reduce((m, r, i) => (r.value > rows[m].value ? i : m), 0);
  return `<div class="bars" style="--h:${height}px" role="img" aria-label="${esc(rows.map((r) => r.tip).join(" ; "))}">
    ${rows.map((r, i) => `<div class="bcol ${r.cur ? "cur" : ""}" data-tip="${esc(r.tip)}">
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

// Classement : tri au choix. Pour le taux, les joueurs sous MIN_SAMPLE parties compétitives passent en bas.
function sortLeaderboard(list) {
  const by = {
    plays: (a, b) => (b.plays - a.plays) || (b.wins - a.wins),
    wins: (a, b) => (b.wins - a.wins) || ((b.rate ?? -1) - (a.rate ?? -1)) || (b.plays - a.plays),
    rate: (a, b) => ((a.comp < MIN_SAMPLE) - (b.comp < MIN_SAMPLE)) || ((b.rate ?? -1) - (a.rate ?? -1)) || (b.comp - a.comp),
    perf: (a, b) => ((a.comp < MIN_SAMPLE) - (b.comp < MIN_SAMPLE)) || ((b.perf ?? -1) - (a.perf ?? -1)) || (b.comp - a.comp),
  }[S.ui.lbSort] || (() => 0);
  return [...list].sort(by);
}
function perfCell(x, n) {
  if (x == null) return "—";
  return `<span class="${n < MIN_SAMPLE ? "thin" : x >= 1 ? "good" : ""}">${fmt2(x)}</span>`;
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
      <div class="pc-meta muted small">${plural(p.players.length, "joueur", "joueurs")}${p.mode !== "competitive" ? ` · ${MODES[p.mode]}` : ""}${p.is_learning ? ` · <span class="tag">Apprentissage</span>` : ""}${p.photo_count ? ` · ${icon("camera", 13)} ${p.photo_count}` : ""}</div>
    </div></a>`;
}

// Style A : plus de bouton flottant, un « + » dans l'en-tête comme sur iOS.
const fab = () => "";
const addBtn = (href, label) => isAdmin() ? `<a class="icon-btn add" href="${href}" aria-label="${esc(label)}">${icon("plus", 24)}</a>` : "";

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
    return { label: monthShort(ym), value: n, cur: ym === new Date().toISOString().slice(0, 7), tip: `${monthLabel(ym)} : ${plural(n, "partie", "parties")}` };
  });
}

// Sur le site web : les vraies parties sont désormais dans l'app iPhone.
const appNotice = () => S.webOnly ? `<section class="panel demo-panel"><h2>C-Party est une app iPhone</h2>
  <p class="small">Vos vraies parties sont désormais dans l'app <strong>C-Party</strong>, enregistrées dans iCloud. Ce site n'est plus qu'une démo avec des données fictives.</p>
  <p class="small">Pour rejoindre ton groupe : installe <strong>TestFlight</strong> depuis l'App Store, ouvre l'invitation C-Party reçue, puis touche le lien de partage envoyé par ton gestionnaire.</p></section>` : "";

// Filtres de statistiques (accueil et classement) : une pastille qui résume, un panneau qui s'ouvre.
function filterSummary() {
  const parts = [PERIODS[S.ui.period] || "Tout"];
  if (S.ui.statPlayers) parts.push(S.ui.statPlayers === 5 ? "5 joueurs et +" : `${S.ui.statPlayers} joueurs`);
  parts.push(S.ui.statKind ? S.ui.statKind.slice(2) : "tous les jeux");
  return parts.join(" · ");
}
function filterBar() {
  const on = S.ui.period !== "all" || S.ui.statPlayers || S.ui.statKind;
  return `<button class="filter-pill ${on ? "on" : ""}" data-action="filters" aria-expanded="${!!S.ui.filtersOpen}">${icon("filter", 15)} ${esc(filterSummary())}</button>
    ${S.ui.filtersOpen ? `<div class="filter-box">${periodChips()}${statFilters()}
      <div class="form-actions">${on ? `<button class="btn small ghost" data-action="filters-reset">Tout afficher</button>` : ""}<button class="btn small primary" data-action="filters">OK</button></div></div>` : ""}`;
}
const filteredPlays = () => filterPlays(S.data.plays, { period: S.ui.period, nbPlayers: S.ui.statPlayers, kind: S.ui.statKind, games: S.data.games });
const sinceLabel = (d) => {
  const days = Math.round((new Date(new Date().toISOString().slice(0, 10)) - new Date(d)) / 86400000);
  return days <= 0 ? "aujourd'hui" : days === 1 ? "hier" : days < 7 ? `il y a ${days} jours` : fmtDate(d);
};

function viewHome() {
  const plays = filteredPlays();
  const st = globalStats(S.data, plays);
  if (!S.data.plays.length) {
    return header("").replace("<h1></h1>", `<h1>${groupTitleBtn()}</h1>`) + groupPrompts() + `<div class="empty">
      <p><strong>Aucune partie pour l'instant.</strong></p>
      ${isAdmin() ? `<p class="muted">Commence par ajouter tes jeux, puis enregistre une première partie.</p>
        <div class="row-gap">${S.store.mode !== "cloud" ? `<a class="btn" href="#/games/copy">Copier des jeux d'un autre groupe</a>` : ""}<a class="btn" href="#/games/import">Importer ma collection BGG</a>
        <a class="btn" href="#/players/new">Ajouter des joueurs</a><a class="btn primary" href="#/plays/new">Nouvelle partie</a></div>`
        : `<p class="muted">Les parties apparaîtront ici dès qu'un gestionnaire les aura saisies.</p>`}
    </div>` + fab("#/plays/new", "Nouvelle partie");
  }
  const myPlayer = S.data.me.player_id && player(S.data.me.player_id);
  const all = playsSorted();
  const last = all[0], lastGame = game(last.game_id);
  const top = sortLeaderboard(st.leaderboard).slice(0, 3);
  const meBtn = `<a href="#/me" aria-label="Moi, tous mes groupes">${myPlayer ? dot(myPlayer, 36).replace('class="av"', 'class="av me-av"') : `<span class="av me-av" style="background:var(--muted)">${icon("person", 18)}</span>`}</a>`;
  const covers = st.topGames.slice(0, 10);
  return header("", { above: myPlayer ? `Bonjour ${esc(myPlayer.name)}` : "", actions: meBtn }).replace("<h1></h1>", `<h1>${groupTitleBtn()}</h1>`) + appNotice() + groupPrompts() + `
    ${filterBar()}
    <a class="last-play" href="#/plays/${last.id}">${gameThumb(lastGame, 56)}
      <div class="lp-body"><div class="lp-k">Dernière partie · ${sinceLabel(last.played_at)}</div>
        <strong>${esc(lastGame?.name || "Jeu supprimé")}</strong>
        <div class="small">${playResultLine(last)} <span class="muted">· ${plural(last.players.length, "joueur", "joueurs")}</span></div></div></a>
    <div class="quick">${isAdmin() ? `<a class="primary" href="#/plays/new">${icon("plus", 18)} Nouvelle partie</a>` : ""}<a href="#/games">${icon("dice", 18)} Que jouer ?</a></div>
    <section class="kpis">
      ${kpi("parties", fmtNum(st.count), st.learning ? `dont ${st.learning} d'apprentissage` : "")}
      ${kpi("de jeu", fmtHours(st.minutes))}
      ${kpi("jeux joués", fmtNum(st.gamesPlayed))}
      ${kpi("joueurs", fmtNum(st.playersActive))}
    </section>
    <div class="sec-h"><h2>En forme</h2><a href="#/ranking">Classement ›</a></div>
    ${top.length ? `<div class="list">${top.map((l, i) => `<a class="card" href="#/players/${l.player.id}"><span class="rk">${i + 1}</span>${dot(l.player, 30)}
      <span style="flex:1;min-width:0" class="${i === 0 ? "strong" : ""}">${esc(l.player.name)}</span>
      <span class="muted small">${l.comp ? `${l.wins} vict. · ${rate(l.rate, l.comp)}` : plural(l.plays, "partie", "parties")}</span></a>`).join("")}</div>`
      : `<p class="pad muted small">Aucune partie compétitive sur cette période.</p>`}
    ${st.coop.plays ? `<p class="pad small muted" style="margin-top:8px">Coopératif et solo : ${plural(st.coop.wins, "réussite", "réussites")} sur ${st.coop.plays} (${fmtPct(st.coop.wins / st.coop.plays)})</p>` : ""}
    <div class="sec-h"><h2>Activité</h2><span class="muted small">${esc(PERIODS[S.ui.period] === "Tout" ? "12 derniers mois" : PERIODS[S.ui.period])}</span></div>
    <section class="panel">${barChart(monthRows(plays, S.ui.period), { height: 96 })}</section>
    ${covers.length ? `<div class="sec-h"><h2>Jeux les plus joués</h2><a href="#/games">Tout ›</a></div>
      <div class="covers">${covers.map((t) => `<a href="#/games/${t.game.id}">${gameThumb(t.game, 96)}
        <div class="cv-n">${esc(t.game.name)}</div><div class="cv-c">${plural(t.count, "partie", "parties")}</div></a>`).join("")}</div>` : ""}
    <div class="sec-h"><h2>Dernières parties</h2><a href="#/plays">Tout ›</a></div>
    <div class="list">${all.slice(0, 5).map(playCard).join("")}</div>`;
}

// Classement complet (ancien tableau de l'accueil), avec tris et explications.
function viewRanking() {
  const st = globalStats(S.data, filteredPlays());
  return header("Classement", { back: "#/" }) + `
    ${filterBar()}
    <section class="panel">
      ${st.leaderboard.length ? `<table class="tbl">
        <thead><tr><th>Joueur</th>${[["plays", "Parties"], ["wins", "Vict."], ["rate", "Taux"], ["perf", "Indice"]].map(([k, v]) =>
          `<th class="n"><button class="th-sort ${S.ui.lbSort === k ? "on" : ""}" data-action="lb-sort" data-v="${k}" aria-label="Classer par ${v.toLowerCase()}">${v}${S.ui.lbSort === k ? " ▾" : ""}</button></th>`).join("")}</tr></thead>
        <tbody>${sortLeaderboard(st.leaderboard).map((l, i) => `<tr data-href="#/players/${l.player.id}">
          <td><span class="rk">${i + 1}</span>${dot(l.player)}${esc(l.player.name)}</td>
          <td class="n">${l.plays}</td><td class="n">${l.wins}</td><td class="n">${rate(l.rate, l.comp)}</td><td class="n">${perfCell(l.perf, l.comp)}</td></tr>`).join("")}
        </tbody></table>
        <p class="foot muted small">Victoires, taux et indice portent sur les parties compétitives et par équipes, hors apprentissage. Touche un titre de colonne pour trier.</p>
        ${explain(`<p><strong>Taux</strong> : la part des parties compétitives gagnées.</p>
          <p><strong>Indice de performance</strong> : il corrige le taux selon le nombre de joueurs. À 4 joueurs, chacun a « normalement » 1 chance sur 4 de gagner ; à 2 joueurs, 1 sur 2. L'indice compare les victoires réelles à ce hasard :</p>
          <ul><li><strong>1,0</strong> : gagne autant que le hasard le prévoit ;</li><li><strong>au-dessus de 1</strong> : gagne plus souvent que prévu (1,5 = 50 % de victoires en plus) ;</li><li><strong>en dessous de 1</strong> : gagne moins souvent que prévu.</li></ul>
          <p>Exemple : 4 victoires en 12 parties à 5 joueurs donnent un taux de 33 %, qui paraît moyen. Mais le hasard n'en promettait que 2,4 : l'indice vaut 4 ÷ 2,4 ≈ 1,7, une très bonne performance.</p>
          <p class="muted">Valeurs grisées : moins de ${MIN_SAMPLE} parties, peu significatif.</p>`, "Taux et indice : c'est quoi ?")}` : `<p class="muted">Aucune partie sur cette période.</p>`}
      ${st.coop.plays ? `<p class="coopline">Coopératif et solo : <strong>${plural(st.coop.wins, "réussite", "réussites")}</strong> sur ${st.coop.plays} (${fmtPct(st.coop.wins / st.coop.plays)})</p>` : ""}
    </section>`;
}

// ---------- Groupes (v1.3.0) --------------------------------------------
// Chaque groupe a ses joueurs, jeux, parties et droits. Une personne peut en avoir plusieurs.
const GROUP_EMOJIS = ["🏠", "💼", "🍷", "🎲", "🎉", "❤️", "⚽", "🎓", "🌳", "☕"];
const groupLabel = (g) => `${g?.emoji ? g.emoji + " " : ""}${g?.name || "C-Party"}`;
const emojiPicker = (cur, name = "emoji") => `<div class="emoji-pick">${GROUP_EMOJIS.map((e) =>
  `<label><input type="radio" name="${name}" value="${e}" ${e === cur ? "checked" : ""}><span>${e}</span></label>`).join("")}
  <label><input type="radio" name="${name}" value="" ${!cur ? "checked" : ""}><span class="small muted">Aucun</span></label></div>`;

async function loadGroups() {
  try { S.groups = await S.store.groups(); } catch (e) { S.groups = []; toast(e.message, "error"); }
  if (route().parts[0] === "groups") render();
}
function viewGroups() {
  const list = S.groups;
  return header("Mes groupes", { back: "#/" }) + `
    <p class="pad small muted">Chaque groupe a ses joueurs, ses jeux, ses parties et ses membres. Touche un groupe pour l'ouvrir.</p>
    ${!list ? `<div class="loading">Chargement…</div>` : `<div class="list">${list.map((g) => `<button class="card group-row" data-action="group-open" data-id="${esc(g.id)}">
      <span class="g-emoji">${esc(g.emoji || "🎲")}</span>
      <span class="g-body"><strong>${esc(g.name)}</strong><span class="muted small">${g.owner ? "Propriétaire" : g.role === "admin" ? "Gestionnaire" : "Joueur"} · ${plural(g.members, "membre", "membres")}</span></span>
      ${g.current || g.id === S.data.group?.id ? icon("check", 20, "g-cur") : `<span class="chev">›</span>`}</button>`).join("")}</div>`}
    <div class="quick"><a class="primary" href="#/groups/new">${icon("plus", 18)} Créer un groupe</a></div>
    <p class="pad small muted">Pour rejoindre le groupe de quelqu'un d'autre, touche le lien d'invitation qu'il t'a envoyé.</p>`;
}
function viewGroupNew() {
  return header("Nouveau groupe", { back: "#/groups" }) + `
    <form class="form" data-form="group-new">
      <label class="field"><span>Nom du groupe</span><input name="name" required maxlength="40" placeholder="Famille, Collègues, Club du jeudi…" data-autofocus></label>
      <fieldset class="field"><legend>Icône</legend>${emojiPicker("🎲")}</fieldset>
      <p class="hint">Tu seras propriétaire du groupe : tu pourras inviter des joueurs et des gestionnaires, et copier des jeux depuis tes autres groupes.</p>
      <div class="form-actions"><a class="btn ghost" href="#/groups">Annuler</a><button class="btn primary" type="submit">Créer le groupe</button></div>
    </form>`;
}
// En-tête de l'accueil : le nom du groupe ouvre la liste des groupes.
const groupTitleBtn = () => `<a class="group-switch" href="#/groups" aria-label="Changer de groupe">${esc(groupLabel(S.data.group))} ${icon("chevronDown", 18)}</a>`;

// Bandeaux de l'accueil : nommer le groupe (propriétaire), dire qui l'on est (tout le monde).
function groupPrompts() {
  const g = S.data.group || {};
  const me = S.data.me;
  const later = (k) => { try { return localStorage.getItem(`cparty-later-${k}-${g.id}`) === "1"; } catch { return false; } };
  let out = "";
  if (S.store.mode === "icloud" && g.owner && !g.named) out += `<section class="panel prompt"><h2>Donne un nom à ton groupe</h2>
    <p class="small muted">Tu peux maintenant avoir plusieurs groupes (famille, collègues…). Ce nom sera vu par tous les membres et dans les invitations.</p>
    <form class="form compact" data-form="group-info"><input name="name" maxlength="40" placeholder="Famille" required>${emojiPicker("🏠")}
    <div class="form-actions"><button class="btn small primary" type="submit">Enregistrer</button></div></form></section>`;
  if (!me.player_id && activePlayers().length && !later("me")) out += `<section class="panel prompt"><h2>Qui es-tu dans ce groupe ?</h2>
    <p class="small muted">Choisis ta fiche : tes statistiques de tous tes groupes seront réunies dans « Moi ».</p>
    <div class="chips wrap">${activePlayers().map((p) => `<button class="chip pchip" data-action="me-player" data-id="${p.id}">${dot(p)}${esc(p.name)}</button>`).join("")}</div>
    <p class="right"><button class="btn small ghost" data-action="later" data-k="me">Plus tard</button></p></section>`;
  return out;
}

// Données de tous mes groupes, chargées à la demande (vue « Moi », copie de jeux).
async function loadCross(force = false) {
  if (S.cross && !force && Date.now() - S.cross.at < 60000) return;
  try {
    const groups = await S.store.groups();
    const data = [];
    for (const g of groups) {
      try { data.push({ ...(await S.store.readGroup(g.id)), name: g.name, emoji: g.emoji, role: g.role }); }
      catch { /* groupe inaccessible : ignoré */ }
    }
    S.cross = { at: Date.now(), groups: data };
  } catch (e) { S.cross = { at: Date.now(), groups: [], error: e.message }; }
  const { parts } = route();
  if (parts[0] === "me" || (parts[0] === "games" && parts[1] === "copy")) render();
}

function viewMe() {
  const myPlayer = S.data.me.player_id && player(S.data.me.player_id);
  const title = myPlayer ? myPlayer.name : "Moi";
  if (!S.cross) return header(title, { back: "#/" }) + `<div class="loading">Lecture de tous tes groupes…</div>`;
  const st = myStats(S.cross.groups);
  const linked = st.groups.filter((x) => x.linked);
  return header(title, { back: "#/", above: "Tous mes groupes" }) + `
    ${!linked.length ? `<div class="empty"><p><strong>Indique qui tu es dans tes groupes.</strong></p><p class="muted">Sur l'accueil de chaque groupe, choisis ta fiche joueur : tes statistiques seront réunies ici.</p></div>` : `
    <section class="kpis">
      ${kpi("parties", fmtNum(st.total.plays))}
      ${kpi("de jeu", fmtHours(st.total.minutes))}
      ${kpi("victoires", fmtNum(st.total.wins), st.total.comp ? `sur ${st.total.comp} compétitives` : "")}
      ${kpi("taux de victoire", st.total.comp ? rate(st.total.wins / st.total.comp, st.total.comp) : "—")}
    </section>`}
    <div class="sec-h"><h2>Par groupe</h2></div>
    <div class="list">${st.groups.map((x) => `<button class="card group-row" data-action="group-open" data-id="${esc(x.group.id)}">
      <span class="g-emoji">${esc(x.group.emoji || "🎲")}</span>
      <span class="g-body"><strong>${esc(x.group.name)}</strong><span class="muted small">${x.linked
        ? `${plural(x.plays, "partie", "parties")}${x.comp ? ` · ${x.wins} vict. · ${fmtPct(x.wins / x.comp)}` : ""}`
        : "Indique qui tu es dans ce groupe"}</span></span><span class="chev">›</span></button>`).join("")}</div>
    ${st.games.length ? `<div class="sec-h"><h2>Mes jeux</h2></div>
    <div class="list">${st.games.slice(0, 8).map((e) => `<div class="card game">${gameThumb(e.game, 40)}
      <span class="g-body"><strong>${esc(e.name)}</strong><span class="muted small">${plural(e.plays, "partie", "parties")}${e.comp ? ` · ${e.wins} vict.` : ""}</span></span></div>`).join("")}</div>` : ""}
    ${st.recent.length ? `<div class="sec-h"><h2>Mes dernières parties</h2></div>
    <div class="list">${st.recent.map((r) => `<button class="card play" data-action="group-play" data-group="${esc(r.group.id)}" data-id="${r.play.id}">${gameThumb(r.game, 40)}
      <span class="g-body"><strong>${esc(r.game?.name || "Jeu supprimé")}</strong><span class="muted small">${esc(r.group.emoji || "")} ${esc(r.group.name)} · ${fmtShort(r.play.played_at)}</span></span>
      ${r.won === true ? icon("trophy", 18, "tr") : r.won === false ? `<span class="muted small">—</span>` : ""}</button>`).join("")}</div>` : ""}
    <p class="center small muted" style="margin-top:16px">Visible par toi seul. Tes statistiques détaillées par jeu restent dans chaque groupe.</p>`;
}

// Copier des jeux depuis un autre groupe (fiche + pochette, sans les parties).
function viewGameCopy() {
  if (!isAdmin()) return notFound();
  if (!S.cross) return header("Depuis un autre groupe", { back: "#/games/new" }) + `<div class="loading">Lecture de tes autres groupes…</div>`;
  const norm = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const have = new Set(S.data.games.flatMap((g) => [g.bgg_id ? `b${g.bgg_id}` : null, `n${norm(g.name)}`]).filter(Boolean));
  const others = S.cross.groups.filter((g) => g.id !== S.data.group?.id);
  const sel = (S.copySel ||= {});
  const rows = others.map((gr) => ({ gr, games: gr.games.filter((g) => !g.base_game_id && !have.has(g.bgg_id ? `b${g.bgg_id}` : `n${norm(g.name)}`))
    .sort((a, b) => a.name.localeCompare(b.name, "fr")) })).filter((x) => x.games.length);
  return header("Depuis un autre groupe", { back: "#/games/new", sub: `vers ${esc(groupLabel(S.data.group))}` }) + `
    ${!others.length ? `<div class="empty"><p>Tu n'as pas d'autre groupe.</p></div>` : !rows.length ? `<div class="empty"><p>${icon("check", 20)} Tous les jeux de tes autres groupes sont déjà ici.</p></div>` : `
    <p class="pad small muted">La fiche, la pochette et les extensions sont copiées ; les parties restent dans leur groupe.</p>
    ${rows.map(({ gr, games }) => `<div class="sec-h"><h2>${esc(groupLabel(gr))}</h2></div>
      <div class="list checks">${games.map((g) => { const k = `${gr.id}::${g.id}`; const ex = gr.games.filter((e) => e.base_game_id === g.id).length;
        return `<label class="card check-row"><input type="checkbox" data-copy="${esc(k)}" ${sel[k] ? "checked" : ""}>${gameThumb(g, 36)}
        <span>${esc(g.name)}${ex ? `<span class="muted small"> · ${plural(ex, "extension", "extensions")}</span>` : ""}</span></label>`; }).join("")}</div>`).join("")}
    <div class="form-actions sticky"><button class="btn primary" data-action="copy-games">Copier la sélection</button></div>`}`;
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
  return header("Parties", { sub: plural(S.data.plays.length, "partie enregistrée", "parties enregistrées"), actions: addBtn("#/plays/new", "Nouvelle partie") }) + `
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
  const actions = `<button class="icon-btn" data-action="share-play" data-id="${p.id}" aria-label="Partager le résultat">${icon("share")}</button>` +
    (isAdmin() ? `<a class="icon-btn" href="#/plays/${p.id}/edit" aria-label="Modifier">${icon("edit")}</a>
    <button class="icon-btn" data-action="delete-play" data-id="${p.id}" aria-label="Supprimer">${icon("trash")}</button>` : "");
  const hasScore = p.players.some((x) => x.score != null && x.score !== "");
  const deltas = isComp(p) ? eloForGame(S.data.plays, p.game_id).deltas.get(p.id) : null;
  const eloCell = (id) => deltas && deltas[id] != null ? `<span class="elo ${deltas[id] > 0 ? "good" : deltas[id] < 0 ? "bad" : "muted"}">${signed(deltas[id])}</span>` : "";
  const scoreCell = (v) => hasScore ? `<span class="sc">${fmtScore(v)}</span>` : "";
  let results;
  if (p.mode === "coop" || p.mode === "solo") {
    results = `<div class="banner ${p.coop_result === "win" ? "win" : "loss"}">${p.coop_result === "win" ? icon("trophy", 20) + " Victoire" : "Défaite"}${p.mode === "coop" ? " collective" : ""}</div>
      <ul class="res-list">${p.players.map((x) => `<li>${dot(player(x.player_id), 30)}<a class="nm" href="#/players/${x.player_id}">${pname(x.player_id)}</a>${scoreCell(x.score)}</li>`).join("")}</ul>`;
  } else if (p.mode === "teams") {
    const teams = new Map();
    p.players.forEach((x) => { const t = x.team || "Sans équipe"; if (!teams.has(t)) teams.set(t, []); teams.get(t).push(x); });
    results = [...teams.entries()].sort((a, b) => (a[1][0].rank ?? 99) - (b[1][0].rank ?? 99)).map(([t, xs]) => `
      <div class="team ${xs[0].is_winner ? "won" : ""}"><div class="team-h"><span class="rk">${xs[0].rank ?? "–"}</span><strong>${esc(t)}</strong>
      ${xs[0].is_winner ? icon("trophy", 16, "tr") : ""}${xs[0].score != null ? `<span class="sc">${fmtScore(xs[0].score)}</span>` : ""}</div>
      <ul class="res-list">${xs.map((x) => `<li><span class="rk"></span>${dot(player(x.player_id), 26)}<a class="nm" href="#/players/${x.player_id}">${pname(x.player_id)}</a>${eloCell(x.player_id)}</li>`).join("")}</ul></div>`).join("");
  } else {
    results = `<ul class="res-list">${[...p.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((x) => `
      <li class="${x.is_winner ? "won" : ""}"><span class="rk">${x.rank ?? "–"}</span>${dot(player(x.player_id), 30)}
      <span class="nm"><a href="#/players/${x.player_id}">${pname(x.player_id)}</a>${x.is_winner ? icon("trophy", 16, "tr") : ""}</span>
      ${scoreCell(x.score)}${eloCell(x.player_id)}</li>`).join("")}</ul>`;
  }
  const exps = (p.expansions || []).map(game).filter(Boolean);
  const creator = profile(p.created_by);
  if (deltas) results += `<p class="res-foot"><span>Points Elo gagnés ou perdus</span>${g ? `<a href="#/games/${g.id}">Classement Elo ›</a>` : ""}</p>`;
  else if (p.is_learning && p.mode !== "coop" && p.mode !== "solo") results += `<p class="res-foot">Partie d'apprentissage : pas de points Elo.</p>`;
  const sub = [fmtDate(p.played_at), p.mode !== "competitive" ? MODES[p.mode] : "", p.duration_min ? fmtDuration(p.duration_min) : "",
    plural(p.players.length, "joueur", "joueurs"), p.is_learning ? "Apprentissage" : ""].filter(Boolean).join(" · ");
  return header(g?.name || "Jeu supprimé", { back: "#/plays", actions, sub }) + `
    <section class="panel">${results}</section>
    <div class="rows">
      ${exps.length ? `<div><span class="lbl">${icon("puzzle", 16)} Extensions</span><span class="val">${exps.map((e) => esc(e.name)).join(", ")}</span></div>` : ""}
      ${p.notes ? `<div><p class="note">${esc(p.notes)}</p></div>` : ""}
      ${g ? `<a href="#/games/${g.id}">${gameThumb(g, 30)}<span>Fiche du jeu</span><span class="chev">›</span></a>` : ""}
    </div>
    ${p.photo_count || isAdmin() ? `<div class="sec-h"><h2>Photos</h2>${isAdmin() ? photoPicker(`data-add-photos="${p.id}"`, "Ajouter") : ""}</div><section class="panel">
      <div id="photos" class="photos">${p.photo_count ? `<p class="muted small">Chargement…</p>` : `<p class="muted small">Aucune photo pour l'instant.</p>`}</div>
    </section>` : ""}
    <div class="sec-h"><h2>Historique</h2></div><section class="panel">
      <p class="muted small">Saisie${p.created_at ? ` le ${fmtDateTime(p.created_at)}` : ""}${creator ? ` par ${esc(creator.display_name || creator.email)}` : ""}</p>
      <div id="history" class="history"><p class="muted small">Chargement…</p></div>
    </section>`;
}

// ---------- Photos ---------------------------------------------------------
const photoPicker = (attr, label) => `<label class="btn small">${icon("camera", 16)} ${label}
  <input type="file" accept="image/*" multiple hidden ${attr}></label>`;
async function prepareAll(files) {
  const out = [];
  for (const f of files) out.push(await preparePhoto(f, S.store.mode === "demo" ? 900 : 1600));
  return out;
}
async function uploadPhotos(playId, list) {
  for (let i = 0; i < list.length; i++) {
    if (list.length > 1) toast(`Envoi des photos (${i + 1}/${list.length})…`);
    await S.store.addPhotos(playId, [list[i]]);
  }
}
async function loadPhotos(playId) {
  const box = $("#photos");
  if (!box) return;
  try {
    const rows = await S.store.photos(playId);
    if (!$("#photos")) return;
    S.photoList = rows;
    box.innerHTML = rows.length ? rows.map((ph, i) => `<button class="ph" data-action="photo-open" data-i="${i}" aria-label="Voir la photo ${i + 1}">
      <img src="${esc(ph.thumb)}" alt="" loading="lazy"></button>`).join("") : `<p class="muted small">Aucune photo pour l'instant.</p>`;
  } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
}
// Visionneuse plein écran : flèches, balayage, suppression pour les gestionnaires.
async function openViewer(i) {
  const list = S.photoList || [];
  const ph = list[i];
  if (!ph) return;
  let v = $("#viewer");
  if (!v) { v = document.createElement("div"); v.id = "viewer"; v.className = "viewer"; document.body.append(v); }
  v.dataset.i = i;
  v.innerHTML = `<img src="${esc(ph.thumb)}" alt="Photo ${i + 1} sur ${list.length}">
    <div class="viewer-bar">
      <button class="icon-btn" data-action="photo-close" aria-label="Fermer">${icon("x", 24)}</button>
      <span class="small">${i + 1} / ${list.length}</span>
      ${isAdmin() ? `<button class="icon-btn" data-action="photo-delete" aria-label="Supprimer la photo">${icon("trash", 22)}</button>` : "<span></span>"}
    </div>
    ${i > 0 ? `<button class="viewer-nav prev" data-action="photo-nav" data-d="-1" aria-label="Photo précédente">${icon("chevronLeft", 28)}</button>` : ""}
    ${i < list.length - 1 ? `<button class="viewer-nav next" data-action="photo-nav" data-d="1" aria-label="Photo suivante">${icon("chevronRight", 28)}</button>` : ""}`;
  v.hidden = false;
  document.body.classList.add("no-scroll");
  try {
    const full = await S.store.photoFull(ph.id);
    const img = v.querySelector("img");
    if (full && img && v.dataset.i === String(i)) img.src = full;
  } catch (e) { toast(e.message, "error"); }
}
function closeViewer() { const v = $("#viewer"); if (v) v.hidden = true; document.body.classList.remove("no-scroll"); }
let touchX = null;
document.addEventListener("touchstart", (e) => { touchX = e.target.closest("#viewer") ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener("touchend", (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX; touchX = null;
  const v = $("#viewer");
  if (v && !v.hidden && Math.abs(dx) > 50) openViewer(Number(v.dataset.i) + (dx < 0 ? 1 : -1));
});
window.addEventListener("hashchange", closeViewer);

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
    manual: false, photos: [],
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
    teams, manual: true, photos: [],
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
    <fieldset class="field"><legend>Photos ${id ? `<span class="muted small">· à ajouter</span>` : ""}</legend>
      <div class="photos">${f.photos.map((ph, i) => `<div class="ph"><img src="${esc(ph.thumb)}" alt="">
        <button type="button" class="ph-del" data-action="f-photo-del" data-i="${i}" aria-label="Retirer cette photo">${icon("x", 14)}</button></div>`).join("")}
        ${photoPicker("data-form-photos", f.photos.length ? "Autres photos" : "Joindre des photos")}</div>
    </fieldset>
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
  const counts = new Map(), last = new Map();
  S.data.plays.forEach((p) => {
    counts.set(p.game_id, (counts.get(p.game_id) || 0) + 1);
    if (!last.has(p.game_id) || last.get(p.game_id) < p.played_at) last.set(p.game_id, p.played_at);
  });
  let games = baseGames();
  const total = games.length;
  if (S.ui.gameStatus !== "all") games = games.filter((g) => g.status === S.ui.gameStatus);
  if (q) games = games.filter((g) => g.name.toLowerCase().includes(q) || (g.bgg_name || "").toLowerCase().includes(q));
  // « Que jouer ce soir ? » : nombre de joueurs présents + tri
  const n = S.ui.nbPlayers;
  let unknown = [];
  if (n) {
    unknown = games.filter((g) => !g.min_players && !g.max_players);
    games = games.filter((g) => (g.min_players || g.max_players) && (g.min_players || 1) <= n
      && (n >= 6 ? (g.max_players || g.min_players) >= 6 : (g.max_players || g.min_players) >= n));
  }
  const sorters = {
    name: () => 0,
    played: (a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0),
    forgotten: (a, b) => (last.get(a.id) || "").localeCompare(last.get(b.id) || ""), // jamais joués d'abord
  };
  const sortFn = sorters[S.ui.gameSort] || sorters.name;
  games = [...games].sort((a, b) => sortFn(a, b) || a.name.localeCompare(b.name, "fr"));
  unknown = [...unknown].sort((a, b) => sortFn(a, b) || a.name.localeCompare(b.name, "fr"));
  const ago = (d) => {
    if (!d) return "jamais joué";
    const m = Math.floor((Date.now() - new Date(d)) / (30.44 * 864e5));
    return m < 1 ? "joué ce mois-ci" : m < 12 ? `pas joué depuis ${m} mois` : `pas joué depuis ${plural(Math.floor(m / 12), "an", "ans")}`;
  };
  const card = (g) => {
      const n = counts.get(g.id) || 0;
      const exps = expansionsOf(g.id).length;
      return `<a class="card game" href="#/games/${g.id}">${gameThumb(g, 56)}
        <div class="gc-body"><strong>${esc(g.name)}</strong>
        <div class="muted small gc-meta">${g.min_players ? `${icon("person", 13)} ${g.min_players}${g.max_players && g.max_players !== g.min_players ? `–${g.max_players}` : ""}` : ""}
          ${g.min_time ? ` ${icon("clock", 13)} ${g.min_time}${g.max_time && g.max_time !== g.min_time ? `–${g.max_time}` : ""} min` : ""}
          ${g.weight ? ` ${icon("weight", 13)} ${fmtNum(g.weight, 1)}/5` : ""}</div>
        <div class="small">${plural(n, "partie", "parties")}${S.ui.gameSort === "forgotten" && n ? ` · ${ago(last.get(g.id))}` : ""}${exps ? ` · ${plural(exps, "extension", "extensions")}` : ""}${g.status === "lent" ? ` · <span class="tag">Prêté${g.lent_to ? " à " + esc(g.lent_to) : ""}</span>` : g.status === "elsewhere" ? ` · <span class="tag">Joué ailleurs</span>` : ""}</div>
        </div></a>`;
  };
  const actions = isAdmin() ? `<a class="icon-btn" href="#/games/import" aria-label="Synchroniser avec BGG">${icon("sync")}</a>${addBtn("#/games/new", "Ajouter un jeu")}` : "";
  return header("Jeux", { sub: plural(total, "jeu", "jeux"), actions }) + `
    <div class="search">${icon("search", 18)}<input type="search" placeholder="Rechercher un jeu" value="${esc(S.ui.gameQuery)}" data-input="gameQuery" aria-label="Rechercher un jeu"></div>
    <div class="chips">${[["all", "Tous"], ...Object.entries(STATUS)].map(([k, v]) =>
      `<button class="chip ${S.ui.gameStatus === k ? "on" : ""}" data-action="game-status" data-v="${k}">${v}</button>`).join("")}</div>
    ${total ? `<div class="tonight">
      <div class="tonight-row"><span class="small muted">Ce soir, on est</span><div class="seg">${[0, 2, 3, 4, 5, 6].map((k) =>
        `<button type="button" class="${n === k ? "on" : ""}" data-action="nb-players" data-v="${k}">${k === 0 ? "Tous" : k === 6 ? "6+" : k}</button>`).join("")}</div></div>
      <div class="tonight-row"><span class="small muted">Trier</span><div class="seg">${[["name", "A–Z"], ["played", "Plus joués"], ["forgotten", "Délaissés"]].map(([k, v]) =>
        `<button type="button" class="${S.ui.gameSort === k ? "on" : ""}" data-action="game-sort" data-v="${k}">${v}</button>`).join("")}</div></div>
    </div>` : ""}
    ${n && games.length ? `<p class="muted small pad">${plural(games.length, "jeu jouable", "jeux jouables")} à ${n === 6 ? "6 ou plus" : n}</p>` : ""}
    ${games.length ? `<div class="list">${games.map(card).join("")}</div>` : unknown.length ? "" : `<div class="empty"><p class="muted">${total ? (n ? `Aucun jeu de la ludothèque ne se joue à ${n === 6 ? "6 ou plus" : n}.` : "Aucun jeu ne correspond.") : "La ludothèque est vide."}</p>
      ${!total && isAdmin() ? `<div class="row-gap"><a class="btn" href="#/games/import">Importer ma collection BGG</a><a class="btn primary" href="#/games/new">Ajouter un jeu</a></div>` : ""}</div>`}
    ${isAdmin() && total ? `<p class="center"><a class="btn small" href="#/games/import">${icon("sync", 16)} Synchroniser avec BGG</a></p>` : ""}
    ${unknown.length ? `<section class="group"><h2 class="group-h">Nombre de joueurs non renseigné <span class="muted">· ${unknown.length}</span></h2>
      <div class="list">${unknown.map(card).join("")}</div></section>` : ""}
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
  const elo = eloForGame(S.data.plays, g.id);
  const exps = expansionsOf(g.id);
  const actions = isAdmin() ? `<a class="icon-btn" href="#/games/${g.id}/edit" aria-label="Modifier">${icon("edit")}</a>
    <button class="icon-btn" data-action="delete-game" data-id="${g.id}" aria-label="Supprimer">${icon("trash")}</button>` : "";
  const sub = [g.bgg_name && g.bgg_name !== g.name ? esc(g.bgg_name) : "", g.year || ""].filter(Boolean).join(" · ");
  return header(g.name, { back: "#/games", actions, sub }) + `
    ${g.image_url ? `<div class="hero"><img src="${esc(g.image_url)}" alt="Boîte de ${esc(g.name)}" referrerpolicy="no-referrer"></div>` : ""}
    ${gameFacts(g)}
    ${exps.length ? `<div class="sec-h"><h2>Extensions</h2></div><section class="panel"><ul class="plain">${exps.map((e) => `<li><a href="#/games/${e.id}">${icon("puzzle", 14)} ${esc(e.name)}</a></li>`).join("")}</ul></section>` : ""}
    <section class="kpis">
      ${kpi("parties", fmtNum(st.count))}
      ${kpi("de jeu", fmtHours(st.minutes))}
      ${kpi("durée réelle moy.", st.avgDuration ? `${fmtNum(st.avgDuration)} min` : "—")}
      ${kpi("dernière partie", st.last ? fmtShort(st.last) : "—", st.last ? String(st.last.slice(0, 4)) : "")}
    </section>
    ${st.record ? `<section class="panel record">${icon("trophy", 22, "tr")}<div><div class="muted small">Record (${g.score_rule === "low" ? "score le plus bas" : "meilleur score"})</div>
      <strong>${fmtScore(st.record.score)}</strong> par ${pname(st.record.player_id)} <span class="muted small">le ${fmtDate(st.record.date)}</span>
      ${st.avgScore != null ? `<div class="muted small">Score moyen : ${fmtScore(Math.round(st.avgScore * 10) / 10)}</div>` : ""}</div></section>` : ""}
    ${st.byPlayer.length ? `<div class="sec-h"><h2>Par joueur</h2></div><section class="panel">
      <table class="tbl"><thead><tr><th>Joueur</th><th class="n">Parties</th><th class="n">Vict.</th><th class="n">Taux</th>${g.score_rule !== "none" ? `<th class="n">Meilleur</th>` : ""}</tr></thead>
      <tbody>${st.byPlayer.map((l) => `<tr data-href="#/players/${l.player.id}"><td>${dot(l.player)}${esc(l.player.name)}</td>
        <td class="n">${l.plays}</td><td class="n">${l.comp ? l.wins : "—"}</td><td class="n">${l.comp ? rate(l.rate, l.comp) : "—"}</td>
        ${g.score_rule !== "none" ? `<td class="n">${fmtScore(l.best)}</td>` : ""}</tr>`).join("")}</tbody></table>
      ${st.coop.plays ? `<p class="coopline">Coopératif et solo : <strong>${plural(st.coop.wins, "réussite", "réussites")}</strong> sur ${st.coop.plays} (${fmtPct(st.coop.wins / st.coop.plays)})</p>` : ""}
    </section>` : ""}
    ${elo.ranking.length ? `<div class="sec-h"><h2>Classement Elo</h2></div><section class="panel">
      <table class="tbl"><thead><tr><th>Joueur</th><th class="n">Elo</th><th class="n">Parties</th></tr></thead>
      <tbody>${elo.ranking.map((r, i) => `<tr data-href="#/players/${r.player_id}"><td><span class="rk">${i + 1}</span>${dot(player(r.player_id))}${pname(r.player_id)}</td>
        <td class="n"><strong class="${r.plays < MIN_SAMPLE ? "thin" : ""}">${fmtNum(Math.round(r.rating))}</strong></td><td class="n">${r.plays}</td></tr>`).join("")}</tbody></table>
      ${explain(ELO_EXPLAIN, "L'Elo, c'est quoi ?")}</section>` : ""}
    ${st.count ? `<div class="sec-h"><h2>Parties sur 12 mois</h2></div><section class="panel">${barChart(st.byMonth.map((m) => ({ label: monthShort(m.ym), value: m.count, tip: `${monthLabel(m.ym)} : ${plural(m.count, "partie", "parties")}` })), { height: 120 })}</section>
      <div class="sec-h"><h2>Dernières parties</h2></div><div class="list">${st.plays.slice(0, 5).map(playCard).join("")}</div>` : ""}
    ${isAdmin() ? `<p class="center"><a class="btn primary" href="#/plays/new?game=${g.id}">${icon("plus", 18)} Nouvelle partie de ce jeu</a></p>` : ""}
    ${g.bgg_id ? `<p class="center small muted">Source : <a href="https://boardgamegeek.com/boardgame/${g.bgg_id}" target="_blank" rel="noopener">BoardGameGeek</a></p>` : ""}`;
}

function gameFacts(g) {
  const range = (a, b, unit = "") => (a ? `${a}${b && b !== a ? `–${b}` : ""}${unit}` : "—");
  const img = g.cover || g.image_url || g.thumbnail_url;
  return `<div class="game-hero">${img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : gameThumb(g, 132)}</div><section class="panel">
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
    ${S.store.mode !== "cloud" ? `<p class="center small"><a href="#/games/copy">Copier depuis un autre groupe</a></p>` : ""}
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

function draftFromBgg(t, fromFile = false) {
  const baseMatch = (t.base_bgg_ids || []).map((bid) => S.data.games.find((g) => g.bgg_id === bid && !g.base_game_id)).find(Boolean);
  return {
    id: null, name: guessFrenchName(t.bgg_name, t.names), bgg_name: t.bgg_name, bgg_id: t.bgg_id, year: t.year,
    image_url: t.image_url, thumbnail_url: t.thumbnail_url, types: t.types || [], categories: t.categories || [],
    mechanics: t.mechanics || [], designers: t.designers || [], publisher: t.publisher, min_players: t.min_players,
    max_players: t.max_players, min_time: t.min_time, max_time: t.max_time, weight: t.weight, status: "owned", lent_to: null,
    default_mode: t.cooperative ? "coop" : t.solo_only ? "solo" : "competitive", score_rule: t.cooperative ? "none" : "high",
    notes: null, bgg_synced_at: fromFile ? null : new Date().toISOString(), base_game_id: t.expansion ? baseMatch?.id || "" : null, _isExpansion: !!t.expansion, _names: t.names || [], _baseBggIds: t.base_bgg_ids || [],
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
    <div class="cover-edit"><div id="cover-preview">${gameThumb(d, 96)}</div>
      <div class="row-gap">${photoPicker("data-cover", d.cover ? "Changer la pochette" : "Ajouter une pochette").replace("multiple ", "")}
      <button type="button" class="btn small ghost" data-action="cover-remove" ${d.cover ? "" : "hidden"}>Retirer</button></div></div>
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
// ---------- Synchronisation avec la collection BGG ------------------------
// Compare la collection BGG (jeux « possédés ») à la ludothèque :
//  - nouveaux jeux à ajouter ;
//  - fiches à compléter (données manquantes) — y compris les jeux saisis à la main dont le nom
//    correspond à un jeu de la collection : ils sont alors associés à BGG ;
//  - jeux possédés dans C-Party mais absents de la collection : proposés en « joué ailleurs » (jamais supprimés).
// Ne modifie jamais le nom affiché, la pochette choisie, le statut (sauf choix explicite) ni les parties.
const normName = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const SYNC_FIELDS = ["bgg_name", "year", "image_url", "thumbnail_url", "types", "categories", "mechanics", "designers", "publisher",
  "min_players", "max_players", "min_time", "max_time", "weight"];
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
// Fiche incomplète : pas d'image, de nombre de joueurs ou de durée. Une fiche déjà complétée une fois
// (bgg_synced_at) n'est plus reproposée : BGG n'a alors rien de plus à donner.
const missingInfo = (g) => !g.bgg_synced_at && ((isEmpty(g.image_url) && isEmpty(g.thumbnail_url)) || isEmpty(g.min_players) || isEmpty(g.min_time));
// fileThings (import du fichier CSV) : une fiche n'est proposée que si le fichier a de quoi la compléter
// (le fichier n'a ni image ni mécaniques).
const fileFills = (g, t) => t && SYNC_FIELDS.some((f) => isEmpty(g[f]) && !isEmpty(t[f]));
function syncPlan(items, fileThings = null) {
  const byBgg = new Map(S.data.games.filter((g) => g.bgg_id).map((g) => [g.bgg_id, g]));
  const ids = new Set(items.map((i) => i.id));
  const manual = S.data.games.filter((g) => !g.bgg_id);
  const fresh = [], complete = [];
  for (const i of items) {
    const g = byBgg.get(i.id);
    if (g) {
      if (fileThings ? fileFills(g, fileThings.get(i.id)) : missingInfo(g)) complete.push({ game: g, item: i, link: false });
      continue;
    }
    const m = manual.find((x) => normName(x.name) === normName(i.name) || normName(x.bgg_name) === normName(i.name));
    if (m) { complete.push({ game: m, item: i, link: true }); continue; }
    // Même nom qu'un jeu déjà présent (autre édition BGG ?) : proposé mais décoché par défaut.
    const twin = S.data.games.find((x) => normName(x.name) === normName(i.name) || normName(x.bgg_name) === normName(i.name));
    if (twin && i.checked === undefined) i.checked = false;
    fresh.push({ ...i, twin });
  }
  const gone = S.data.games.filter((g) => g.bgg_id && !ids.has(g.bgg_id) && g.status === "owned");
  return { fresh, complete, gone };
}

function viewImport() {
  if (!isAdmin()) return notFound();
  const im = S.importer || (S.importer = { step: "user", user: localStorage.getItem("nsj-bgg-user") || "", items: [], details: [], updates: [], progress: "", sel: { complete: {}, gone: {} } });
  let body = "";
  if (im.step === "user" || im.step === "loading") {
    body = `<form class="form" data-form="import-user">
      <p class="muted">La synchronisation compare les jeux marqués « possédés » dans ta collection BoardGameGeek à la ludothèque de C-Party. Tu vérifies tout avant d'enregistrer : rien n'est supprimé, et les noms affichés, pochettes et parties ne sont jamais modifiés.</p>
      <label class="field"><span>Ton pseudo BGG</span><input name="user" value="${esc(im.user)}" required autocapitalize="off" autocomplete="off" data-autofocus></label>
      <p class="hint">${esc(im.progress)}</p>
      <div class="form-actions"><button class="btn primary" type="submit" ${im.step === "loading" ? "disabled" : ""}>${im.step === "loading" ? "Récupération…" : "Récupérer ma collection"}</button></div>
    </form>
    <div class="sec-h"><h2>Ou avec le fichier de ta collection</h2></div><section class="panel">
      <p class="small">Sur le site BoardGameGeek, ouvre ta collection et exporte-la en CSV (lien « Export »), puis choisis le fichier ici. Pas besoin de connexion à BGG depuis l'app.</p>
      <label class="btn block">${icon("download", 18)} Choisir le fichier CSV de BGG<input type="file" accept=".csv,text/csv,text/comma-separated-values" data-bgg-csv hidden></label>
      <p class="small muted">Le fichier ne contient ni pochettes ni mécaniques : seuls l'année, le nombre de joueurs, la durée et la difficulté sont repris.</p></section>
    <div class="sec-h"><h2>Importer des pochettes</h2></div><section class="panel">
      <p class="small">Fichier de pochettes préparé à part (<code>pochettes-c-party.json</code>). Seuls les jeux <strong>sans pochette</strong> sont complétés, reconnus par leur numéro BGG.</p>
      <label class="btn block">${icon("download", 18)} Choisir le fichier de pochettes<input type="file" accept=".json,application/json" data-covers-file hidden></label></section>`;
  } else if (im.step === "pick") {
    const { fresh, complete, gone } = syncPlan(im.items, im.fileThings);
    const nothing = !fresh.length && !complete.length && !gone.length;
    body = `<p class="pad">${plural(im.items.length, "jeu possédé", "jeux possédés")} ${im.fileThings ? `dans le fichier <strong>${esc(im.fileName)}</strong>` : `dans la collection BGG de <strong>${esc(im.user)}</strong>`}.</p>
      ${nothing ? `<div class="empty"><p>${icon("check", 20)} <strong>La ludothèque est à jour.</strong></p><p class="muted">Rien à ajouter ni à compléter.</p>
        <a class="btn" href="#/games">Retour aux jeux</a></div>` : ""}
      ${fresh.length ? `<section class="group"><div class="group-h sync-h"><span>Nouveaux jeux <span class="muted">· ${fresh.length}</span></span>
        <span class="row-gap"><button class="btn small ghost" data-action="imp-all" data-v="1">Tout</button><button class="btn small ghost" data-action="imp-all" data-v="0">Aucun</button></span></div>
        <div class="list checks">${fresh.map((i) => `<label class="card check-row"><input type="checkbox" data-imp="${i.id}" ${i.checked !== false ? "checked" : ""}>
        <span>${esc(i.name)}${i.twin ? `<span class="muted small"> · même nom que « ${esc(i.twin.name)} », déjà dans la ludothèque</span>` : ""}</span>${i.expansion ? `<span class="tag">Extension</span>` : ""}</label>`).join("")}</div></section>` : ""}
      ${complete.length ? `<section class="group"><h2 class="group-h">Fiches à compléter <span class="muted">· ${complete.length}</span></h2>
        <p class="pad small muted">Les informations manquantes (pochette BGG, joueurs, durée, difficulté, mécaniques…) sont reprises de BGG. Le nom affiché ne change pas.</p>
        <div class="list checks">${complete.map((c) => `<label class="card check-row"><input type="checkbox" data-sync-complete="${c.game.id}" ${im.sel.complete[c.game.id] !== false ? "checked" : ""}>
        <span>${esc(c.game.name)}${c.link ? `<span class="muted small"> · associer à « ${esc(c.item.name)} » sur BGG</span>` : ""}</span></label>`).join("")}</div></section>` : ""}
      ${gone.length ? `<section class="group"><h2 class="group-h">Plus dans ta collection BGG <span class="muted">· ${gone.length}</span></h2>
        <p class="pad small muted">Ces jeux ne sont plus marqués « possédés » sur BGG. Rien n'est supprimé : coche ceux à marquer « joué ailleurs » (leurs parties restent).</p>
        <div class="list checks">${gone.map((g) => `<label class="card check-row"><input type="checkbox" data-sync-gone="${g.id}" ${im.sel.gone[g.id] ? "checked" : ""}>
        <span>${esc(g.name)}</span></label>`).join("")}</div></section>` : ""}
      ${nothing ? "" : `<div class="form-actions sticky"><button class="btn ghost" data-action="imp-restart">${im.fileThings ? "Autre fichier" : "Changer de pseudo"}</button><button class="btn primary" data-action="imp-details">Continuer</button></div>`}`;
  } else if (im.step === "details") {
    body = `<div class="empty"><p>Récupération des fiches BGG…</p><p class="muted">${esc(im.progress)}</p></div>`;
  } else if (im.step === "review") {
    const nGone = Object.values(im.sel.gone).filter(Boolean).length;
    const nNew = im.details.filter((d) => !d._isExpansion || d._baseName).length;
    body = `${im.updates.length || nGone ? `<div class="sec-h"><h2>Modifications</h2></div><section class="panel"><ul class="plain small">
        ${im.updates.length ? `<li>${icon("check", 14)} ${plural(im.updates.length, "fiche complétée", "fiches complétées")} : ${im.updates.map((u) => esc(u.game.name)).join(", ")}</li>` : ""}
        ${nGone ? `<li>${icon("check", 14)} ${plural(nGone, "jeu marqué", "jeux marqués")} « joué ailleurs »</li>` : ""}</ul></section>` : ""}
      ${im.details.length ? `<p class="pad">Nouveaux jeux : vérifie le nom affiché de chacun. BGG ne précise pas la langue des noms : le nom français est deviné.</p>` : ""}
      <div class="list">${im.details.map((d, i) => `<div class="card review">${gameThumb(d, 44)}
        <div class="rv-body"><input value="${esc(d.name)}" data-imp-name="${i}" aria-label="Nom affiché" list="alt-${i}">
        <datalist id="alt-${i}">${(d._names || []).map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        <div class="muted small">${esc(d.bgg_name)}${d.year ? ` · ${d.year}` : ""}${d._isExpansion ? ` · <span class="tag">Extension${d._baseName ? " de " + esc(d._baseName) : " (jeu de base absent : ignorée)"}</span>` : ""}</div></div></div>`).join("")}</div>
      <div class="form-actions sticky"><button class="btn ghost" data-action="imp-restart">Recommencer</button><button class="btn primary" data-action="imp-save">${nNew ? `Ajouter ${plural(nNew, "jeu", "jeux")}${im.updates.length || nGone ? " et enregistrer" : ""}` : "Enregistrer"}</button></div>`;
  }
  return header("Synchroniser avec BGG", { back: "#/games" }) + body;
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
        im.items = res.items.map((i) => ({ ...i })); // coché par défaut, sauf doublon probable (voir syncPlan)
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
  const plan = syncPlan(im.items, im.fileThings);
  const newIds = plan.fresh.filter((i) => i.checked !== false).map((i) => i.id);
  const upd = plan.complete.filter((c) => im.sel.complete[c.game.id] !== false);
  const gone = plan.gone.filter((g) => im.sel.gone[g.id]);
  const ids = [...new Set([...newIds, ...upd.map((c) => c.item.id)])];
  if (!ids.length && !gone.length) return toast("Rien de coché.");
  im.step = "details"; im.details = []; im.updates = []; render();
  try {
    const drafts = new Map();
    if (im.fileThings) ids.forEach((id) => { const t = im.fileThings.get(id); if (t) drafts.set(id, draftFromBgg(t, true)); });
    else for (let i = 0; i < ids.length; i += 20) {
      im.progress = `${Math.min(i + 20, ids.length)} / ${ids.length}`;
      const box = $(".empty .muted"); if (box) box.textContent = im.progress;
      const things = await S.store.bgg.things(ids.slice(i, i + 20));
      things.forEach((t) => drafts.set(t.bgg_id, draftFromBgg(t)));
      if (i + 20 < ids.length) await new Promise((ok) => setTimeout(ok, 1200)); // ménage l'API BGG
    }
    im.details = newIds.map((id) => drafts.get(id)).filter(Boolean);
    // Fiches à compléter : seuls les champs vides sont remplis (et l'identifiant BGG pour une association).
    im.updates = upd.map((c) => {
      const d = drafts.get(c.item.id);
      if (!d) return null;
      const patch = {};
      SYNC_FIELDS.forEach((f) => { if (isEmpty(c.game[f]) && !isEmpty(d[f])) patch[f] = d[f]; });
      if (c.link) patch.bgg_id = d.bgg_id;
      if (!im.fileThings) patch.bgg_synced_at = new Date().toISOString(); // ne plus la reproposer ensuite (le fichier, lui, n'a pas d'images : l'API pourra compléter)
      return { game: c.game, patch };
    }).filter(Boolean);
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
  return header("Joueurs", { sub: plural(activePlayers().length, "joueur", "joueurs"), actions: addBtn("#/players/new", "Ajouter un joueur") }) + `
    <div class="list">${activePlayers().map(row).join("") || `<div class="empty"><p class="muted">Aucun joueur.</p></div>`}</div>
    ${archived.length ? `<details class="pad"><summary class="muted">Joueurs archivés (${archived.length})</summary><div class="list">${archived.map(row).join("")}</div></details>` : ""}
    ${fab("#/players/new", "Ajouter un joueur")}`;
}

function viewPlayer(id) {
  const p = player(id);
  if (!p) return header("Joueur", { back: "#/players" }) + `<div class="empty"><p>Ce joueur n'existe plus.</p></div>`;
  const st = playerStats(S.data, p, S.data.plays);
  const account = S.data.profiles.find((x) => x.player_id === p.id);
  const h2h = headToHead(S.data.plays, p.id);
  const nem = nemesis(S.data.plays, p.id), vic = favouriteVictim(S.data.plays, p.id);
  const elos = st.games.map((l) => {
    const e = eloForGame(S.data.plays, l.game.id);
    const i = e.ranking.findIndex((r) => r.player_id === p.id);
    return i < 0 ? null : { game: l.game, ...e.ranking[i], pos: i + 1, of: e.ranking.length };
  }).filter(Boolean).sort((a, b) => b.rating - a.rating);
  const actions = isAdmin() ? `<a class="icon-btn" href="#/players/${p.id}/edit" aria-label="Modifier">${icon("edit")}</a>` : "";
  return header(p.name, { back: "#/players", actions, sub: `${account ? `Compte : ${esc(account.display_name || account.email)}` : "Sans compte"}${p.archived ? " · Archivé" : ""}` }) + `
    <section class="kpis">
      ${kpi("parties", fmtNum(st.plays.length))}
      ${kpi("de jeu", fmtHours(st.minutes))}
      ${kpi("victoires", fmtNum(st.wins), st.comp ? `sur ${st.comp} compétitives` : "")}
      ${kpi("taux de victoire", st.comp ? rate(st.rate, st.comp) : "—")}
    </section>
    ${st.perf != null ? `<section class="panel perf"><div><div class="muted small">Indice de performance</div><strong class="big ${st.comp < MIN_SAMPLE ? "thin" : ""}">${fmt2(st.perf)}</strong></div>
      <p class="small muted">${st.perf >= 1.05 ? `${esc(p.name)} gagne plus souvent que le hasard ne le prévoit.` : st.perf <= 0.95 ? `${esc(p.name)} gagne moins souvent que le hasard ne le prévoit.` : `${esc(p.name)} gagne à peu près autant que le hasard le prévoit.`}</p>
      ${explain(`<p>À 4 joueurs, chacun a « normalement » 1 chance sur 4 de gagner ; à 2 joueurs, 1 sur 2. L'indice divise les victoires réelles par ce nombre de victoires « attendues au hasard ».</p>
        <p>Ici : ${plural(st.wins, "victoire", "victoires")} pour ${fmtNum(st.expected, 1)} attendue${st.expected >= 2 ? "s" : ""}, soit ${fmt2(st.perf)}. <strong>1,0</strong> = dans la moyenne, <strong>1,5</strong> = 50 % de victoires en plus que prévu, <strong>0,7</strong> = 30 % de moins.</p>
        <p class="muted">Contrairement au taux de victoire, l'indice n'avantage pas ceux qui jouent souvent en duel.</p>`)}</section>` : ""}
    ${nem || vic ? `<section class="panel rivals">
      ${nem ? `<div class="rival"><div class="muted small">😈 Némésis</div><a href="#/players/${nem.player_id}"><strong>${pname(nem.player_id)}</strong></a>
        <div class="small">finit devant ${esc(p.name)} ${nem.behind} fois sur ${nem.plays}</div></div>` : ""}
      ${vic ? `<div class="rival"><div class="muted small">🎯 Victime favorite</div><a href="#/players/${vic.player_id}"><strong>${pname(vic.player_id)}</strong></a>
        <div class="small">${esc(p.name)} finit devant ${vic.ahead} fois sur ${vic.plays}</div></div>` : ""}
      ${explain(`<p>La <strong>némésis</strong> est l'adversaire qui bat le plus souvent ${esc(p.name)} : parmi les joueurs rencontrés au moins ${MIN_SAMPLE} fois en partie compétitive, celui qui finit le plus souvent devant (plus d'une fois sur deux).</p>
        <p>La <strong>victime favorite</strong>, c'est l'inverse : l'adversaire que ${esc(p.name)} devance le plus souvent.</p>
        <p class="muted">« Finir devant » = avoir un meilleur rang dans la partie. En équipes, seuls les joueurs de l'équipe adverse comptent. Parties d'apprentissage exclues.</p>`)}</section>` : ""}
    ${st.coop ? `<p class="coopline pad">Coopératif et solo : <strong>${plural(st.coopWins, "réussite", "réussites")}</strong> sur ${st.coop} (${fmtPct(st.coopRate)})</p>` : ""}
    ${st.plays.length ? `<div class="sec-h"><h2>Parties sur 12 mois</h2></div><section class="panel">${barChart(st.byMonth.map((m) => ({ label: monthShort(m.ym), value: m.count, tip: `${monthLabel(m.ym)} : ${plural(m.count, "partie", "parties")}` })), { height: 120 })}</section>
    <div class="sec-h"><h2>Par jeu</h2></div><section class="panel"><table class="tbl"><thead><tr><th>Jeu</th><th class="n">Parties</th><th class="n">Vict.</th><th class="n">Taux</th><th class="n">Meilleur</th></tr></thead>
      <tbody>${st.games.map((l) => `<tr data-href="#/games/${l.game.id}"><td>${esc(l.game.name)}</td><td class="n">${l.plays}</td>
        <td class="n">${l.comp ? l.wins : l.coop ? `${l.coopWins}<span class="muted small">/${l.coop}</span>` : "—"}</td><td class="n">${l.comp ? rate(l.rate, l.comp) : l.coop ? rate(l.coopRate, l.coop) : "—"}</td>
        <td class="n">${fmtScore(l.best)}</td></tr>`).join("")}</tbody></table>
      <p class="foot muted small">En coopératif et solo, les colonnes indiquent les réussites.</p></section>
    ${h2h.length ? `<div class="sec-h"><h2>Face-à-face</h2></div><section class="panel">
      <table class="tbl"><thead><tr><th>Adversaire</th><th class="n">Parties</th><th class="n">Devant</th><th class="n">Derrière</th></tr></thead>
      <tbody>${h2h.map((r) => `<tr data-href="#/players/${r.player_id}"><td>${dot(player(r.player_id))}${pname(r.player_id)}</td><td class="n">${r.plays}</td>
        <td class="n ${r.ahead > r.behind ? "good" : ""}">${r.ahead}</td><td class="n ${r.behind > r.ahead ? "bad" : ""}">${r.behind}</td></tr>`).join("")}</tbody></table>
      ${explain(`<p>Pour chaque adversaire, le bilan de vos parties compétitives communes : combien de fois ${esc(p.name)} a fini <strong>devant</strong> lui (meilleur rang) et combien de fois <strong>derrière</strong>. Les égalités ne sont comptées ni d'un côté ni de l'autre.</p>
        <p>Exemple : dans une partie à 4 où ${esc(p.name)} finit 2e, il est « devant » les 3e et 4e, et « derrière » le 1er.</p>
        <p class="muted">En équipes, les coéquipiers ne s'affrontent pas. Parties d'apprentissage exclues.</p>`)}</section>` : ""}
    ${elos.length ? `<div class="sec-h"><h2>Niveau Elo par jeu</h2></div><section class="panel">
      <table class="tbl"><thead><tr><th>Jeu</th><th class="n">Elo</th><th class="n">Place</th></tr></thead>
      <tbody>${elos.map((e) => `<tr data-href="#/games/${e.game.id}"><td>${esc(e.game.name)}</td><td class="n"><strong class="${e.plays < MIN_SAMPLE ? "thin" : ""}">${fmtNum(Math.round(e.rating))}</strong></td>
        <td class="n">${e.pos}<span class="muted small">/${e.of}</span></td></tr>`).join("")}</tbody></table>
      ${explain(ELO_EXPLAIN, "L'Elo, c'est quoi ?")}</section>` : ""}
    <div class="sec-h"><h2>Dernières parties</h2></div><div class="list">${st.plays.slice(0, 6).map(playCard).join("")}</div>`
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
    <div class="sec-h"><h2>Groupe</h2><a href="#/groups">Changer ›</a></div><section class="panel">
      ${isAdmin() && S.store.mode !== "cloud" ? `<form class="form compact" data-form="group-info">
        <label class="field"><span>Nom du groupe</span><input name="name" value="${esc(S.data.group?.name || "")}" maxlength="40" required></label>
        ${emojiPicker(S.data.group?.emoji || "")}
        <div class="form-actions"><button class="btn small" type="submit">Enregistrer</button></div></form>`
        : `<p><strong>${esc(groupLabel(S.data.group))}</strong></p>`}
      ${isAdmin() && S.store.mode !== "cloud" ? `<p class="small"><a href="#/games/copy">${icon("download", 15)} Copier des jeux depuis un autre groupe</a></p>` : ""}
      ${S.store.mode === "demo" ? `<p class="small muted">Démo : 3 groupes fictifs (Famille, Collègues, Belle-famille). <button class="linkish" data-action="demo-leave">Retirer ce groupe</button></p>` : ""}
    </section>
    <div class="sec-h"><h2>Mon compte</h2></div><section class="panel">
      <form class="form compact" data-form="myname">
        <label class="field"><span>Nom affiché</span><input name="name" value="${esc(me.display_name || "")}" maxlength="60"></label>
        <p class="small muted">${esc(me.email || "")}${me.email ? " · " : ""}${me.owner ? "Propriétaire · " : ""}${me.role === "admin" ? "Gestionnaire" : "Joueur (consultation)"}${me.player_id && player(me.player_id) ? ` · fiche « ${esc(player(me.player_id).name)} »` : ""}</p>
        <div class="form-actions"><button class="btn small" type="submit">Enregistrer</button></div>
      </form></section>
    ${S.store.mode === "icloud" ? viewICloudAccounts(profiles) : ""}
    ${isAdmin() && S.store.mode !== "icloud" ? `<div class="sec-h"><h2>Comptes</h2></div><section class="panel">
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
    ${!standalone && S.store.mode !== "icloud" ? `<div class="sec-h"><h2>Installer sur l'iPhone</h2></div><section class="panel">
      <ol class="small steps"><li>Ouvre cette page dans <strong>Safari</strong>.</li><li>Touche le bouton <strong>Partager</strong> ${icon("share", 16)}.</li>
      <li>Choisis <strong>Sur l'écran d'accueil</strong>, puis <strong>Ajouter</strong>.</li></ol></section>` : ""}
    <div class="sec-h"><h2>Exporter les données</h2></div><section class="panel">
      <p class="small muted">Fichiers CSV à enregistrer dans Fichiers, à s'envoyer par e-mail ou à ouvrir dans Numbers ou Excel. Les photos ne sont pas incluses.</p>
      <div class="row-gap">
        <button class="btn small" data-action="export-plays">Parties (tableur)</button>
        <button class="btn small" data-action="export-backup">Sauvegarde complète</button>
      </div>
      <p class="small muted">La sauvegarde complète peut être réimportée dans un groupe vide.</p></section>
    <section class="panel small"><h2>À propos</h2>
      <p>C-Party · version ${VERSION}</p>
      <p class="muted">Données de jeux : <a href="https://boardgamegeek.com" target="_blank" rel="noopener">BoardGameGeek</a>, usage non commercial.</p></section>
    ${S.store.mode === "cloud" ? `<p class="center"><button class="btn ghost" data-action="logout">${icon("logout", 18)} Se déconnecter</button></p>` : ""}`;
}

function viewICloudAccounts(profiles) {
  const me = S.data.me;
  const empty = !S.data.plays.length && !S.data.games.length && !S.data.players.length;
  return `${isAdmin() ? `<div class="sec-h"><h2>Membres du groupe</h2></div><section class="panel">
      <ul class="accounts">${profiles.map((p) => `<li>
        <div><strong>${esc(p.display_name)}</strong><div class="muted small">${p.owner ? "Propriétaire" : p.role === "admin" ? "Gestionnaire" : "Joueur"}${p.pending ? " · invitation en attente" : ""}${p.email ? ` · ${esc(p.email)}` : ""}</div></div>
        <select data-profile-player="${p.id}" aria-label="Fiche joueur liée"><option value="">Aucune fiche</option>${S.data.players.map((x) => `<option value="${x.id}" ${x.id === p.player_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      </li>`).join("")}</ul>
      ${me.owner ? `<h3>Inviter quelqu'un</h3>
      <p class="small muted">Choisis le rôle, puis envoie le lien par Messages ou par e-mail. La personne doit avoir installé C-Party, puis toucher le lien sur son iPhone.</p>
      <div class="row-gap"><button class="btn primary" data-action="icloud-invite" data-role="viewer">${icon("share", 18)} Inviter un joueur</button>
        <button class="btn" data-action="icloud-invite" data-role="admin">${icon("share", 18)} Inviter un gestionnaire</button></div>
      <p class="small muted">Joueur : consulte tout. Gestionnaire : saisit, modifie et supprime.</p>
      ${profiles.length > 1 ? `<p class="center"><button class="btn small ghost" data-action="icloud-share">Gérer les membres (droits, retrait)</button></p>` : ""}`
      : `<p class="small muted">Seul le propriétaire du groupe peut inviter ou changer les droits.</p>`}</section>` : ""}
    ${me.owner && empty ? `<div class="sec-h"><h2>Importer les anciennes données</h2></div><section class="panel">
      <p class="small">Choisis le fichier CSV exporté de Supabase (supabase/export.sql). L'import n'est possible que dans un espace vide.</p>
      <label class="btn block">${icon("download", 18)} Choisir le fichier CSV<input type="file" accept=".csv,text/csv" data-import-csv hidden></label>
      <p class="small muted" id="import-status"></p></section>` : ""}
    <div class="sec-h"><h2>${me.owner ? "Supprimer ce groupe" : "Quitter ce groupe"}</h2></div><section class="panel">
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
    <div class="sec-h"><h2>Tu as reçu une invitation ?</h2></div><section class="panel">
      <p class="small">Touche le lien reçu par Messages ou par e-mail : C-Party s'ouvrira sur les parties de ton groupe.</p></section>
    <div class="sec-h"><h2>Tu crées le groupe ?</h2></div><section class="panel">
      <p class="small">Les données seront rangées dans ton iCloud. Tu pourras ensuite inviter les autres joueurs.</p>
      <button class="btn primary block" data-action="icloud-create">Créer l'espace de mon groupe</button></section>
    <p class="center"><button class="btn small ghost" data-action="icloud-retry">Actualiser</button></p></div>`;
}

// ---------- Actions (clics) -------------------------------------------------
const formError = (msg) => { const el = $("#form-error"); if (el) el.textContent = msg; else toast(msg, "error"); };

const actions = {
  period: (el) => { S.ui.period = el.dataset.v; const y = window.scrollY; render(); window.scrollTo(0, y); },
  filters: () => { S.ui.filtersOpen = !S.ui.filtersOpen; const y = window.scrollY; render(); window.scrollTo(0, y); },
  "filters-reset": () => { Object.assign(S.ui, { period: "all", statPlayers: 0, statKind: "" }); const y = window.scrollY; render(); window.scrollTo(0, y); },
  "game-status": (el) => { S.ui.gameStatus = el.dataset.v; render(); },
  "cover-remove": (el) => {
    S.gameDraft.cover = null; $("#cover-preview").innerHTML = gameThumb(S.gameDraft, 96); el.hidden = true;
  },
  "nb-players": (el) => { S.ui.nbPlayers = Number(el.dataset.v); render(); },
  "game-sort": (el) => { S.ui.gameSort = el.dataset.v; render(); },
  "export-plays": async (el) => {
    el.disabled = true;
    try {
      const { playsCsv, shareFile } = await import("./export.js");
      await shareFile(`c-party-parties-${today()}.csv`, new Blob([playsCsv(S.data)], { type: "text/csv" }));
    } catch (e) { toast(e.message, "error"); }
    el.disabled = false;
  },
  "export-backup": async (el) => {
    el.disabled = true;
    try {
      const { backupCsv, shareFile } = await import("./export.js");
      const history = (await Promise.all(S.data.plays.map((p) => S.store.history(p.id)))).flat();
      const deleted = await S.store.deletedPlays();
      const all = [...history, ...deleted.filter((d) => !history.some((h) => h.id === d.id))];
      await shareFile(`c-party-sauvegarde-${today()}.csv`, new Blob([backupCsv(S.data, all)], { type: "text/csv" }));
    } catch (e) { toast(e.message, "error"); }
    el.disabled = false;
  },
  "share-play": async (el) => {
    const p = S.data.plays.find((x) => x.id === el.dataset.id);
    if (!p) return;
    el.disabled = true;
    try {
      const [{ resultCard }, { shareFile }] = await Promise.all([import("./card.js"), import("./export.js")]);
      const photos = p.photo_count ? await S.store.photos(p.id) : [];
      const photo = photos.length ? await S.store.photoFull(photos[0].id).catch(() => photos[0].thumb) : null;
      const g = game(p.game_id);
      const blob = await resultCard({ play: p, game: g, name: (id) => player(id)?.name || "?", color: (id) => player(id)?.color || "#999", photo });
      const slug = (g?.name || "partie").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
      await shareFile(`c-party-${slug}-${p.played_at}.png`, blob);
    } catch (e) { toast(e.message, "error"); }
    el.disabled = false;
  },
  "stat-players": (el) => { S.ui.statPlayers = Number(el.dataset.v); const y = window.scrollY; render(); window.scrollTo(0, y); },
  "lb-sort": (el) => { S.ui.lbSort = el.dataset.v; const y = window.scrollY; render(); window.scrollTo(0, y); },

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
  "f-photo-del": (el) => { S.form.photos.splice(Number(el.dataset.i), 1); render(); },

  "photo-open": (el) => openViewer(Number(el.dataset.i)),
  "photo-close": () => closeViewer(),
  "photo-nav": (el) => openViewer(Number($("#viewer").dataset.i) + Number(el.dataset.d)),
  "photo-delete": async () => {
    const ph = S.photoList?.[Number($("#viewer").dataset.i)];
    if (!ph || !(await confirmDialog("Supprimer cette photo ? Elle sera effacée pour tout le groupe.", "Supprimer"))) return;
    try { await S.store.deletePhoto(ph.id); closeViewer(); toast("Photo supprimée"); await reload(); } catch (e) { toast(e.message, "error"); }
  },

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
      for (const u of im.updates) await S.store.saveGame({ ...u.game, ...u.patch });
      const gone = Object.entries(im.sel.gone).filter(([, v]) => v).map(([id]) => game(id)).filter(Boolean);
      for (const g of gone) await S.store.saveGame({ ...g, status: "elsewhere" });
      const parts = [];
      if (saved.length + exps.length) parts.push(plural(saved.length + exps.length, "jeu ajouté", "jeux ajoutés"));
      if (im.updates.length) parts.push(plural(im.updates.length, "fiche complétée", "fiches complétées"));
      if (gone.length) parts.push(plural(gone.length, "jeu marqué « joué ailleurs »", "jeux marqués « joué ailleurs »"));
      toast(parts.length ? `Synchronisé : ${parts.join(", ")}` : "Rien à enregistrer");
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
  "icloud-invite": async (el) => { try { await S.store.invite({ role: el.dataset.role }); } catch (e) { toast(e.message, "error"); } },
  "icloud-share": async () => { try { await S.store.manageSharing(); } catch (e) { toast(e.message, "error"); } },
  // ----- Groupes -----
  "group-open": async (el) => {
    const id = el.dataset.id;
    if (id === S.data.group?.id && route().parts[0] === "groups") return go("#/");
    try { await S.store.useGroup(id); S.form = null; S.importer = null; S.ui.filtersOpen = false; await reload(); go("#/"); }
    catch (e) { toast(e.message, "error"); S.groups = null; loadGroups(); }
  },
  "group-play": async (el) => {
    try { if (el.dataset.group !== S.data.group?.id) { await S.store.useGroup(el.dataset.group); await reload(); } go(`#/plays/${el.dataset.id}`); }
    catch (e) { toast(e.message, "error"); }
  },
  "me-player": async (el) => {
    try { await S.store.setMyPlayer(el.dataset.id); S.cross = null; toast(`C'est noté : tu es ${player(el.dataset.id)?.name || ""}`); await reload(); }
    catch (e) { toast(e.message, "error"); }
  },
  later: (el) => { try { localStorage.setItem(`cparty-later-${el.dataset.k}-${S.data.group?.id}`, "1"); } catch { /* indisponible */ } render(); },
  "demo-leave": async () => {
    if (!(await confirmDialog(`Retirer le groupe « ${S.data.group?.name} » de la démo ?`, "Retirer"))) return;
    try { await S.store.leaveGroup(); S.cross = null; await reload(); go("#/"); } catch (e) { toast(e.message, "error"); }
  },
  "copy-games": async (el) => {
    const keys = Object.entries(S.copySel || {}).filter(([, v]) => v).map(([k]) => k);
    if (!keys.length) return toast("Rien de coché.");
    el.disabled = true;
    try {
      const clean = (g) => { const { id, created_at, updated_at, base_game_id, ...rest } = g; return rest; };
      const bases = [], exps = [];
      for (const k of keys) {
        const [gid, id] = k.split("::");
        const gr = S.cross.groups.find((x) => x.id === gid);
        const g = gr?.games.find((x) => x.id === id);
        if (!g) continue;
        const dk = g.bgg_id ? `b${g.bgg_id}` : `n${g.name.toLowerCase()}`;
        if (!g || bases.some((b) => (b.bgg_id ? `b${b.bgg_id}` : `n${b.name.toLowerCase()}`) === dk)) continue; // même jeu coché dans deux groupes
        gr.games.filter((e) => e.base_game_id === g.id).forEach((e) => exps.push({ ...clean(e), _base: g }));
      }
      const saved = await S.store.saveGames(bases.map((g) => ({ ...g, base_game_id: null })));
      const byName = new Map(saved.map((g) => [g.name, g.id]));
      const ex = exps.map(({ _base, ...e }) => ({ ...e, base_game_id: byName.get(_base.name) })).filter((e) => e.base_game_id);
      if (ex.length) await S.store.saveGames(ex);
      S.copySel = {}; S.cross = null;
      toast(`${plural(saved.length + ex.length, "jeu copié", "jeux copiés")}`);
      await reload(); go("#/games");
    } catch (e) { el.disabled = false; toast(e.message, "error"); }
  },
  "icloud-leave": async () => {
    const owner = S.data.me.owner;
    const ok = await confirmDialog(owner
      ? `Supprimer le groupe « ${S.data.group?.name || "C-Party"} » ? Toutes ses parties, jeux et joueurs seront effacés de ton iCloud, pour tous les membres. Tes autres groupes ne sont pas touchés. C'est définitif.`
      : `Quitter le groupe « ${S.data.group?.name || "C-Party"} » ? Tu pourras revenir seulement avec une nouvelle invitation.`,
      owner ? "Supprimer définitivement" : "Quitter");
    if (!ok) return;
    try {
      await S.store.leaveSpace(); S.cross = null; S.groups = null; go("#/");
      if (S.store.status()?.space) await reload(); else { S.data = null; render(); }
      toast(owner ? "Groupe supprimé" : "Tu as quitté le groupe");
    } catch (e) { toast(e.message, "error"); }
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
  if (t.dataset.syncComplete) { S.importer.sel.complete[t.dataset.syncComplete] = t.checked; return; }
  if (t.dataset.syncGone) { S.importer.sel.gone[t.dataset.syncGone] = t.checked; return; }
  if (t.dataset.copy) { (S.copySel ||= {})[t.dataset.copy] = t.checked; return; }
  if ("statKind" in t.dataset) { S.ui.statKind = t.value; const y = window.scrollY; render(); window.scrollTo(0, y); return; }
  if (t.dataset.actionChange === "status") { $("#lent-field").hidden = t.value !== "lent"; return; }
  if ("cover" in t.dataset && t.files?.[0] && S.gameDraft) {
    try {
      S.gameDraft.cover = await prepareCover(t.files[0]);
      $("#cover-preview").innerHTML = gameThumb(S.gameDraft, 96);
      $("[data-action=cover-remove]").hidden = false;
    } catch (err) { toast(err.message, "error"); }
    t.value = "";
    return;
  }
  if (("addPhotos" in t.dataset || "formPhotos" in t.dataset) && t.files?.length) {
    const files = [...t.files]; t.value = "";
    try {
      const list = await prepareAll(files);
      if ("formPhotos" in t.dataset) { S.form?.photos.push(...list); render(); return; }
      await uploadPhotos(t.dataset.addPhotos, list);
      toast(list.length > 1 ? `${list.length} photos ajoutées` : "Photo ajoutée");
      await reload();
    } catch (err) { toast(err.message, "error"); await reload(); }
    return;
  }
  if ("coversFile" in t.dataset && t.files?.[0]) {
    try {
      let data;
      try { data = JSON.parse(await t.files[0].text()); } catch { throw new Error("Fichier illisible."); }
      if (data?.format !== "c-party-pochettes" || !Array.isArray(data.items)) throw new Error("Ce n'est pas un fichier de pochettes C-Party.");
      const byBgg = new Map(S.data.games.filter((g) => g.bgg_id).map((g) => [Number(g.bgg_id), g]));
      const todo = [], kept = [], unknown = [];
      for (const it of data.items) {
        if (!/^data:image\/(jpeg|png|webp);base64,/.test(it.cover || "")) continue;
        const g = byBgg.get(Number(it.bgg_id));
        if (!g) unknown.push(it.name || it.bgg_id); else if (g.cover) kept.push(g.name); else todo.push({ g, cover: it.cover });
      }
      const extra = [kept.length ? `${plural(kept.length, "jeu a", "jeux ont")} déjà une pochette (inchangée).` : "", unknown.length ? `Absents de la ludothèque : ${unknown.join(", ")}.` : ""].filter(Boolean).join(" ");
      if (!todo.length) { toast(extra || "Aucune pochette à ajouter."); t.value = ""; return; }
      if (!(await confirmDialog(`Ajouter ${plural(todo.length, "pochette", "pochettes")} : ${todo.map((x) => x.g.name).join(", ")} ?${extra ? " " + extra : ""}`, "Ajouter"))) { t.value = ""; return; }
      for (const x of todo) await S.store.saveGame({ ...x.g, cover: x.cover });
      toast(plural(todo.length, "pochette ajoutée", "pochettes ajoutées"));
      await reload();
    } catch (err) { toast(err.message, "error"); }
    t.value = "";
    return;
  }
  if ("bggCsv" in t.dataset && t.files?.[0]) {
    try {
      const { readBggCollection } = await import("./bgg-csv.js");
      const { items, things } = readBggCollection(await t.files[0].text(), S.data.games);
      if (!items.length) throw new Error("Aucun jeu possédé dans ce fichier.");
      Object.assign(S.importer, { items, fileThings: new Map(things.map((x) => [x.bgg_id, x])), fileName: t.files[0].name, step: "pick", progress: "" });
      render();
    } catch (err) { toast(err.message, "error"); }
    t.value = "";
    return;
  }
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
      const pics = S.form?.photos || [];
      S.form = null;
      if (pics.length) {
        try { await uploadPhotos(id || payload.id, pics); }
        catch (err) { toast(`Partie enregistrée, mais photos non envoyées : ${err.message}`, "error"); await reload(); go(`#/plays/${id || payload.id}`); return; }
      }
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
    } else if (kind === "group-new") {
      if (!fd.name?.trim()) throw new Error("Donne un nom au groupe.");
      await S.store.createGroup({ name: fd.name.trim(), emoji: fd.emoji || "" });
      S.groups = null; S.cross = null;
      await reload(); go("#/more");
      toast(`Groupe « ${fd.name.trim()} » créé : invite ses membres`);
    } else if (kind === "group-info") {
      if (!fd.name?.trim()) throw new Error("Donne un nom au groupe.");
      await S.store.saveGroupInfo({ name: fd.name.trim(), emoji: fd.emoji ?? "" });
      S.groups = null; S.cross = null;
      toast("Groupe mis à jour"); await reload();
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
