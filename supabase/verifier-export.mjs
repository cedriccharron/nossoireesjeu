// Vérifie un export CSV produit par supabase/export.sql.
// Usage : node supabase/verifier-export.mjs export/<fichier>.csv
import { readFileSync } from "node:fs";

function lireCsv(texte) {
  const lignes = []; let champ = "", ligne = [], guillemets = false;
  const sep = texte.split("\n", 1)[0].includes(";") && !texte.split("\n", 1)[0].includes(",") ? ";" : ",";
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ); champ = "";
      if (ligne.some((v) => v !== "")) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  if (champ !== "" || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

const fichier = process.argv[2];
if (!fichier) { console.error("Indique le fichier CSV à vérifier."); process.exit(1); }
const [entete, ...lignes] = lireCsv(readFileSync(fichier, "utf8").replace(/^﻿/, ""));
const col = (n) => entete.indexOf(n);
for (const n of ["table", "id", "donnees"]) if (col(n) < 0) { console.error(`Colonne « ${n} » absente. En-tête lu : ${entete.join(" | ")}`); process.exit(1); }

const parTable = {}; const erreurs = [];
for (const [i, l] of lignes.entries()) {
  const t = l[col("table")];
  try { (parTable[t] ??= []).push(JSON.parse(l[col("donnees")])); }
  catch { erreurs.push(`ligne ${i + 2} (${t}) : JSON illisible`); }
}
const ids = (t) => new Set((parTable[t] || []).map((r) => r.id));
const joueurs = ids("players"), jeux = ids("games"), parties = ids("plays");
for (const g of parTable.games || []) if (g.base_game_id && !jeux.has(g.base_game_id)) erreurs.push(`extension « ${g.name} » : jeu de base absent`);
for (const p of parTable.plays || []) if (!jeux.has(p.game_id)) erreurs.push(`partie ${p.id} : jeu absent`);
for (const pp of parTable.play_players || []) {
  if (!parties.has(pp.play_id)) erreurs.push(`participation : partie ${pp.play_id} absente`);
  if (!joueurs.has(pp.player_id)) erreurs.push(`participation : joueur ${pp.player_id} absent`);
}
for (const pe of parTable.play_expansions || []) if (!parties.has(pe.play_id) || !jeux.has(pe.game_id)) erreurs.push(`extension jouée ${pe.play_id}:${pe.game_id} : lien cassé`);

console.log("Lignes par table :");
for (const t of ["players", "games", "plays", "play_players", "play_expansions", "profiles", "play_history"])
  console.log(`  ${t.padEnd(16)} ${(parTable[t] || []).length}`);
const autres = Object.keys(parTable).filter((t) => !["players", "games", "plays", "play_players", "play_expansions", "profiles", "play_history"].includes(t));
if (autres.length) console.log("Tables inattendues :", autres.join(", "));
console.log(erreurs.length ? `\n${erreurs.length} problème(s) :\n  ` + erreurs.slice(0, 20).join("\n  ") : "\nAucun problème : le fichier est complet et cohérent.");
process.exit(erreurs.length ? 2 : 0);
