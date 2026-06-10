import {
  corsHeaders,
  decryptPin,
  encryptPin,
  getAuthenticatedUser,
  getStudentContext,
  hashPin,
  jsonResponse,
  maskPhone,
  normalizePhone,
} from '../_shared/admissions-pin.ts';

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
