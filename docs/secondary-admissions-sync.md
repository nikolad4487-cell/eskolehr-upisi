# Konačni upis i prijenos u e-Maticu

U **Provedba upisa** administrator ciljne ustanove ili glavni administrator odabire školsku godinu početka obrazovanja i koristi **Potvrdi upis i prenesi u e-Maticu**. Za srednju školu godina slijedi godinu završetka osnovne škole. Sam izračun rang-liste nije potvrda upisa.

Potvrda odmah stvara upis u e-Matici škole i programa iz prihvaćenog izbora. Prikazuje broj novih, postojećih i neuspjelih upisa, a pogreške po kandidatu ostaju vidljive. Škola zatim u e-Matici ili e-Dnevniku odabire razred i povlači učenike iz matičnih upisa.

Zajednička migracija održava se u repozitoriju `eskolehr-ematica`: `supabase/migrations/20261103192115_secondary_admissions_registry_class_sync.sql`. Primijenjena je na zajedničku bazu 3. 11. 2026. Potrebno je objaviti sva tri pripadajuća sučelja. Produkcijska izgradnja e-Upisa prolazi; SQL i browser provjere nalaze se u e-Matici.
