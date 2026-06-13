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

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  return email.includes('@') ? email : `${email}@eskole.me`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  let createdAuthUserId = '';

  try {
    const { admin, user } = await getAuthenticatedUser(req);
    const body = await req.json();
    const schoolId = String(body.school_id ?? '').trim();
    const email = normalizeEmail(String(body.email ?? ''));
    const password = String(body.password ?? '');
    const firstName = String(body.first_name ?? '').trim();
    const lastName = String(body.last_name ?? '').trim();
    const fullName = `${firstName} ${lastName}`.trim();

    if (!schoolId || !firstName || !lastName || !email) {
      return jsonResponse({ error: 'Škola, ime, prezime i e-mail su obvezni.' }, 400);
    }
    if (password.length < 8) {
      return jsonResponse({ error: 'Lozinka mora imati najmanje 8 znakova.' }, 400);
    }

    const { data: caller, error: callerError } = await admin
      .from('user_profiles')
      .select('id, access_role')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (
      callerError
      || !caller
      || !['super_admin', 'main_admin'].includes(String(caller.access_role ?? '').toLowerCase())
    ) {
      return jsonResponse({ error: 'Samo glavni administrator može dodati administratora škole.' }, 403);
    }

    const { data: school, error: schoolError } = await admin
      .from('schools')
      .select('id, name')
      .eq('id', schoolId)
      .maybeSingle();

    if (schoolError || !school) return jsonResponse({ error: 'Škola nije pronađena.' }, 404);

    const { data: existingAdmin } = await admin
      .from('user_profiles')
      .select('id, email')
      .eq('active_school_id', schoolId)
      .eq('access_role', 'school_admin')
      .limit(1)
      .maybeSingle();

    if (existingAdmin) {
      return jsonResponse({
        error: `Škola već ima glavnog administratora (${existingAdmin.email}).`,
      }, 409);
    }

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: fullName,
        first_name: firstName,
        last_name: lastName,
      },
    });

    if (authError || !authData.user) {
      throw new Error(authError?.message ?? 'Auth račun nije moguće stvoriti.');
    }
    createdAuthUserId = authData.user.id;

    const { data: profile, error: profileError } = await admin
      .from('user_profiles')
      .insert({
        auth_user_id: authData.user.id,
        email,
        name: fullName,
        access_role: 'school_admin',
        active_school_id: schoolId,
        is_first_login: true,
        requires_password_change: true,
      })
      .select('id, email, name, access_role, active_school_id')
      .single();

    if (profileError || !profile) {
      throw new Error(profileError?.message ?? 'Korisnički profil nije moguće stvoriti.');
    }

    const { error: schoolRoleError } = await admin
      .from('user_school_roles')
      .upsert({
        user_id: profile.id,
        school_id: schoolId,
        role: 'SCHOOL_ADMIN',
        status: 'ACTIVE',
      }, {
        onConflict: 'user_id,school_id,role',
      });

    if (schoolRoleError) {
      await admin.from('user_profiles').delete().eq('id', profile.id);
      throw new Error(schoolRoleError.message);
    }

    return jsonResponse({
      message: `Administrator škole ${school.name} je stvoren.`,
      profile,
      school,
    }, 201);
  } catch (error) {
    if (createdAuthUserId) {
      try {
        const { admin } = await getAuthenticatedUser(req);
        await admin.auth.admin.deleteUser(createdAuthUserId);
      } catch {
        // Preserve the original error.
      }
    }

    return jsonResponse({
      error: error instanceof Error ? error.message : 'Administratora škole nije moguće stvoriti.',
    }, 400);
  }
});
