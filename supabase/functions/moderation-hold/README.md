# Edge Function `moderation-hold` (migration 017)

> ⚠️ Rien de ce qui suit n'a été exécuté. À faire **après** application de 017,
> dans cet ordre : secret → déploiement → test manuel → cron.

## Rôle

Le bucket `videos` est **public** : masquer une vidéo en base (RLS) ne coupe
pas son URL directe. Ce worker traite la file `public.moderation_file_holds` :

| action    | quand                                    | effet                                                                 |
|-----------|------------------------------------------|-----------------------------------------------------------------------|
| `hold`    | vidéo masquée (P0, 3 signaleurs, décision) | copie vers `moderation-hold/{owner}/{video}/{i}_{nom}`, vérifie, puis retire de `videos` |
| `release` | contenu rétabli (`no_violation`, `content_restored`) | recopie au même chemin dans `videos`, vérifie, puis supprime la copie |
| `purge`   | échéance (90 j, 180 j si transmis aux autorités) | supprime la copie (et tout reste public)                             |

Il purge aussi les **pièces jointes** échues du bucket privé `report-evidence`
(`evidence_due_for_purge` → suppression → `evidence_mark_purged`).

Le bucket `moderation-hold` est privé ; seuls les modérateurs peuvent lire
(policy `moderation_hold_storage_select_mod`), via le Dashboard ou une URL
signée. Journaux : identifiants de vidéo, compteurs, codes — jamais de chemin
ni d'e-mail.

Une suppression de compte pendant la mise à l'abri est gérée : le job
`purge-user-storage` est retardé de 30 min tant qu'une copie reste à faire,
et la copie privée est gardée jusqu'à l'échéance.

## 1. Secret

Dashboard → Edge Functions → Secrets :

- `MODERATION_CRON_SECRET` : ≥ 32 caractères aléatoires (`openssl rand -hex 32`)
- `MODERATION_BATCH` (optionnel, défaut 5)

## 2. Déploiement

```bash
supabase functions deploy moderation-hold --no-verify-jwt --project-ref odlmbiaocdonlovjepxn
```

`--no-verify-jwt` : l'appel est authentifié par l'en-tête
`x-moderation-secret` (comme `purge-user-storage`), pas par un JWT.

## 3. Test manuel

```bash
curl -sS -X POST "https://odlmbiaocdonlovjepxn.supabase.co/functions/v1/moderation-hold" \
  -H "x-moderation-secret: $MODERATION_CRON_SECRET" -H "Content-Type: application/json" -d '{}'
# → {"claimed":0,"done":0,"failed":0,"jobs":[],"evidencePurged":0}
```

## 4. Planification (pg_cron + pg_net + Vault)

```sql
-- Une seule fois (nia_project_url existe déjà si purge-user-storage est planifiée) :
select vault.create_secret('<secret>', 'nia_moderation_cron_secret');

-- Toutes les 5 minutes :
select cron.schedule(
  'nia-moderation-hold',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'nia_project_url')
           || '/functions/v1/moderation-hold',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-moderation-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nia_moderation_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

## 5. Suivi

```sql
select video_id, desired, actual, attempts, last_error, not_before, purge_after
  from public.moderation_file_holds
 where desired is distinct from (case actual when 'held' then 'held' when 'public' then 'visible' end)
    or last_error is not null
 order by updated_at desc;
```

Après 8 échecs, une ligne n'est plus réclamée : corriger la cause puis
`update public.moderation_file_holds set attempts = 0, not_before = now() where video_id = '…';`

## Limites connues

- Entre le masquage et le passage du cron (≤ 5 min), l'URL publique reste
  valable ; un CDN peut aussi garder le fichier en cache quelque temps.
- Tant que la fonction n'est pas déployée, masquer une vidéo la retire de
  l'app (RLS) mais pas du bucket public.
