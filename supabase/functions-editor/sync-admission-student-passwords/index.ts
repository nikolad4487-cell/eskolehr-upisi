import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) throw new Error('Supabase Edge Function nije konfigurirana.');

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ error: 'Nedostaje autorizacijski token.' }, 401);

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse({ error: 'Prijava je istekla.' }, 401);

    const body = await req.json() as {
      class_id?: string;
      school_year_id?: string;
      track?: 'SECONDARY' | 'HIGHER_EDUCATION';
    };
    if (!body.class_id || !body.school_year_id || !body.track) {
      return jsonResponse({ error: 'Nedostaju razred, školska godina ili upisni portal.' }, 400);
    }

    const { data: callerProfile, error: callerError } = await admin
      .from('user_profiles')
      .select('id, role, access_role')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    if (callerError || !callerProfile) {
      return jsonResponse({ error: 'Profil prijavljenog korisnika nije pronađen.' }, 403);
    }

    const { data: classRow, error: classError } = await admin
      .from('classes')
      .select('id, school_id, school_year_id')
      .eq('id', body.class_id)
      .maybeSingle();
    if (classError || !classRow || classRow.school_year_id !== body.school_year_id) {
      return jsonResponse({ error: 'Razred ne pripada odabranoj školskoj godini.' }, 400);
    }

    const profileRoles = [
      String(callerProfile.role ?? '').toUpperCase(),
      String(callerProfile.access_role ?? '').toUpperCase(),
    ];
    const isGlobalAdmin = profileRoles.some((role) =>
      ['SUPER_ADMIN', 'MAIN_ADMIN', 'MAIN_ADMINISTRATOR'].includes(role)
    );
    const { data: schoolRoles, error: roleError } = await admin
      .from('user_school_roles')
      .select('role, school_id, status')
      .eq('user_id', callerProfile.id)
      .eq('school_id', classRow.school_id);
    if (roleError) throw roleError;

    const canManageSchool = isGlobalAdmin || (schoolRoles ?? []).some((entry) => (
      ['SCHOOL_ADMIN', 'ADMIN', 'MAIN_ADMIN', 'HOMEROOM', 'HOMEROOM_TEACHER'].includes(
        String(entry.role ?? '').toUpperCase(),
      )
      && String(entry.status ?? 'ACTIVE').toUpperCase() !== 'INACTIVE'
    ));
    if (!canManageSchool) {
      return jsonResponse({ error: 'Nemate ovlasti za usklađivanje učenika ovog razreda.' }, 403);
    }

    const { data: candidates, error: candidateError } = await admin
      .from('admission_candidates')
      .select('id, registry_student_id, ednevnik_student_id')
      .eq('source_class_id', body.class_id)
      .eq('school_year_id', body.school_year_id)
      .eq('track', body.track);
    if (candidateError) throw candidateError;

    let updated = 0;
    const errors: string[] = [];

    for (const candidate of candidates ?? []) {
      let profileId = candidate.ednevnik_student_id;
      if (!profileId && candidate.registry_student_id) {
        const { data: student } = await admin
          .from('registry_students')
          .select('ednevnik_student_id')
          .eq('id', candidate.registry_student_id)
          .maybeSingle();
        profileId = student?.ednevnik_student_id ?? null;
      }

      if (!profileId) {
        errors.push(`${candidate.id}: učenik nema povezan e-Dnevnik profil`);
        continue;
      }

      const { data: studentProfile, error: profileError } = await admin
        .from('user_profiles')
        .select('id, auth_user_id')
        .eq('id', profileId)
        .maybeSingle();
      if (profileError || !studentProfile?.auth_user_id) {
        errors.push(`${candidate.id}: Auth račun učenika nije pronađen`);
        continue;
      }

      const { error: passwordError } = await admin.auth.admin.updateUserById(
        studentProfile.auth_user_id,
        { password: 'yupu8Ev4' },
      );
      if (passwordError) {
        errors.push(`${candidate.id}: ${passwordError.message}`);
        continue;
      }

      const { error: updateError } = await admin
        .from('user_profiles')
        .update({
          password_type: 'student_static',
          requires_password_change: false,
        })
        .eq('id', studentProfile.id);
      if (updateError) {
        errors.push(`${candidate.id}: ${updateError.message}`);
        continue;
      }

      updated += 1;
    }

    return jsonResponse({
      success: errors.length === 0,
      updated,
      failed: errors.length,
      errors,
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Usklađivanje lozinki nije uspjelo.',
    }, 500);
  }
});
