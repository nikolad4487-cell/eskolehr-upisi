# Migracija korisnika na `@skolehr.xyz`

Funkcija `migrate-email-domain` mijenja postojeće Supabase Auth račune s
`@eskole.me` na `@skolehr.xyz` bez promjene korisničkih ID-eva i povezanih
podataka. Također stvara ili ažurira `skola@skolehr.xyz` kao globalnog
`super_admin` korisnika.

## Postavljanje

1. U Supabaseu otvorite **Edge Functions** i napravite funkciju
   `migrate-email-domain`.
2. Za **Via Editor** zalijepite sadržaj datoteke
   `supabase/functions-editor/migrate-email-domain/index.ts`.
3. U **Project Settings > Edge Functions > Secrets** dodajte tajni ključ
   `EMAIL_DOMAIN_MIGRATION_SECRET`.
4. Isključite JWT provjeru za ovu jednokratnu funkciju (zaštita se radi zasebnim
   `x-migration-secret` zaglavljem), zatim je deployajte. Kod CLI deploya koristite
   `supabase functions deploy migrate-email-domain --no-verify-jwt`.

## Jednokratno pokretanje

U PowerShellu pokrenite, uz vlastite vrijednosti:

```powershell
$projectRef = "VAŠ_SUPABASE_PROJECT_REF"
$migrationSecret = "VAŠ_DUGI_MIGRACIJSKI_KLJUČ"
$superAdminPassword = "NOVA_LOZINKA"

$headers = @{
  "Content-Type" = "application/json"
  "x-migration-secret" = $migrationSecret
}

$body = @{
  super_admin_password = $superAdminPassword
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://$projectRef.supabase.co/functions/v1/migrate-email-domain" `
  -Headers $headers `
  -Body $body
```

Nakon uspješne migracije izbrišite secret `EMAIL_DOMAIN_MIGRATION_SECRET` ili
uklonite funkciju. Lozinka se ne zapisuje u repozitorij niti se vraća u odgovoru.
