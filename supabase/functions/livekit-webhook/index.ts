/**
 * Edge Function : livekit-webhook (sprint L2, lives LiveKit).
 *
 * Reçoit les webhooks de LiveKit Cloud et tient `public.live_streams` à jour
 * en service_role, via la RPC live_webhook_apply (migration 019) :
 *   - hôte connecté (participant_joined / track_published) → status 'live',
 *     started_at, provider 'livekit', provider_stream_id = room ;
 *   - participant_joined / participant_left → viewer_count (recompté via
 *     RoomService.listParticipants : idempotent) et peak_viewer_count ;
 *   - hôte parti → host_left_at ; fin automatique après HOST_GRACE_SECONDS
 *     (live_sweep_stale, appelée à chaque événement) ;
 *   - room_finished → 'ended' (room_closed).
 * Rooms inconnues (autre préfixe, live absent) : 200 et rien d'autre.
 *
 * Authentification : PAS de JWT Supabase (LiveKit ne peut pas en fournir) ;
 * la requête doit porter le JWT signé par LiveKit avec LIVEKIT_API_SECRET
 * (vérifié dans core.ts). Déploiement avec --no-verify-jwt, voir README.md.
 *
 * Secrets : LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL (déjà définis
 * pour live-token), SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (injectés).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { RoomServiceClient } from 'npm:livekit-server-sdk@2.19.1';
import {
  HOST_GRACE_SECONDS,
  MAX_BODY_BYTES,
  MAX_LIVE_SECONDS,
  countViewers,
  mapWebhookEvent,
  parseWebhookEvent,
  shouldCloseRoom,
  verifyWebhook,
  type ParticipantLite,
  type SubtleLike,
} from './core.ts';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function log(event: string, fields: Record<string, string | number | boolean>): void {
  // Codes courts uniquement : jamais de jeton, d'identité ni de corps.
  console.log(JSON.stringify({ fn: 'livekit-webhook', event, ...fields }));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function livekitHttpUrl(wsUrl: string): string {
  return wsUrl.trim().replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const lkKey = (Deno.env.get('LIVEKIT_API_KEY') ?? '').trim();
  const lkSecret = (Deno.env.get('LIVEKIT_API_SECRET') ?? '').trim();
  const lkUrl = (Deno.env.get('LIVEKIT_URL') ?? '').trim();
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!lkKey || lkSecret.length < 32 || !supabaseUrl || !serviceKey) {
    log('rejected', { code: 'not_configured' });
    return json(503, { error: 'not_configured' });
  }

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return json(413, { error: 'too_large' });

  const verified = await verifyWebhook({
    body,
    authorization: req.headers.get('Authorization'),
    apiKey: lkKey,
    apiSecret: lkSecret,
    subtle: crypto.subtle as unknown as SubtleLike,
  });
  if (!verified.ok) {
    log('rejected', { code: verified.reason });
    return json(401, { error: 'unauthorized' });
  }

  const ev = parseWebhookEvent(body);
  if (!ev) return json(400, { error: 'bad_request' });
  const action = mapWebhookEvent(ev);
  if (action.kind === 'ignore') {
    log('ignored', { code: action.reason, ev: ev.event.slice(0, 40) });
    return json(200, { ok: true, ignored: action.reason });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const rooms = lkUrl ? new RoomServiceClient(livekitHttpUrl(lkUrl), lkKey, lkSecret) : null;

  const { data: row, error: rowErr } = await admin
    .from('live_streams')
    .select('id, user_id, status')
    .eq('id', action.liveId)
    .maybeSingle();
  if (rowErr) {
    log('failed', { code: 'db_error', step: 'read' });
    return json(500, { error: 'db_error' });
  }
  if (!row) {
    log('ignored', { code: 'unknown_live', ev: action.event });
    return json(200, { ok: true, ignored: 'unknown_live' });
  }
  const live = row as { id: string; user_id: string; status: string };

  // Recomptage des spectateurs : seulement pour un live actif, et sans
  // bloquer le webhook si l'API LiveKit est lente (on garde l'ancien compteur).
  let viewers: number | null = null;
  if (action.countViewers && rooms && (live.status === 'live' || live.status === 'scheduled')) {
    try {
      const list = await withTimeout(rooms.listParticipants(action.room), 3000);
      viewers = countViewers(list as unknown as ParticipantLite[], live.user_id, action.leavingIdentity);
    } catch {
      log('warn', { code: 'list_participants_failed' });
    }
  }

  const { data: outcome, error: rpcErr } = await admin.rpc('live_webhook_apply', {
    p_live_id: action.liveId,
    p_event: action.event,
    p_participant: action.participant,
    p_viewers: viewers,
    p_event_at: action.eventAtIso,
    p_room: action.room,
  });
  if (rpcErr) {
    // 500 : LiveKit renverra l'événement (la RPC est idempotente).
    log('failed', { code: 'db_error', step: 'apply', pg: String(rpcErr.code ?? 'unknown').slice(0, 12) });
    return json(500, { error: 'db_error' });
  }
  const code = typeof outcome === 'string' ? outcome : 'unknown';

  // L'hôte a terminé dans l'app puis s'est déconnecté : on ferme la room pour
  // déconnecter les spectateurs restants (ils ne consomment plus le quota).
  if (shouldCloseRoom(code) && rooms) {
    try {
      await withTimeout(rooms.deleteRoom(action.room), 3000);
    } catch {
      log('warn', { code: 'delete_room_failed' });
    }
  }

  // Fin automatique : hôte parti depuis plus de HOST_GRACE_SECONDS, ou live
  // trop long. Rejouer ne fait rien (lives déjà terminés).
  let swept = 0;
  const { data: stale, error: sweepErr } = await admin.rpc('live_sweep_stale', {
    p_host_grace_seconds: HOST_GRACE_SECONDS,
    p_max_live_seconds: MAX_LIVE_SECONDS,
  });
  if (sweepErr) {
    log('warn', { code: 'sweep_failed' });
  } else if (Array.isArray(stale)) {
    swept = stale.length;
    for (const s of stale as { room?: string | null }[]) {
      if (!s.room || !rooms) continue;
      try {
        await withTimeout(rooms.deleteRoom(s.room), 3000);
      } catch {
        log('warn', { code: 'delete_room_failed' });
      }
    }
  }

  log('applied', { ev: action.event, outcome: code, viewers: viewers ?? -1, swept });
  return json(200, { ok: true, outcome: code });
});
