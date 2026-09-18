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
 * Corps POST JSON :
 *   { code, code_verifier, redirect_uri }
 *
 * Réponse :
 *   { access_token, refresh_token, expires_in, displayName, avatarUrl, externalId }
 *
 * Voir SNAPCHAT_AUTH.md.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const SNAP_TOKEN = 'https://accounts.snapchat.com/accounts/oauth2/token';
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

  if (!snapClientId || !snapClientSecret) {
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

  let payload: {
    code?: string;
    code_verifier?: string;
    redirect_uri?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'JSON invalide' });
  }

  const { code, code_verifier, redirect_uri } = payload;
  if (!code || !code_verifier || !redirect_uri) {
    return json(400, {
      error: 'code, code_verifier et redirect_uri sont requis',
    });
  }

  // 1) Échange code → access_token Snapchat (confidential + PKCE)
  const basic = btoa(`${snapClientId}:${snapClientSecret}`);
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri,
    client_id: snapClientId,
    code_verifier,
  });

  const tokenRes = await fetch(SNAP_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: tokenBody.toString(),
  });

  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
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
