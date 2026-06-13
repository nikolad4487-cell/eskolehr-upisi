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
    const { track, phone_number: phoneNumber } = await req.json() as {
      track: AdmissionsTrack;
      phone_number?: string;
    };
    if (!['SECONDARY', 'HIGHER_EDUCATION'].includes(track)) {
      return jsonResponse({ error: 'Neispravan upisni portal.' }, 400);
    }

    const { admin, user } = await getAuthenticatedUser(req);
    const context = await getStudentContext(admin, user.id, track);

    const { data: existing } = await admin
      .from('admission_login_accounts')
      .select('phone, pin_requested_at, locked_until, pin_hash, encrypted_pin, pin_generated_at')
      .eq('registry_student_id', context.student.id)
      .maybeSingle();

    const enteredDigits = String(phoneNumber ?? '').replace(/\D/g, '').replace(/^385/, '');
    const phone = existing?.phone
      ? normalizePhone(String(existing.phone))
      : enteredDigits.length === 9
        ? `+385${enteredDigits}`
        : '';

    if (!phone || !/^\+385\d{9}$/.test(phone)) {
      return jsonResponse({
        error: 'Unesite ispravan broj mobitela od 9 znamenki.',
      }, 400);
    }

    if (existing?.locked_until && new Date(existing.locked_until).getTime() > Date.now()) {
      return jsonResponse({
        error: 'PIN je privremeno zaklju\u010dan zbog previ\u0161e poku\u0161aja.',
      }, 429);
    }

    if (existing?.pin_requested_at) {
      const elapsed = Math.floor((Date.now() - new Date(existing.pin_requested_at).getTime()) / 1000);
      if (elapsed < 60) {
        return jsonResponse({
          error: `Novi PIN mo\u017eete zatra\u017eiti za ${60 - elapsed} sekundi.`,
          retry_after_seconds: 60 - elapsed,
        }, 429);
      }
    }

    let pin = '';
    let pinHash = existing?.pin_hash ?? null;
    let encryptedPin = existing?.encrypted_pin ?? null;
    let pinGeneratedAt = existing?.pin_generated_at ?? null;
    const isFirstActivation = !pinHash || !encryptedPin;

    if (pinHash && encryptedPin) {
      pin = await decryptPin(encryptedPin);
    } else {
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      pin = String(random[0] % 10000).padStart(4, '0');
      pinHash = await hashPin(pin, user.id);
      encryptedPin = await encryptPin(pin);
      pinGeneratedAt = new Date().toISOString();
    }

    const now = new Date();

    const { error: saveError } = await admin
      .from('admission_login_accounts')
      .upsert({
        registry_student_id: context.student.id,
        auth_user_id: user.id,
        username: context.username,
        phone,
        pin_hash: pinHash,
        encrypted_pin: encryptedPin,
        pin_generated_at: pinGeneratedAt,
        pin_requested_at: now.toISOString(),
        failed_attempts: 0,
        locked_until: null,
        verified_session_id: null,
        verified_until: null,
      }, { onConflict: 'registry_student_id' });

    if (saveError) throw saveError;

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const messagingServiceSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
    const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

    if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
      throw new Error('SMS usluga jo\u0161 nije konfigurirana.');
    }

    const body = new URLSearchParams({
      To: phone,
      Body: `SkoleHR e-Upisi trajni PIN: ${pin}. Sacuvajte ga i ne dijelite s drugima.`,
    });

    if (messagingServiceSid) body.set('MessagingServiceSid', messagingServiceSid);
    else body.set('From', fromNumber!);

    const smsResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );

    if (!smsResponse.ok) {
      if (isFirstActivation) {
        await admin
          .from('admission_login_accounts')
          .delete()
          .eq('registry_student_id', context.student.id);
      }
      throw new Error('SMS nije mogu\u0107e poslati. Poku\u0161ajte ponovno.');
    }

    await Promise.all([
      admin
        .from('admission_login_accounts')
        .update({ pin_delivered_at: new Date().toISOString() })
        .eq('registry_student_id', context.student.id),
      admin
        .from('registry_students')
        .update({ phone })
        .eq('id', context.student.id),
    ]);

    return jsonResponse({
      sent: true,
      masked_phone: maskPhone(phone),
      permanent: true,
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'PIN nije mogu\u0107e poslati.',
    }, 400);
  }
});
