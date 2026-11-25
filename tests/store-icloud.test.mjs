// Test du stockage iCloud (js/store-icloud.js) avec un faux iCloud en mémoire.
// Lancer : node tests/store-icloud.test.mjs   (export-demo.csv = données fictives de la démo)

import { readFileSync } from "node:fs";
// Faux module natif : un iCloud en mémoire, avec écritures atomiques et droits.
const cloud = new Map(); let calls = 0; let permission = "readWrite", owner = true, space = true;
let lastInvite = null;
let participantsList = [{ user: "_moi", name: "Cédric", owner: true, permission: "readWrite", accepted: true }, { user: "_ami", name: "Léa", owner: false, permission: "readOnly", accepted: false }];
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { CloudStore: {
  addListener() {},
  async status() { return { account: "available", user: "_moi", space: space ? { owner, permission } : undefined }; },
  async createSpace() { space = true; },
  async fetchAll() { return { records: [...cloud.values()].map(({ image, ...r }) => r) }; }, // l'image n'est pas téléchargée
  async modify({ save, remove }) {
    calls++;
    if (!owner && permission !== "readWrite") throw new Error("Tu n'as pas le droit de modifier ces données");
    if (save.length > 400 || remove.length > 400) throw new Error("trop d'enregistrements");
    save.forEach((r) => cloud.set(r.name, r)); remove.forEach((n) => cloud.delete(n));
  },
  async invite({ role }) { lastInvite = role; },
  async image({ name }) { const r = cloud.get(name); if (!r?.image) throw new Error("Photo introuvable"); return { data: r.image }; },
  async participants() { return { participants: participantsList }; },
}}}};
const { createICloudStore, tablesFromExport, icloudAvailable } = await import("../js/store-icloud.js");
const ok = (c, m) => { if (!c) { console.error("ÉCHEC :", m); process.exit(1); } console.log("ok -", m); };

ok(icloudAvailable(), "module natif détecté");
const s = await createICloudStore(); await s.init();
const tables = tablesFromExport(readFileSync(new URL("./export-demo.csv", import.meta.url), "utf8"));
const r = await s.importExport(tables);
ok(r.plays === 46 && r.games === 8 && r.players === 5 && r.history === 46, "import complet : " + JSON.stringify(r));
let d = await s.loadAll();
ok(d.plays.every((p) => p.players.length > 0), "chaque partie a ses joueurs");
ok(d.plays.reduce((n, p) => n + p.players.length, 0) === 124, "124 participations retrouvées");
ok(d.plays.reduce((n, p) => n + p.expansions.length, 0) === 3, "3 extensions jouées retrouvées");
ok(d.me.role === "admin" && d.me.owner, "propriétaire = gestionnaire");
ok(d.profiles.find((p) => p.id === "_ami").role === "viewer" && d.profiles.find((p) => p.id === "_ami").pending, "invité en lecture seule, invitation en attente");
let err = null; try { await s.importExport(tables); } catch (e) { err = e.message; }
ok(err && err.includes("déjà"), "second import refusé : " + err);

const g = d.games.find((x) => !x.base_game_id), pl = d.players.slice(0, 2).map((p, i) => ({ player_id: p.id, score: 10 - i, rank: i + 1, team: null, is_winner: i === 0 }));
calls = 0;
const id = await s.savePlay({ game_id: g.id, played_at: "2026-11-24", mode: "competitive", coop_result: null, is_learning: false, duration_min: 30, notes: null, players: pl, expansions: [] });
ok(calls === 1, "création = 1 seule opération atomique (partie + historique)");
await s.savePlay({ id, game_id: g.id, played_at: "2026-11-24", mode: "competitive", coop_result: null, is_learning: false, duration_min: 45, notes: "test", players: pl, expansions: [] });
let h = await s.history(id);
ok(h.length === 2 && h[0].action === "update" && h[0].before.duration_min === 30 && h[0].after.duration_min === 45, "modification tracée avec avant/après");
await s.deletePlay(id);
const del = await s.deletedPlays();
ok(del[0].play_id === id, "partie supprimée visible dans le journal");
const back = await s.restorePlay(del[0].id);
d = await s.loadAll();
ok(back === id && d.plays.some((p) => p.id === id && p.duration_min === 45), "partie restaurée à l'identique");
ok((await s.history(id))[0].action === "restore", "restauration tracée");

err = null; try { await s.deletePlayer(pl[0].player_id); } catch (e) { err = e.message; }
ok(err && err.includes("archive"), "suppression d'un joueur avec parties refusée");
await s.updateProfile("_ami", { player_id: pl[1].player_id });
d = await s.loadAll();
ok(d.profiles.find((p) => p.id === "_ami").player_id === pl[1].player_id, "fiche joueur liée à un membre");
const base = d.games.find((x) => d.games.some((e) => e.base_game_id === x.id));
const nPlays = d.plays.filter((p) => p.game_id === base.id).length;
await s.deleteGame(base.id);
d = await s.loadAll();
ok(!d.games.some((x) => x.id === base.id || x.base_game_id === base.id), "jeu et extensions supprimés");
ok((await s.deletedPlays()).length >= nPlays, "parties du jeu supprimé journalisées (" + nPlays + ")");

