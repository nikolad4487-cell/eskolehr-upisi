import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-migration-secret',
};

const OLD_DOMAIN = '@eskole.me';
const NEW_DOMAIN = '@skolehr.xyz';
const SUPER_ADMIN_EMAIL = `skola${NEW_DOMAIN}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function migrateEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(OLD_DOMAIN)
    ? `${normalized.slice(0, -OLD_DOMAIN.length)}${NEW_DOMAIN}`
    : normalized;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const expectedSecret = Deno.env.get('EMAIL_DOMAIN_MIGRATION_SECRET');
    const suppliedSecret = req.headers.get('x-migration-secret') ?? '';

    if (!url || !serviceRoleKey) {
      return json({ success: false, error: 'Supabase service role secrets are missing.' }, 500);
    }
    if (!expectedSecret || suppliedSecret !== expectedSecret) {
      return json({ success: false, error: 'Neispravan migracijski ključ.' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const superAdminPassword = String(body.super_admin_password ?? '');
    if (superAdminPassword.length < 4) {
      return json({
        success: false,
        error: 'Pošaljite super_admin_password s najmanje 4 znaka.',
      }, 400);
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authUsers: any[] = [];
    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      authUsers.push(...data.users);
      if (data.users.length < 1000) break;
    }

    const usersByEmail = new Map(
      authUsers
        .filter((user) => user.email)
        .map((user) => [String(user.email).toLowerCase(), user]),
    );
    const results: Array<Record<string, unknown>> = [];

    for (const user of authUsers) {
      const oldEmail = String(user.email ?? '').toLowerCase();
      if (!oldEmail.endsWith(OLD_DOMAIN)) continue;

      const newEmail = migrateEmail(oldEmail);
      const collision = usersByEmail.get(newEmail);
      if (collision && collision.id !== user.id) {
        results.push({
          user_id: user.id,
          old_email: oldEmail,
          new_email: newEmail,
          success: false,
          error: 'Ciljni e-mail već koristi drugi Auth korisnik.',
        });
        continue;
      }

      const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
        email: newEmail,
        email_confirm: true,
      });
      if (authError) {
        results.push({
          user_id: user.id,
          old_email: oldEmail,
          new_email: newEmail,
          success: false,
          error: authError.message,
        });
        continue;
      }

      const publicErrors: string[] = [];
      const { error: profileByAuthError } = await admin
        .from('user_profiles')
        .update({ email: newEmail })
        .eq('auth_user_id', user.id);
      if (profileByAuthError) publicErrors.push(`user_profiles/auth_user_id: ${profileByAuthError.message}`);

      const { error: profileByEmailError } = await admin
        .from('user_profiles')
        .update({ email: newEmail })
        .ilike('email', oldEmail);
      if (profileByEmailError) publicErrors.push(`user_profiles/email: ${profileByEmailError.message}`);

      const { error: studentError } = await admin
        .from('registry_students')
        .update({ email: newEmail })
        .ilike('email', oldEmail);
      if (studentError) publicErrors.push(`registry_students: ${studentError.message}`);

      usersByEmail.delete(oldEmail);
      usersByEmail.set(newEmail, { ...user, email: newEmail });
      results.push({
        user_id: user.id,
        old_email: oldEmail,
        new_email: newEmail,
        success: publicErrors.length === 0,
        warnings: publicErrors,
      });
    }

    for (const user of usersByEmail.values()) {
      const currentEmail = String(user.email ?? '').toLowerCase();
      if (!currentEmail.endsWith(NEW_DOMAIN)) continue;
      const previousEmail = `${currentEmail.slice(0, -NEW_DOMAIN.length)}${OLD_DOMAIN}`;

      await admin
        .from('user_profiles')
        .update({ email: currentEmail })
        .eq('auth_user_id', user.id);
      await admin
        .from('user_profiles')
        .update({ email: currentEmail })
        .ilike('email', previousEmail);
      await admin
        .from('registry_students')
        .update({ email: currentEmail })
        .ilike('email', previousEmail);
    }

    let superAdmin = usersByEmail.get(SUPER_ADMIN_EMAIL);
    if (!superAdmin) {
      const { data, error } = await admin.auth.admin.createUser({
        email: SUPER_ADMIN_EMAIL,
        password: superAdminPassword,
        email_confirm: true,
        user_metadata: {
          name: 'Glavni administrator SkoleHR',
          first_name: 'Glavni administrator',
          last_name: 'SkoleHR',
        },
      });
      if (error || !data.user) throw new Error(error?.message ?? 'Super administrator nije stvoren.');
      superAdmin = data.user;
    } else {
      const { data, error } = await admin.auth.admin.updateUserById(superAdmin.id, {
        password: superAdminPassword,
        email_confirm: true,
        user_metadata: {
          ...superAdmin.user_metadata,
          name: 'Glavni administrator SkoleHR',
        },
      });
      if (error || !data.user) throw new Error(error?.message ?? 'Lozinka super administratora nije postavljena.');
      superAdmin = data.user;
    }

    let { data: existingProfile, error: existingProfileError } = await admin
      .from('user_profiles')
      .select('id')
      .eq('auth_user_id', superAdmin.id)
      .maybeSingle();
    if (existingProfileError) throw existingProfileError;
    if (!existingProfile) {
      const fallback = await admin
        .from('user_profiles')
        .select('id')
        .in('email', [SUPER_ADMIN_EMAIL, `skola${OLD_DOMAIN}`])
        .limit(1)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      existingProfile = fallback.data;
    }

    let profileId = existingProfile?.id;
    if (profileId) {
      const { error } = await admin
        .from('user_profiles')
        .update({
          auth_user_id: superAdmin.id,
          email: SUPER_ADMIN_EMAIL,
          name: 'Glavni administrator SkoleHR',
          access_role: 'super_admin',
          active_school_id: null,
          is_first_login: false,
          requires_password_change: false,
        })
        .eq('id', profileId);
      if (error) throw error;
    } else {
      const { data, error } = await admin
        .from('user_profiles')
        .insert({
          auth_user_id: superAdmin.id,
          email: SUPER_ADMIN_EMAIL,
          name: 'Glavni administrator SkoleHR',
          access_role: 'super_admin',
          active_school_id: null,
          is_first_login: false,
          requires_password_change: false,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Profil super administratora nije stvoren.');
      profileId = data.id;
    }

    const { error: roleDeleteError } = await admin
      .from('user_school_roles')
      .delete()
      .eq('user_id', profileId);
    if (roleDeleteError) throw roleDeleteError;

    const failed = results.filter((result) => result.success === false);
    return json({
      success: failed.length === 0,
      migrated_count: results.length - failed.length,
      failed_count: failed.length,
      super_admin_email: SUPER_ADMIN_EMAIL,
      super_admin_user_id: superAdmin.id,
      results,
    });
  } catch (error) {
    console.error('[EMAIL_DOMAIN_MIGRATION]', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Migracija nije uspjela.',
    }, 500);
  }
});
