# e-Upisi

Samostalna React/Vite aplikacija za sustav ŠkoleHR.

## Vercel environment variables

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_APP_MODULE=upisi
```

## Supabase Auth

U Supabase Dashboardu pod Authentication > URL Configuration dodati:

```text
https://srednja.skolehr.xyz
https://fakulteti.skolehr.xyz
http://127.0.0.1:5173
```

## Globalni administrator

Sva tri sustava koriste isti Supabase Auth račun:

```text
skola@eskole.me
```

Račun prvo mora postojati u `Authentication > Users`. Nakon toga u SQL Editoru
pokrenuti:

```text
supabase/migrations/029_super_admin_school_admin_hierarchy.sql
supabase/migrations/032_configure_skolehr_global_super_admin.sql
```

Korisnik dobiva ulogu `super_admin`, nije povezan ni s jednom školom te može
upravljati školama, fakultetima, programima i glavnim administratorima škola
u e-Matici i na oba e-Upisi portala.

## SMS PIN za učenike

Pokrenuti SQL migraciju:

```text
supabase/migrations/026_admissions_sms_pin_security.sql
supabase/migrations/027_convert_admissions_pin_to_permanent.sql
supabase/migrations/028_first_login_phone_activation.sql
```

Zatim u Supabaseu postaviti Function secrets i deployati funkcije opisane u:

```text
supabase/functions/README.md
```

Lozinke se ne spremaju u javnu tablicu. Ostaju sigurno pohranjene u Supabase
Authu. Trajni PIN čuva se kao hash za provjeru i šifrirana vrijednost koju
može dohvatiti samo ovlaštena server-side funkcija za administratora škole.

## Local development

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```