// Joueur en lecture seule : aucune écriture possible
owner = false; permission = "readOnly"; await s.refreshStatus(); d = await s.loadAll();
ok(d.me.role === "viewer", "invité lecture seule = joueur");
err = null; try { await s.savePlayer({ name: "Pirate" }); } catch (e) { err = e.message; }
ok(err === "Action réservée aux gestionnaires", "écriture refusée au joueur");
// Bug du 24/11 : une fois le partage créé, iCloud nomme le propriétaire « __defaultOwner__ ».
owner = true; permission = "readWrite"; await s.refreshStatus();
participantsList = [{ user: "__defaultOwner__", name: "", owner: true, permission: "readWrite", accepted: true },
  { user: "_ami", name: "Léa", owner: false, permission: "readOnly", accepted: true }];
await s.loadAll();
await s.updateMyName("Cédric");
d = await s.loadAll();
ok(d.me.display_name === "Cédric", "nom affiché du propriétaire conservé après partage (" + d.me.display_name + ")");
ok(d.profiles.filter((p) => p.owner).length === 1 && d.profiles.find((p) => p.owner).id === "_moi", "propriétaire listé une seule fois, sous son vrai identifiant");
await s.updateProfile(d.me.id, { player_id: d.players[0].id });
d = await s.loadAll();
ok(d.me.player_id === d.players[0].id && d.me.display_name === "Cédric", "fiche liée sans perdre le nom");
await s.invite({ role: "viewer" }); ok(lastInvite === "readOnly", "inviter un joueur = lecture seule");
await s.invite({ role: "admin" }); ok(lastInvite === "readWrite", "inviter un gestionnaire = modifications autorisées");

// Photos : vignette dans le json, image complète à part, lue à la demande
const pid = d.plays[0].id;
await s.addPhotos(pid, [{ full: "data:image/jpeg;base64,QUJD", thumb: "data:image/jpeg;base64,dA==" }, { full: "data:image/jpeg;base64,REVG", thumb: "data:image/jpeg;base64,dQ==" }]);
const phRec = [...cloud.values()].filter((r) => r.type === "Photo");
ok(phRec.length === 2 && phRec.every((r) => r.image && !JSON.parse(r.json).full), "2 photos : image en pièce jointe, vignette dans le json");
const s2 = await createICloudStore(); await s2.init(); d = await s2.loadAll();
ok(d.plays.find((p) => p.id === pid).photo_count === 2, "nombre de photos sur la partie");
const phs = await s2.photos(pid);
ok(phs.length === 2 && phs[0].thumb.startsWith("data:image/jpeg"), "vignettes lues sans télécharger les images");
ok((await s2.photoFull(phs[1].id)) === "data:image/jpeg;base64,REVG", "photo complète téléchargée à la demande");
await s2.deletePhoto(phs[0].id);
ok((await s2.photos(pid)).length === 1 && !cloud.has(`ph-${phs[0].id}`), "photo supprimée");
owner = false; permission = "readOnly"; await s2.refreshStatus();
err = null; try { await s2.addPhotos(pid, [{ full: "data:image/jpeg;base64,QQ==", thumb: "x" }]); } catch (e) { err = e.message; }
ok(err === "Action réservée aux gestionnaires", "joueur : ajout de photo refusé");

// Sauvegarde complète (Plus → Exporter) : réimportable dans un groupe vide, sans perte
const { backupCsv, playsCsv } = await import("../js/export.js");
owner = true; permission = "readWrite"; await s2.refreshStatus();
const before = await s2.loadAll();
const hist = (await Promise.all(before.plays.map((p) => s2.history(p.id)))).flat();
const delAll = await s2.deletedPlays();
const csv = backupCsv(before, [...hist, ...delAll.filter((x) => !hist.some((h) => h.id === x.id))]);
ok(playsCsv(before).split("\r\n")[0].startsWith("\uFEFFDate;Jeu;"), "export tableur : en-tête avec « ; »");
cloud.clear();
const s3 = await createICloudStore(); await s3.init();
await s3.importExport(tablesFromExport(csv));
const after = await s3.loadAll();
const norm = (x) => JSON.stringify([...x].map(({ photo_count, ...p }) => p).sort((a, b) => a.id.localeCompare(b.id)));
ok(norm(after.plays) === norm(before.plays) && after.games.length === before.games.length && after.players.length === before.players.length,
  "sauvegarde réimportée à l'identique (" + after.plays.length + " parties)");
ok((await s3.history(before.plays[0].id)).length === (await s2.history(before.plays[0].id)).length, "historique réimporté");
console.log("\nTous les tests passent.");
