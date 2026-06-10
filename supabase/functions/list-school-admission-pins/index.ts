import {
  corsHeaders,
  decryptPin,
  getAuthenticatedUser,
  jsonResponse,
  maskPhone,
  normalizePhone,
} from '../_shared/admissions-pin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { admin, user } = await getAuthenticatedUser(req);

    const { data: profile, error: profileError } = await admin
      .from('user_profiles')
      .select('id, access_role, active_school_id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    const role = String(profile?.access_role ?? '').toLowerCase();
    if (
      profileError
      || !profile?.active_school_id
      || !['admin', 'administrator', 'ravnatelj', 'strucna_sluzba'].includes(role)
    ) {
      return jsonResponse({ error: 'Samo administrator škole može pregledavati PIN-ove.' }, 403);
    }

    const { data: school, error: schoolError } = await admin
      .from('schools')
      .select('id, name, education_level')
      .eq('id', profile.active_school_id)
      .maybeSingle();

    if (schoolError || !school) throw new Error('Aktivna škola nije pronađena.');

    const { data: activeYear, error: yearError } = await admin
      .from('school_years')
      .select('id, label')
      .eq('is_active', true)
      .maybeSingle();

    if (yearError || !activeYear) throw new Error('Aktivna školska godina nije postavljena.');

    const viewName = school.education_level === 'ELEMENTARY'
      ? 'v_admissions_secondary_eligible'
      : school.education_level === 'SECONDARY'
        ? 'v_admissions_higher_eligible'
        : null;

    if (!viewName) {
      return jsonResponse({
        school,
        school_year: activeYear,
        track: null,
        students: [],
      });
    }

    const track = school.education_level === 'ELEMENTARY'
      ? 'SECONDARY'
      : 'HIGHER_EDUCATION';

    const { data: students, error: studentsError } = await admin
      .from(viewName)
      .select('registry_student_id, ednevnik_student_id, full_name, email, phone, class_name, grade_level, program_name')
      .eq('school_id', school.id)
      .eq('school_year_id', activeYear.id)
      .order('last_name')
      .order('first_name');

    if (studentsError) throw studentsError;

    const profileIds = (students ?? [])
      .map((student) => student.ednevnik_student_id)
      .filter(Boolean);
    const studentIds = (students ?? []).map((student) => student.registry_student_id);

    const [{ data: linkedProfiles }, { data: existingAccounts }] = await Promise.all([
      profileIds.length
        ? admin
          .from('user_profiles')
          .select('id, auth_user_id, email')
          .in('id', profileIds)
        : Promise.resolve({ data: [] }),
      studentIds.length
        ? admin
          .from('admission_login_accounts')
          .select('*')
          .in('registry_student_id', studentIds)
        : Promise.resolve({ data: [] }),
    ]);

    const profilesById = new Map((linkedProfiles ?? []).map((item) => [item.id, item]));
    const accountsByStudent = new Map(
      (existingAccounts ?? []).map((item) => [item.registry_student_id, item]),
    );
    const result = [];

    for (const student of students ?? []) {
      const linkedProfile = profilesById.get(student.ednevnik_student_id);
      const account = accountsByStudent.get(student.registry_student_id);
      const phone = normalizePhone(String(account?.phone ?? ''));
      let pin: string | null = null;
      let accountStatus = account?.encrypted_pin ? 'READY' : 'NOT_ACTIVATED';

      if (!linkedProfile?.auth_user_id) {
        accountStatus = 'NO_AUTH_ACCOUNT';
      } else if (account?.encrypted_pin) {
        pin = await decryptPin(account.encrypted_pin);
      }

      result.push({
        registry_student_id: student.registry_student_id,
        full_name: student.full_name,
        class_name: student.class_name,
        grade_level: student.grade_level,
        program_name: student.program_name,
        username: account?.username
          ?? String(student.email ?? linkedProfile?.email ?? '').split('@')[0].toLowerCase(),
        pin,
        phone: phone ? maskPhone(phone) : null,
        pin_generated_at: account?.pin_generated_at ?? null,
        pin_delivered_at: account?.pin_delivered_at ?? null,
        last_verified_at: account?.last_verified_at ?? null,
        status: accountStatus,
      });
    }

    return jsonResponse({
      school,
      school_year: activeYear,
      track,
      students: result,
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'PIN-ove nije moguće učitati.',
    }, 400);
  }
});
