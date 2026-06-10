# e-Upisi SMS PIN

Pri prvoj prijavi učenik unosi samo korisničko ime i lozinku iz e-Dnevnika.
Zatim unosi devet znamenki hrvatskog broja mobitela, dok sustav automatski
dodaje `+385`. Edge Function generira trajni četveroznamenkasti PIN, šalje ga
SMS-om, sprema broj u `registry_students.phone` i odjavljuje učenika.

Pri svakoj sljedećoj prijavi učenik unosi korisničko ime, lozinku i isti PIN.

## Potrebne Supabase Function secrets

```text
ADMISSIONS_PIN_PEPPER=duga-nasumicna-tajna
ADMISSIONS_PIN_ENCRYPTION_KEY=druga-duga-nasumicna-tajna
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...
```

Umjesto `TWILIO_MESSAGING_SERVICE_SID` moze se koristiti:

```text
TWILIO_FROM_NUMBER=+385...
```

`ADMISSIONS_PIN_PEPPER` i `ADMISSIONS_PIN_ENCRYPTION_KEY` trebaju biti dvije
razlicite duge nasumicne vrijednosti koje se ne spremaju u GitHub, React
`.env` ili Vercel varijable dostupne frontendu.

## Funkcije

Deployati obje funkcije:

```text
send-admissions-pin
verify-admissions-pin
list-school-admission-pins
```

Funkcije zahtijevaju prijavljenog Supabase korisnika. PIN je trajan, ponovno
slanje istog PIN-a moguce je nakon 60 sekundi, a nakon pet pogresnih pokusaja
unos se zakljucava na 15 minuta.

## Baza

Prije deploya funkcija pokrenuti migraciju:

```text
supabase/migrations/026_admissions_sms_pin_security.sql
supabase/migrations/027_convert_admissions_pin_to_permanent.sql
supabase/migrations/028_first_login_phone_activation.sql
```
