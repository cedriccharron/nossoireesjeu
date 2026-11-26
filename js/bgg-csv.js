// Lecture du fichier CSV exporté depuis la collection BoardGameGeek (site BGG → Collection → Export).
// Permet de synchroniser la ludothèque sans l'API BGG (pas de jeton, pas de serveur).
// Colonnes utilisées : objectname, originalname, objectid, own, itemtype, yearpublished,
// minplayers, maxplayers, playingtime, minplaytime, maxplaytime, avgweight.
// Le fichier ne contient ni images, ni mécaniques, ni lien extension → jeu de base :
// le jeu de base d'une extension est deviné par son nom (« Everdell: Pearlbrook » → « Everdell »).

// Découpe un CSV (guillemets, retours à la ligne dans une cellule). Séparateur « , » ou « ; » (fichier réenregistré par Excel).
export function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const baseName = (n) => String(n || "").split(/\s*[:–—]\s+|\s+-\s+/)[0];
const norm = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Renvoie { items, things } au même format que l'API (S.store.bgg.collection / things).
// knownGames : jeux déjà dans C-Party (pour rattacher une extension à un jeu de base existant).
export function readBggCollection(text, knownGames = []) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("Fichier vide.");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  if (col("objectid") < 0 || col("objectname") < 0) {
    throw new Error("Ce fichier n'est pas un export de collection BoardGameGeek (colonnes objectid / objectname absentes).");
  }
  const get = (r, name) => { const i = col(name); return i < 0 ? "" : (r[i] ?? "").trim(); };
  const seen = new Set();
  const things = [];
  for (const r of rows.slice(1)) {
    const id = int(get(r, "objectid"));
    if (!id || seen.has(id)) continue;
    if (col("own") >= 0 && get(r, "own") !== "1") continue; // seulement les jeux possédés
    seen.add(id);
    const name = get(r, "objectname");
    const original = get(r, "originalname");
    const play = int(get(r, "playingtime"));
    things.push({
      bgg_id: id,
      bgg_name: original || name,
      names: [...new Set([name, original].filter(Boolean))],
      year: int(get(r, "yearpublished")),
      min_players: int(get(r, "minplayers")),
      max_players: int(get(r, "maxplayers")),
      min_time: int(get(r, "minplaytime")) ?? play,
      max_time: int(get(r, "maxplaytime")) ?? play,
      weight: num(get(r, "avgweight")),
      expansion: /expansion/i.test(get(r, "itemtype") || get(r, "objecttype")) && !/standalone/i.test(get(r, "itemtype")),
      base_bgg_ids: [],
      image_url: null, thumbnail_url: null, types: [], categories: [], mechanics: [], designers: [], publisher: null,
    });
  }
  // Jeu de base deviné par le début du nom, parmi le fichier puis la ludothèque.
  const bases = [
    ...things.filter((t) => !t.expansion).flatMap((t) => t.names.map((n) => [norm(n), t.bgg_id])),
    ...knownGames.filter((g) => g.bgg_id && !g.base_game_id).flatMap((g) => [g.name, g.bgg_name].filter(Boolean).map((n) => [norm(n), g.bgg_id])),
  ];
  for (const t of things.filter((x) => x.expansion)) {
    const keys = t.names.map((n) => norm(baseName(n)));
    const hit = bases.find(([k]) => k && keys.includes(k));
    if (hit) t.base_bgg_ids = [hit[1]];
  }
  const items = things.map((t) => ({ id: t.bgg_id, name: t.names[0] || t.bgg_name, expansion: t.expansion }));
  return { items, things };
}
