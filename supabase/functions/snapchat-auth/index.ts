/**
 * Edge Function : Snapchat OAuth code → session Supabase Auth.
 *
 * Secrets (Dashboard → Edge Functions → Secrets, ou `supabase secrets set`) :
 *   SNAP_CLIENT_ID
 *   SNAP_CLIENT_SECRET
 *   SUPABASE_URL          (auto sur hosted)
 *   SUPABASE_SERVICE_ROLE_KEY  (auto sur hosted)
 *   SUPABASE_ANON_KEY     (auto)
 *
 * Déploiement :
 *   supabase functions deploy snapchat-auth --no-verify-jwt
 *
 * Secret optionnel :
 *   SNAP_PUBLIC_CLIENT_IDS  (liste séparée par des virgules d'autres Client IDs
 *                            publics acceptés, ex. l'ID Production)
 *
 * Corps POST JSON :
 *   { code, code_verifier, redirect_uri }                         (historique)
 *   { code, code_verifier, redirect_uri, client_type: 'public', client_id }  (v7)
 *
 * v7 : mode public (PKCE seul, sans en-tête Basic) — voir core.ts.
 *
 * Réponse :
 *   { access_token, refresh_token, expires_in, displayName, avatarUrl, externalId }
 *
 * Voir SNAPCHAT_AUTH.md.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  allowedPublicClientIds,
  parseExchangeRequest,
  planTokenRequest,
  shouldRetryAsPublic,
  type SnapClientType,
  type SnapConfig,
  type SnapExchangeRequest,
} from './core.ts';

const SNAP_ME = 'https://kit.snapchat.com/v1/me';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sanitizeHandle(raw: string): string {
  const h = raw.replace(/[^a-zA-Z0-9._]/g, '').toLowerCase();
  return h.slice(0, 24) || 'snap';
}

type TokenJson = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type TokenAttempt =
  | { kind: 'plan_error'; status: number; error: string }
  | { kind: 'snap'; ok: boolean; status: number; body: TokenJson };

async function requestSnapToken(
  exchange: SnapExchangeRequest,
  cfg: SnapConfig,
  mode: SnapClientType,
): Promise<TokenAttempt> {
  const plan = planTokenRequest(exchange, cfg, mode);
  if (!plan.ok) {
    return { kind: 'plan_error', status: plan.status, error: plan.error };
  }
  const res = await fetch(plan.url, {
    method: 'POST',
    headers: plan.headers,
    body: plan.body,
  });
  const body = (await res.json().catch(() => ({}))) as TokenJson;
  return { kind: 'snap', ok: res.ok, status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const snapClientId = (Deno.env.get('SNAP_CLIENT_ID') || '').trim();
  const snapClientSecret = (Deno.env.get('SNAP_CLIENT_SECRET') || '').trim();
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || serviceKey).trim();

  if (!snapClientId) {
    return json(503, {
      error:
        'Configure Snap Kit + deploy function — SNAP_CLIENT_ID / SNAP_CLIENT_SECRET manquants côté Edge Function.',
    });
  }
  if (!supabaseUrl || !serviceKey) {
    return json(503, {
      error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants.',
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json(400, { error: 'JSON invalide' });
  }

  const parsed = parseExchangeRequest(rawBody);
  if (!parsed.ok) {
    return json(parsed.status, { error: parsed.error });
  }
  const exchange = parsed.value;

  const cfg: SnapConfig = {
    clientId: snapClientId,
    clientSecret: snapClientSecret,
    publicClientIds: allowedPublicClientIds(
      snapClientId,
      Deno.env.get('SNAP_PUBLIC_CLIENT_IDS') || '',
    ),
  };

  // 1) Échange code → access_token Snapchat (public PKCE, ou historique Basic + PKCE)
  let mode: SnapClientType = exchange.clientType;
  let attempt = await requestSnapToken(exchange, cfg, mode);
  if (
    attempt.kind === 'snap' &&
    !attempt.ok &&
    shouldRetryAsPublic(
      mode,
      attempt.status,
      attempt.body.error,
      cfg.publicClientIds.includes(cfg.clientId),
    )
  ) {
    console.log('snapchat-auth: retry_public');
    mode = 'public';
    attempt = await requestSnapToken(exchange, cfg, mode);
  }
  if (attempt.kind === 'plan_error') {
    return json(attempt.status, { error: attempt.error });
  }

  const tokenJson = attempt.body;
  if (!attempt.ok || !tokenJson.access_token) {
    console.log(
      `snapchat-auth: token_failed mode=${mode} status=${attempt.status} err=${tokenJson.error ?? '-'}`,
    );
    return json(401, {
      error:
        tokenJson.error_description ||
        tokenJson.error ||
        'Échange token Snapchat échoué',
    });
  }

  // 2) Identité Snap (externalId + displayName + Bitmoji)
  const meRes = await fetch(SNAP_ME, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenJson.access_token}`,
    },
    body: JSON.stringify({
      query: '{me{displayName bitmoji{avatar} externalId}}',
    }),
  });

  const meJson = (await meRes.json().catch(() => ({}))) as {
    data?: {
      me?: {
        displayName?: string;
        externalId?: string;
        bitmoji?: { avatar?: string };
      };
    };
  };

  const me = meJson.data?.me;
  const externalId = me?.externalId;
  if (!externalId) {
    return json(401, {
      error:
        'Impossible de lire externalId Snapchat. Vérifiez les scopes Login Kit (user.external_id).',
    });
  }

  const displayName = me?.displayName || `Snap ${externalId.slice(0, 6)}`;
  const avatarUrl = me?.bitmoji?.avatar || null;
  const email = `snapchat_${externalId}@users.nia.app`;
  const username = sanitizeHandle(`snap_${externalId.slice(0, 12)}`);

  const meta = {
    full_name: displayName,
    name: displayName,
    avatar_url: avatarUrl,
    picture: avatarUrl,
    username,
    snapchat_external_id: externalId,
    provider: 'snapchat',
  };

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3) Créer l’utilisateur si besoin (email stable = idempotence)
  const randomPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password: randomPassword,
    email_confirm: true,
    user_metadata: meta,
    // Migration 017 : le domaine @users.nia.app est réservé à cette fonction.
    // Un trigger différé sur auth.users refuse toute adresse de ce domaine
    // sans ce marqueur (app_metadata n'est pas modifiable par l'utilisateur).
    // À DÉPLOYER AVANT d'appliquer 017.
    app_metadata: { nia_origin: 'snapchat-auth' },
  });

  let userId: string | null = created.data.user?.id ?? null;

  if (created.error) {
    const msg = (created.error.message || '').toLowerCase();
    const already =
      msg.includes('already') ||
      msg.includes('registered') ||
      msg.includes('exists') ||
      created.error.status === 422;

    if (!already) {
      return json(500, { error: created.error.message || 'createUser échoué' });
    }

    // Utilisateur existant : mettre à jour les métadonnées via generateLink email
    // (pas de getUserByEmail stable sur toutes les versions — on continue avec email)
    userId = null;
  } else if (userId) {
    // ok
  }

  if (userId) {
    // no-op — already created with meta
  } else {
    // Best-effort metadata refresh for returning users via list filter by email
    try {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = listed.data?.users?.find((u) => u.email === email);
      if (existing) {
        userId = existing.id;
        await admin.auth.admin.updateUserById(userId, {
          user_metadata: {
            ...(existing.user_metadata || {}),
            ...meta,
            avatar_url:
              avatarUrl ||
              (existing.user_metadata as { avatar_url?: string })?.avatar_url,
            picture:
              avatarUrl ||
              (existing.user_metadata as { picture?: string })?.picture,
            username:
              (existing.user_metadata as { username?: string })?.username ||
              username,
          },
        });
      }
    } catch {
      // non-fatal — session generation below still works via email
    }
  }

  // 4) Générer une session (magiclink → verifyOtp token_hash)
  const link = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (link.error || !link.data?.properties?.hashed_token) {
    return json(500, {
      error:
        link.error?.message ||
        'generateLink échoué — impossible de créer une session',
    });
  }

  const tokenHash = link.data.properties.hashed_token;
  const verifyClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const verified = await verifyClient.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });

  if (verified.error || !verified.data.session) {
    return json(500, {
      error:
        verified.error?.message ||
        'verifyOtp échoué — session Snapchat non créée',
    });
  }

  const session = verified.data.session;

  return json(200, {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    displayName,
    avatarUrl,
    externalId,
    user_id: session.user?.id ?? userId,
  });
});
