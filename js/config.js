// Configuration de C-Party.
// Depuis le 24/11/2026, les vraies données sont dans iCloud (app iPhone). Supabase ne sert plus
// qu'au relais BoardGameGeek (URL + clé publique ci-dessous, utilisées par js/store-icloud.js).
// WEB_SUPABASE : false = le site web n'affiche que la démo ; true = ancien fonctionnement (comptes Supabase).
export const CONFIG = {
  SUPABASE_URL: "https://ygkadetthxhnneeeoqgx.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_hw2w3KWmUEJdHovgLsuszg_xczZVqlQ",  // clé publique, sans risque
  WEB_SUPABASE: false,
};
