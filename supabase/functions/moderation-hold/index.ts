/**
 * Edge Function : moderation-hold (migration 017)
 *
 * Met à l'abri, dans le bucket privé `moderation-hold`, les fichiers des
 * vidéos masquées par la modération (le bucket `videos` est public), les
 * remet en place si le contenu est rétabli, les supprime à l'échéance
 * (90 jours, 180 si transmis aux autorités), et purge les pièces jointes des
 * signalements échues. Voir core.ts et README.md.
 *
 * Serveur uniquement : POST avec l'en-tête `x-moderation-secret` égal au
 * secret MODERATION_CRON_SECRET (≥ 32 caractères). Sinon 401 / 405 / 503.
 *
 * Secrets (Dashboard → Edge Functions → Secrets, jamais dans le dépôt) :
 *   MODERATION_CRON_SECRET     ≥ 32 caractères aléatoires
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (injectés sur hosted)
 *   MODERATION_BATCH           optionnel, défaut 5 (1–20)
 *
 * Déploiement (NE PAS exécuter sans validation, APRÈS 017) :
 *   supabase functions deploy moderation-hold --no-verify-jwt
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  isAuthorized,
  isSecretConfigured,
  makeHoldQueue,
  makeStorageGateway,
  processHolds,
  type RpcClientLike,
  type StorageClientLike,
} from './core.ts';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function log(event: string, fields: Record<string, string | number | boolean>): void {
  console.log(JSON.stringify({ fn: 'moderation-hold', event, ...fields }));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const secret = Deno.env.get('MODERATION_CRON_SECRET') ?? '';
  if (!isSecretConfigured(secret)) {
    log('rejected', { code: 'secret_not_configured' });
    return json(503, { error: 'not_configured' });
  }
  if (!isAuthorized(req.headers.get('x-moderation-secret'), secret)) {
    log('rejected', { code: 'unauthorized' });
    return json(401, { error: 'unauthorized' });
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!supabaseUrl || !serviceKey) {
    log('rejected', { code: 'service_env_missing' });
    return json(503, { error: 'not_configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const storage = makeStorageGateway(admin as unknown as StorageClientLike);
  const queue = makeHoldQueue(admin as unknown as RpcClientLike);

  const batchEnv = Number.parseInt(Deno.env.get('MODERATION_BATCH') ?? '5', 10);
  const batch = Number.isInteger(batchEnv) ? Math.min(Math.max(batchEnv, 1), 20) : 5;

  const summary = await processHolds(queue, storage, log, { batch, budgetMs: 110_000 });
  return json(summary.error ? 500 : 200, summary);
});
