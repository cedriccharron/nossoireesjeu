// Lecture d'un export CSV de collection BoardGameGeek : node tests/bgg-csv.test.mjs
import { readBggCollection, parseCsv } from "../js/bgg-csv.js";
const ok = (c, m) => { if (!c) { console.error("ÉCHEC :", m); process.exit(1); } console.log("ok -", m); };
const csv = `objectname,objectid,rating,numplays,weight,own,fortrade,want,baverage,average,avgweight,rank,numowned,objecttype,originalname,minplayers,maxplayers,playingtime,maxplaytime,minplaytime,yearpublished,itemtype
Everdell,199792,8,3,0,1,0,0,7.6,8.0,2.8,40,50000,thing,,1,4,80,80,40,2018,standalone
"Everdell: Pearlbrook",257700,0,0,0,1,0,0,7.5,8.1,2.9,0,9000,thing,,1,4,80,80,40,2020,expansion
"Les Aventuriers du Rail : Europe",14996,7,2,0,1,0,0,7.4,7.5,"1,9",200,90000,thing,Ticket to Ride: Europe,2,5,60,60,30,2005,standalone
Wingspan,266192,0,0,0,0,0,1,8,8,2.4,20,100000,thing,,1,5,70,70,40,2019,standalone
`;
const { items, things } = readBggCollection(csv);
ok(items.length === 3, "3 jeux possédés (le souhait est ignoré)");
const exp = things.find((t) => t.bgg_id === 257700);
ok(exp.expansion && exp.base_bgg_ids[0] === 199792, "extension rattachée à Everdell par son nom");
const ttr = things.find((t) => t.bgg_id === 14996);
ok(ttr.bgg_name === "Ticket to Ride: Europe" && ttr.names.includes("Les Aventuriers du Rail : Europe"), "nom d'origine et nom de la collection");
ok(ttr.weight === 1.9 && ttr.min_time === 30 && ttr.max_time === 60 && ttr.min_players === 2, "difficulté, durée et joueurs lus");
ok(parseCsv("a;b\n1;2").length === 2 && parseCsv('x,"a,b"\n')[0][1] === "a,b", "séparateurs et guillemets");
let err = null; try { readBggCollection("nom;prix\nx;1"); } catch (e) { err = e.message; }
ok(err?.includes("BoardGameGeek"), "fichier étranger refusé");
const known = readBggCollection(csv.split("\n").filter((l) => !l.startsWith("Everdell,")).join("\n"), [{ bgg_id: 199792, name: "Everdell", base_game_id: null }]);
ok(known.things.find((t) => t.bgg_id === 257700).base_bgg_ids[0] === 199792, "extension rattachée à un jeu déjà dans la ludothèque");
console.log("\nTous les tests passent.");
