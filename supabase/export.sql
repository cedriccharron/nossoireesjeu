-- Export complet des données C-Party en un seul tableau (à télécharger en CSV).
-- À lancer dans Supabase > SQL Editor, puis « Download CSV » (ou Export > CSV).
-- Lecture seule : ne modifie rien.
--
-- Une ligne par enregistrement :
--   ordre  : ordre conseillé pour la réimportation (joueurs et jeux avant les parties)
--   table  : table d'origine
--   id     : identifiant (ou clé composée « partie:joueur » / « partie:extension »)
--   donnees: toutes les colonnes, au format JSON (aucune perte, même pour les listes)
--
-- Les jeux de base passent avant les extensions (base_game_id), pour pouvoir les relier.

select * from (
  select 1 as ordre, 'players' as "table", id::text as id, to_jsonb(t)::text as donnees
    from public.players t
  union all
  select case when base_game_id is null then 2 else 3 end, 'games', id::text, to_jsonb(t)::text
    from public.games t
  union all
  select 4, 'plays', id::text, to_jsonb(t)::text
    from public.plays t
  union all
  select 5, 'play_players', play_id::text || ':' || player_id::text, to_jsonb(t)::text
    from public.play_players t
  union all
  select 6, 'play_expansions', play_id::text || ':' || game_id::text, to_jsonb(t)::text
    from public.play_expansions t
  union all
  select 7, 'profiles', id::text, to_jsonb(t)::text
    from public.profiles t
  union all
  select 8, 'play_history', id::text, to_jsonb(t)::text
    from public.play_history t
) export
order by ordre, "table", id;

-- Contrôle : nombre de lignes par table, à comparer avec le fichier téléchargé.
-- (Sélectionne seulement ce bloc et lance-le séparément.)
-- select 'players' t, count(*) from public.players union all
-- select 'games', count(*) from public.games union all
-- select 'plays', count(*) from public.plays union all
-- select 'play_players', count(*) from public.play_players union all
-- select 'play_expansions', count(*) from public.play_expansions union all
-- select 'profiles', count(*) from public.profiles union all
-- select 'play_history', count(*) from public.play_history;
