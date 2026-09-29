/**
 * Edge Function : purge-user-storage
 *
 * Traite la file public.storage_purge_jobs (migration 014) : pour chaque job,
 * supprime via l'API Storage tous les objets sous `{user_id}/` du bucket
 * `videos`, vérifie qu'il ne reste rien, marque le job done (ou failed, avec
 * un code court, retenté plus tard avec backoff).
 *
 * Serveur uniquement. Appelée par un cron (pg_cron + pg_net) ou à la main,
 * en POST avec l'en-tête `x-purge-secret` égal au secret PURGE_CRON_SECRET.
 * Toute autre requête est rejetée (401 / 405 / 503).
 *
 * Secrets (Dashboard → Edge Functions → Secrets, jamais dans le dépôt) :
 *   PURGE_CRON_SECRET          ≥ 32 caractères aléatoires
 *   SUPABASE_URL               (injecté automatiquement sur hosted)
 *   SUPABASE_SERVICE_ROLE_KEY  (injecté automatiquement sur hosted)
 *   PURGE_BATCH                optionnel, défaut 3 (1–20)
 *
 * Déploiement (voir README.md du dossier — NE PAS exécuter sans validation) :
 *   supabase functions deploy purge-user-storage --no-verify-jwt
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  isAuthorized,
  isSecretConfigured,
  makeJobQueue,
  makeStorageGateway,
  processJobs,
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
  // Uniquement job id, compteurs, codes (voir core.ts).
  console.log(JSON.stringify({ fn: 'purge-user-storage', event, ...fields }));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const secret = Deno.env.get('PURGE_CRON_SECRET') ?? '';
  if (!isSecretConfigured(secret)) {
    log('rejected', { code: 'secret_not_configured' });
    return json(503, { error: 'not_configured' });
  }
  if (!isAuthorized(req.headers.get('x-purge-secret'), secret)) {
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
  const queue = makeJobQueue(admin as unknown as RpcClientLike);

  const batchEnv = Number.parseInt(Deno.env.get('PURGE_BATCH') ?? '3', 10);
  const batch = Number.isInteger(batchEnv) ? Math.min(Math.max(batchEnv, 1), 20) : 3;

  const summary = await processJobs(queue, storage, log, { batch, budgetMs: 110_000 });
  return json(summary.error ? 500 : 200, summary);
});
