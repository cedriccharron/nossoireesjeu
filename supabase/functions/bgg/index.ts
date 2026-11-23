// Supabase Edge Function « bgg » — relais vers l'API XML de BoardGameGeek.
// Le jeton BGG reste côté serveur. Appel en POST (supabase.functions.invoke) :
//   { "q": "Azul" }               -> [{ id, name, year, expansion }]
//   { "ids": [230802, 13] }       -> [fiche jeu, ...]   (20 maximum par appel)
//   { "collection": "pseudo" }    -> { pending } ou { items: [{ id, expansion }] }
// Secret requis : BGG_TOKEN   (supabase secrets set BGG_TOKEN=...)

import { XMLParser } from "npm:fast-xml-parser@4.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const BGG = "https://boardgamegeek.com/xmlapi2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const num = (x: any) => {
  const n = Number(x?.value ?? x);
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// Familles BGG (classements « family ») traduites en français
const FAMILIES: Record<string, string> = {
  strategygames: "Stratégie",
  familygames: "Famille",
  partygames: "Ambiance",
  thematic: "Thématique",
  wargames: "Wargame",
  abstracts: "Abstrait",
  childrensgames: "Enfants",
  cgs: "Jeu de cartes évolutif",
};

async function bgg(path: string, waitForQueue = true): Promise<any> {
  const token = Deno.env.get("BGG_TOKEN");
  if (!token) throw new Error("Secret BGG_TOKEN manquant dans Supabase");
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(`${BGG}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 202) {                     // requête mise en file par BGG
      if (!waitForQueue) return { pending: true };
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (r.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    if (r.status === 401 || r.status === 403) throw new Error("Jeton BGG refusé : vérifie le secret BGG_TOKEN");
    if (!r.ok) throw new Error(`BGG a répondu ${r.status}`);
    return parser.parse(await r.text());
  }
  return { pending: true };
}

async function search(q: string) {
  const x = await bgg(`search?type=boardgame,boardgameexpansion&query=${encodeURIComponent(q)}`);
  return arr(x?.items?.item)
    .map((it: any) => ({
      id: Number(it.id),
      name: String(arr(it.name).find((n: any) => n.type === "primary")?.value ?? arr(it.name)[0]?.value ?? ""),
      year: num(it.yearpublished),
      expansion: it.type === "boardgameexpansion",
    }))
    .slice(0, 30);
}

function toGame(it: any) {
  const links = arr(it.link);
  const pick = (type: string) => links.filter((l: any) => l.type === type && l.inbound !== "true").map((l: any) => String(l.value));
  const ratings = it.statistics?.ratings ?? {};
  const types = arr(ratings.ranks?.rank)
    .filter((r: any) => r.type === "family")
    .map((r: any) => FAMILIES[r.name] ?? String(r.friendlyname).replace(/ Rank$/, ""));
  const names = arr(it.name);
  const weight = num(ratings.averageweight);
  const isExp = it.type === "boardgameexpansion";
  const baseIds = isExp
    ? links.filter((l: any) => l.type === "boardgameexpansion" && l.inbound === "true").map((l: any) => Number(l.id))
    : [];
  return {
    bgg_id: Number(it.id),
    bgg_name: String(names.find((n: any) => n.type === "primary")?.value ?? ""),
    names: names.map((n: any) => String(n.value)),
    expansion: isExp,
    base_bgg_ids: baseIds,
    year: num(it.yearpublished),
    image_url: it.image ?? null,
    thumbnail_url: it.thumbnail ?? null,
    types,
    categories: pick("boardgamecategory"),
    mechanics: pick("boardgamemechanic"),
    designers: pick("boardgamedesigner").filter((d) => d !== "(Uncredited)"),
    publisher: pick("boardgamepublisher")[0] ?? null,
    min_players: num(it.minplayers),
    max_players: num(it.maxplayers),
    min_time: num(it.minplaytime) ?? num(it.playingtime),
    max_time: num(it.maxplaytime) ?? num(it.playingtime),
    weight: weight ? Math.round(weight * 100) / 100 : null,
    cooperative: pick("boardgamemechanic").includes("Cooperative Game"),
    solo_only: num(it.maxplayers) === 1,
  };
}

async function things(ids: number[]) {
  const clean = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 20);
  if (!clean.length) return [];
  const x = await bgg(`thing?stats=1&id=${clean.join(",")}`);
  return arr(x?.items?.item).map(toGame);
}

async function collection(user: string) {
  const u = encodeURIComponent(user.trim());
  // Deux requêtes : jeux de base puis extensions (BGG mélange sinon les deux).
  const base = await bgg(`collection?username=${u}&own=1&subtype=boardgame&excludesubtype=boardgameexpansion&brief=1`, false);
  if (base.pending) return { pending: true };
  if (base?.errors) throw new Error("Pseudo BGG introuvable");
  const exp = await bgg(`collection?username=${u}&own=1&subtype=boardgameexpansion&brief=1`, false);
  if (exp.pending) return { pending: true };
  const items = [
    ...arr(base?.items?.item).map((i: any) => ({ id: Number(i.objectid), name: String(i.name?.["#text"] ?? i.name ?? ""), expansion: false })),
    ...arr(exp?.items?.item).map((i: any) => ({ id: Number(i.objectid), name: String(i.name?.["#text"] ?? i.name ?? ""), expansion: true })),
  ];
  return { items };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Seuls les comptes connectés à NosSoireesJeu peuvent utiliser le jeton BGG.
async function signedIn(req: Request): Promise<boolean> {
  let pub = "";
  try { pub = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default ?? ""; } catch { /* absent */ }
  pub ||= Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, pub, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  return !!data?.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!(await signedIn(req))) return json({ error: "Connexion requise" }, 401);
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const q = body.q ?? url.searchParams.get("q");
    const ids = body.ids ?? (url.searchParams.get("ids") ?? url.searchParams.get("id") ?? "").split(",").filter(Boolean);
    const coll = body.collection ?? url.searchParams.get("collection");
    if (q) return json(await search(String(q)));
    if (coll) return json(await collection(String(coll)));
    if (ids.length) return json(await things(ids));
    return json({ error: "Paramètre q, ids ou collection requis" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
