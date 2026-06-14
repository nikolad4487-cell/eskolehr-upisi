import bcrypt from 'npm:bcryptjs@2.4.3';
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
    const pin = String(body.password ?? '');
    const firstName = String(body.first_name ?? '').trim();
    const lastName = String(body.last_name ?? '').trim();
    const fullName = `${firstName} ${lastName}`.trim();

    if (!schoolId || !firstName || !lastName || !email) {
      return jsonResponse({ error: 'Škola, ime, prezime i e-mail su obvezni.' }, 400);
    }
    if (!/^\d{4}$/.test(pin)) {
      return jsonResponse({ error: 'PIN mora imati točno 4 znamenke.' }, 400);
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

    const authUsers = [];
    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      authUsers.push(...data.users);
      if (data.users.length < 1000) break;
    }

    const legacyEmail = email.replace(/@skolehr\.xyz$/i, '@eskole.me');
    let authUser = authUsers.find((item) => {
      const candidate = String(item.email ?? '').toLowerCase();
      return candidate === email || candidate === legacyEmail;
    });

    if (authUser) {
      const { data, error } = await admin.auth.admin.updateUserById(authUser.id, {
        email,
        password: pin,
        email_confirm: true,
        user_metadata: {
          ...authUser.user_metadata,
          name: fullName,
          first_name: firstName,
          last_name: lastName,
        },
      });
      if (error || !data.user) throw new Error(error?.message ?? 'Auth račun nije moguće ažurirati.');
      authUser = data.user;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: pin,
        email_confirm: true,
        user_metadata: {
          name: fullName,
          first_name: firstName,
          last_name: lastName,
        },
      });
      if (error || !data.user) throw new Error(error?.message ?? 'Auth račun nije moguće stvoriti.');
      authUser = data.user;
      createdAuthUserId = authUser.id;
    }

    const pinHash = await bcrypt.hash(pin, 10);
    const { data: existingProfile, error: existingProfileError } = await admin
      .from('user_profiles')
      .select('id')
      .or(`auth_user_id.eq.${authUser.id},email.ilike.${email},email.ilike.${legacyEmail}`)
      .limit(1)
      .maybeSingle();
    if (existingProfileError) throw existingProfileError;

    const profilePayload = {
      auth_user_id: authUser.id,
      email,
      name: fullName,
      role: 'SCHOOL_ADMIN',
      access_role: 'school_admin',
      active_school_id: schoolId,
      school_id: schoolId,
      pin_hash: pinHash,
      is_first_login: true,
      requires_password_change: false,
      password_type: 'staff_with_authenticator',
      authenticator_secret: null,
      requires_authenticator_setup: true,
    };

    const profileResult = existingProfile
      ? await admin
          .from('user_profiles')
          .update(profilePayload)
          .eq('id', existingProfile.id)
          .select('id, email, name, access_role, active_school_id')
          .single()
      : await admin
          .from('user_profiles')
          .insert(profilePayload)
          .select('id, email, name, access_role, active_school_id')
          .single();
    const { data: profile, error: profileError } = profileResult;
    if (profileError || !profile) {
      throw new Error(profileError?.message ?? 'Korisnički profil nije moguće sinkronizirati.');
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
    if (schoolRoleError) throw new Error(schoolRoleError.message);

    return jsonResponse({
      message: `Administrator ustanove ${school.name} sinkroniziran je s e-Dnevnikom.`,
      profile,
      school,
    }, existingProfile ? 200 : 201);
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
      error: error instanceof Error ? error.message : 'Administratora ustanove nije moguće sinkronizirati.',
    }, 400);
  }
});
