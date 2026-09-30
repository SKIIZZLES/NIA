/**
 * Edge Function : live-token (sprint L1, lives LiveKit).
 *
 * Délivre un jeton LiveKit court (10 min) à un utilisateur NIA connecté :
 *   - role "publisher" : créateur du live uniquement (caméra + micro) ;
 *   - role "viewer"    : spectateur, abonnement seul, si l'appelant VOIT le
 *     live sous la RLS existante (lecture faite avec SON JWT, pas en
 *     service_role).
 * Aucune écriture en base : le statut 'live' vient de livekit-webhook (L2).
 * Hôte : la room est créée ici avec ses délais de fermeture (HOST_ROOM_SETTINGS).
 *
 * Entrée  : POST JSON { live_id: uuid, role: "publisher" | "viewer" }
 *           + Authorization: Bearer <JWT Supabase de l'utilisateur>
 * Sortie  : 200 { token, url, room, role, expires_in }
 * Erreurs : 400 bad_request · 401 unauthorized · 403 not_owner ·
 *           403 live_held · 404 not_found · 405 · 409 live_not_active ·
 *           409 live_not_started · 500 db_error ·
 *           503 not_configured
 *
 * Secrets (Dashboard → Edge Functions → Secrets, jamais dans le dépôt) :
 *   LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL (wss://…livekit.cloud)
 *   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS / SUPABASE_ANON_KEY (injectés automatiquement)
 *
 * Déploiement (vérification JWT de la passerelle ACTIVÉE, voir README.md) :
 *   supabase functions deploy live-token --project-ref odlmbiaocdonlovjepxn
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { AccessToken, RoomServiceClient, TrackSource } from 'npm:livekit-server-sdk@2.19.1';
import {
  HOST_ROOM_SETTINGS,
  bearerToken,
  decideGrant,
  isDenied,
  isLivekitConfigured,
  livekitHttpUrl,
  parseTokenRequest,
  pickPublicApiKey,
  type LiveRowLite,
} from './core.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function log(event: string, fields: Record<string, string | number | boolean>): void {
  // Codes courts uniquement : jamais de jeton, de JWT ni d'identifiant.
  console.log(JSON.stringify({ fn: 'live-token', event, ...fields }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const lkKey = (Deno.env.get('LIVEKIT_API_KEY') ?? '').trim();
  const lkSecret = (Deno.env.get('LIVEKIT_API_SECRET') ?? '').trim();
  const lkUrl = (Deno.env.get('LIVEKIT_URL') ?? '').trim();
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  // Clé publique du projet (voir pickPublicApiKey) : aucun droit par elle-même.
  const anonKey = pickPublicApiKey({
    publishableKeysJson: Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'),
    requestApiKey: req.headers.get('apikey'),
    anonKey: Deno.env.get('SUPABASE_ANON_KEY'),
  }) ?? '';

  if (!isLivekitConfigured({ key: lkKey, secret: lkSecret, url: lkUrl }) || !supabaseUrl || !anonKey) {
    log('rejected', { code: 'not_configured' });
    return json(503, { error: 'not_configured' });
  }

  const authHeader = req.headers.get('Authorization');
  const jwt = bearerToken(authHeader);
  if (!jwt) {
    log('rejected', { code: 'unauthorized' });
    return json(401, { error: 'unauthorized' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const parsed = parseTokenRequest(body);
  if (isDenied(parsed)) return json(parsed.status, { error: parsed.error });

  // Client « en tant qu'utilisateur » : toutes les lectures passent par la RLS.
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (userErr || !uid) {
    log('rejected', { code: 'unauthorized' });
    return json(401, { error: 'unauthorized' });
  }

  const { data: row, error: rowErr } = await sb
    .from('live_streams')
    .select('id, user_id, status, visibility, moderation_state')
    .eq('id', parsed.liveId)
    .maybeSingle();
  if (rowErr) {
    log('failed', { code: 'db_error', pg: String(rowErr.code ?? 'unknown').slice(0, 12) });
    return json(500, { error: 'db_error' });
  }

  const decision = decideGrant({
    userId: uid,
    role: parsed.role,
    liveId: parsed.liveId,
    live: (row as LiveRowLite | null) ?? null,
  });
  if (!decision.ok) {
    log('denied', { code: decision.error, role: parsed.role });
    return json(decision.status, { error: decision.error });
  }

  // Hôte : crée la room avec ses délais de fermeture (fin automatique). Si
  // elle existe déjà (reconnexion), LiveKit la renvoie telle quelle. En cas
  // d'échec, la room sera créée à la connexion avec les réglages par défaut.
  if (decision.role === 'publisher') {
    try {
      const rooms = new RoomServiceClient(livekitHttpUrl(lkUrl), lkKey, lkSecret);
      await rooms.createRoom({ name: decision.room, ...HOST_ROOM_SETTINGS });
    } catch {
      log('warn', { code: 'create_room_failed' });
    }
  }

  const at = new AccessToken(lkKey, lkSecret, {
    identity: decision.identity,
    ttl: decision.ttlSeconds,
  });
  at.addGrant({
    room: decision.grant.room,
    roomJoin: decision.grant.roomJoin,
    canSubscribe: decision.grant.canSubscribe,
    canPublish: decision.grant.canPublish,
    canPublishData: decision.grant.canPublishData,
    canPublishSources: decision.grant.canPublishSources.map((s) =>
      s === 'camera' ? TrackSource.CAMERA : TrackSource.MICROPHONE
    ),
    canUpdateOwnMetadata: decision.grant.canUpdateOwnMetadata,
  });
  const token = await at.toJwt();

  log('granted', { role: decision.role });
  return json(200, {
    token,
    url: lkUrl,
    room: decision.room,
    role: decision.role,
    expires_in: decision.ttlSeconds,
  });
});
