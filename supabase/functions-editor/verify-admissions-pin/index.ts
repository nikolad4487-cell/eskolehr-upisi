import { createClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase Edge Function secrets are not configured.');
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getAuthenticatedUser(req: Request) {
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Prijava je istekla. Prijavite se ponovno.');

  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error('Prijava je istekla. Prijavite se ponovno.');

  return { admin, user: data.user, token };
}

export function getSessionId(token: string) {
  try {
    const payload = token.split('.')[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return String(JSON.parse(atob(padded)).session_id ?? '');
  } catch {
    return '';
  }
}

export async function getStudentContext(
  admin: ReturnType<typeof getAdminClient>,
  authUserId: string,
  track: 'SECONDARY' | 'HIGHER_EDUCATION',
) {
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('id, email')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error('Korisnik nije povezan s e-Dnevnikom.');
  }

  const { data: student, error: studentError } = await admin
    .from('registry_students')
    .select('id, email, phone, first_name, last_name')
    .eq('ednevnik_student_id', profile.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (studentError || !student) {
    throw new Error('Administrator jo\u0161 nije povukao podatke iz e-Dnevnika.');
  }

  const { data: candidate, error: candidateError } = await admin
    .from('admission_candidates')
    .select('id')
    .eq('registry_student_id', student.id)
    .eq('track', track)
    .limit(1)
    .maybeSingle();

  if (candidateError || !candidate) {
    throw new Error('Administrator jo\u0161 nije povukao podatke u e-Upise.');
  }

  return {
    profile,
    student,
    candidate,
    username: String(student.email ?? profile.email ?? '').split('@')[0].toLowerCase(),
  };
}

export function normalizePhone(value: string) {
  const compact = value.replace(/[^\d+]/g, '');
  if (compact.startsWith('+')) return compact;
  if (compact.startsWith('00')) return `+${compact.slice(2)}`;
  if (compact.startsWith('0')) return `+385${compact.slice(1)}`;
  return compact ? `+${compact}` : '';
}

export function maskPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${digits.slice(0, 3)}${'*'.repeat(Math.max(3, digits.length - 5))}${digits.slice(-2)}`;
}

export async function hashPin(
  pin: string,
  authUserId: string,
) {
  const pepper = Deno.env.get('ADMISSIONS_PIN_PEPPER');
  if (!pepper) throw new Error('ADMISSIONS_PIN_PEPPER secret is not configured.');

  const bytes = new TextEncoder().encode(`${pin}:${pepper}:${authUserId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function getEncryptionKey() {
  const secret = Deno.env.get('ADMISSIONS_PIN_ENCRYPTION_KEY');
  if (!secret) throw new Error('ADMISSIONS_PIN_ENCRYPTION_KEY secret is not configured.');

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );

  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function encryptPin(pin: string) {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(pin),
  );

  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptPin(value: string) {
  const [ivValue, encryptedValue] = value.split('.');
  if (!ivValue || !encryptedValue) throw new Error('PIN zapis nije ispravan.');

  const key = await getEncryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivValue) },
    key,
    base64ToBytes(encryptedValue),
  );

  return new TextDecoder().decode(decrypted);
}

type AdmissionsTrack = 'SECONDARY' | 'HIGHER_EDUCATION';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { track, pin } = await req.json() as { track: AdmissionsTrack; pin: string };
    if (!['SECONDARY', 'HIGHER_EDUCATION'].includes(track)) {
      return jsonResponse({ error: 'Neispravan upisni portal.' }, 400);
    }
    if (!/^\d{4}$/.test(String(pin ?? ''))) {
      return jsonResponse({ error: 'PIN mora imati to\u010dno 4 znamenke.' }, 400);
    }

    const { admin, user, token } = await getAuthenticatedUser(req);
    const context = await getStudentContext(admin, user.id, track);

    const { data: account, error: accountError } = await admin
      .from('admission_login_accounts')
      .select('*')
      .eq('registry_student_id', context.student.id)
      .maybeSingle();

    if (accountError || !account?.pin_hash) {
      return jsonResponse({ error: 'Najprije zatra\u017eite novi PIN.' }, 400);
    }

    const now = new Date();
    if (account.locked_until && new Date(account.locked_until).getTime() > now.getTime()) {
      return jsonResponse({
        error: 'PIN je privremeno zaklju\u010dan. Poku\u0161ajte ponovno za 15 minuta.',
      }, 429);
    }
    const submittedHash = await hashPin(String(pin), user.id);
    if (submittedHash !== account.pin_hash) {
      const failedAttempts = Number(account.failed_attempts ?? 0) + 1;
      const lockedUntil = failedAttempts >= 5
        ? new Date(now.getTime() + 15 * 60 * 1000).toISOString()
        : null;

      await admin
        .from('admission_login_accounts')
        .update({
          failed_attempts: failedAttempts,
          locked_until: lockedUntil,
        })
        .eq('registry_student_id', context.student.id);

      return jsonResponse({
        error: failedAttempts >= 5
          ? 'Previ\u0161e pogre\u0161nih poku\u0161aja. PIN je zaklju\u010dan na 15 minuta.'
          : `PIN nije ispravan. Preostalo poku\u0161aja: ${5 - failedAttempts}.`,
      }, 400);
    }

    const verifiedUntil = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const sessionId = getSessionId(token);

    const { error: verifyError } = await admin
      .from('admission_login_accounts')
      .update({
        failed_attempts: 0,
        locked_until: null,
        verified_session_id: sessionId,
        verified_until: verifiedUntil.toISOString(),
        last_verified_at: now.toISOString(),
      })
      .eq('registry_student_id', context.student.id);

    if (verifyError) throw verifyError;

    return jsonResponse({
      verified: true,
      verified_until: verifiedUntil.toISOString(),
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'PIN nije mogu\u0107e provjeriti.',
    }, 400);
  }
});
