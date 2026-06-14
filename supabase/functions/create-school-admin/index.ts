import {
  corsHeaders,
  getAuthenticatedUser,
  jsonResponse,
} from '../_shared/admissions-pin.ts';

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!email.includes('@')) return `${email}@skolehr.xyz`;
  return email.replace(/@eskole\.me$/i, '@skolehr.xyz');
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
