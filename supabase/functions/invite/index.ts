// Supabase Edge Function « invite » — un gestionnaire invite un nouveau compte.
// POST { email, display_name, role: "admin" | "viewer", player_id?, redirect_to }
// La personne reçoit un e-mail avec un lien pour choisir son mot de passe.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Nouvelles clés Supabase (JSON { default: "sb_..." }), sinon anciennes clés.
function key(dict: string, legacy: string): string {
  try {
    const k = JSON.parse(Deno.env.get(dict) ?? "{}").default;
    if (k) return k;
  } catch { /* variable absente */ }
  const l = Deno.env.get(legacy);
  if (!l) throw new Error(`Clé ${dict} introuvable dans l'environnement`);
  return l;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const service = key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

    // 1. Vérifier que l'appelant est gestionnaire
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: who } = await caller.auth.getUser();
    if (!who?.user) return json({ error: "Connexion requise" }, 401);
    const { data: me } = await caller.from("profiles").select("role").eq("id", who.user.id).single();
    if (me?.role !== "admin") return json({ error: "Réservé aux gestionnaires" }, 403);

    // 2. Inviter
    const { email, display_name, role, player_id, redirect_to } = await req.json();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Adresse e-mail invalide" }, 400);
    const admin = createClient(url, service);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
      data: { display_name: display_name || email.split("@")[0] },
      redirectTo: redirect_to,
    });
    if (error) return json({ error: error.message }, 400);

    // 3. Appliquer le rôle et le lien vers la fiche joueur
    await admin.from("profiles").update({
      role: role === "admin" ? "admin" : "viewer",
      player_id: player_id || null,
      display_name: display_name || email.split("@")[0],
    }).eq("id", data.user.id);

    return json({ ok: true, id: data.user.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
