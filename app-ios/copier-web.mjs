// Copie les fichiers du site (racine du dépôt) dans app-ios/www pour l'app iOS.
// Le site web n'a toujours aucune étape de build : ce script ne sert qu'à l'app native.
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, "..");
const www = join(ici, "www");
const fichiers = ["index.html", "manifest.webmanifest", "sw.js", "css", "js", "icons"];

rmSync(www, { recursive: true, force: true });
mkdirSync(www);
for (const f of fichiers) cpSync(join(racine, f), join(www, f), { recursive: true });
console.log("Site copié dans app-ios/www");
