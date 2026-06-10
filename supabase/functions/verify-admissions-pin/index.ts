import {
  corsHeaders,
  getAuthenticatedUser,
  getSessionId,
  getStudentContext,
  hashPin,
  jsonResponse,
} from '../_shared/admissions-pin.ts';

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
