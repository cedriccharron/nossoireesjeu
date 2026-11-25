// Exports CSV et partage de fichiers (export, carte résultat).
//
// Deux exports :
//  - sauvegarde complète : même format que supabase/export.sql (colonnes table ; id ; donnees en JSON),
//    donc réimportable dans un groupe iCloud vide (Plus → Importer) ;
//  - parties pour tableur : une ligne par joueur et par partie, séparateur « ; » (Excel, Numbers).
// Les photos des parties ne sont pas incluses (elles restent dans iCloud).
import { MODES } from "./util.js";

const BOM = "﻿"; // pour qu'Excel lise bien les accents
const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (values) => values.map(cell).join(";");

// history : historique de toutes les parties (vivantes et supprimées), déjà chargé par l'app.
export function backupCsv(data, history) {
  const rows = [];
  const add = (table, id, obj) => rows.push(line([rows.length + 1, table, id, JSON.stringify(obj)]));
  data.players.forEach((p) => add("players", p.id, p));
  data.games.forEach((g) => add("games", g.id, g));
  data.plays.forEach(({ players, expansions, photo_count, ...p }) => {
    add("plays", p.id, p);
    players.forEach((x) => add("play_players", `${p.id}:${x.player_id}`, { play_id: p.id, ...x }));
    (expansions || []).forEach((e) => add("play_expansions", `${p.id}:${e}`, { play_id: p.id, game_id: e }));
  });
  history.forEach((h) => add("play_history", h.id, h));
  data.profiles.forEach((p) => add("profiles", p.id, { id: p.id, email: p.email || null, display_name: p.display_name || null, role: p.role, player_id: p.player_id || null }));
  return BOM + [line(["ordre", "table", "id", "donnees"]), ...rows].join("\r\n") + "\r\n";
}

export function playsCsv(data) {
  const game = new Map(data.games.map((g) => [g.id, g]));
  const player = new Map(data.players.map((p) => [p.id, p]));
  const num = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));
  const rows = [...data.plays].sort((a, b) => a.played_at.localeCompare(b.played_at)).flatMap((p) =>
    [...p.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((x) => line([
      p.played_at, game.get(p.game_id)?.name || "Jeu supprimé",
      (p.expansions || []).map((e) => game.get(e)?.name).filter(Boolean).join(", "),
      MODES[p.mode] || p.mode, p.is_learning ? "oui" : "non", p.duration_min ?? "",
      player.get(x.player_id)?.name || "?", x.team || "", num(x.score), x.rank ?? "",
      p.mode === "coop" || p.mode === "solo" ? (p.coop_result === "win" ? "victoire" : "défaite") : (x.is_winner ? "oui" : "non"),
      p.notes || "",
    ])));
  return BOM + [line(["Date", "Jeu", "Extensions", "Mode", "Apprentissage", "Durée (min)", "Joueur", "Équipe", "Score", "Rang", "Gagnant / résultat", "Commentaire"]), ...rows].join("\r\n") + "\r\n";
}

const toBase64 = (blob) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1]);
  r.onerror = () => ko(new Error("Fichier illisible"));
  r.readAsDataURL(blob);
});

// App iPhone : feuille de partage d'iOS. Navigateur : partage web si possible, sinon téléchargement.
export async function shareFile(name, blob) {
  const native = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.CloudStore;
  if (native) return native.shareFile({ name, data: await toBase64(blob) });
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] }) && matchMedia("(hover: none)").matches) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
