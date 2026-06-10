---
id: recovery-audit
status: green
app: openape-free-idp
issue: 462
tests:
  - apps/openape-free-idp/tests/recovery-history-store.test.ts
  - apps/openape-free-idp/tests/recovery-history-endpoint.test.ts
  - compose/demo/stories/idp-recovery.mjs
guide: recovery-history
---

> Green-Beweis: beide Vitest-Files (8 Tests, Kriterien 1-6) grün, Gesamtsuite,
> Lint und Typecheck grün. Der Story-Kit-Lauf (`recovery-history`) steht noch
> aus und kommt mit dem Demo-Stack-Lauf.

# Sichtbares Audit aller Wiederherstellungs-Ereignisse

Als Account-Inhaber möchte ich in meinen Konto-Einstellungen sehen, wer wann versucht
hat, mein Konto wiederherzustellen, und was daraus wurde (abgeschlossen, abgebrochen,
abgelaufen), damit ich Angriffsversuche erkenne, statt dass sie nur in flüchtigen
Server-Logs landen.

## Akzeptanzkriterien

1. WENN ein Wiederherstellungs-Ereignis eintritt (Anfrage, Abbruch, Abschluss,
   Ablauf), DANN MUSS es dauerhaft aufgezeichnet werden und einen Server-Neustart
   überstehen — flüchtige Log-Ausgaben genügen nicht.
2. WENN der angemeldete Inhaber seine Konto-Einstellungen öffnet, DANN MUSS er dort
   die Historie aller Wiederherstellungs-Versuche sehen: Zeitpunkt, Herkunft der
   Anfrage (soweit bekannt, z. B. IP-Adresse und Gerät/Browser) und Ausgang
   (laufend, abgeschlossen, abgebrochen oder abgelaufen).
3. WENN ein Versuch noch läuft, DANN MUSS er in der Historie als laufend erscheinen,
   inklusive des Zeitpunkts, ab dem er abgeschlossen werden könnte; WENN seine Frist
   ungenutzt verstrichen ist, DANN MUSS er als abgelaufen erscheinen.
4. Die Recovery-Historie DARF NUR dem angemeldeten Konto-Inhaber zugänglich sein;
   ohne Anmeldung oder für fremde Konten DARF sie NICHT abrufbar sein.
5. Die Historie DARF KEINE nutzbaren Geheimnisse preisgeben — insbesondere keine
   Links oder Token, mit denen eine Wiederherstellung abgeschlossen oder abgebrochen
   werden könnte.
6. Einträge der Historie DÜRFEN über die Konto-Oberfläche NICHT veränderbar oder
   löschbar sein — auch nicht vom Inhaber selbst.

## Abhängigkeiten

- `recovery_tokens` behält zwar Audit-Spalten (consumed/cancelled/cancelledAt/
  cancelledReason/requestIp/requestUserAgent), aber das `RecoveryStore`-Interface
  hat keine Historien-Abfrage: `listActiveForEmail` filtert consumed/cancelled/
  abgelaufene Einträge heraus (`modules/nuxt-auth-idp/.../recovery-store.ts`) —
  eine `listAllForEmail`-/History-API ist nötig; Retention für den
  Unstorage-Fallback-Store klären.
- „Abgelaufen" ist kein gespeicherter Status, sondern abgeleitet
  (`expiresAt < now`) — Anzeige muss ableiten oder Ereignisse materialisieren.
- Konto-Einstellungen: Sektion plus authentifizierter Endpoint für die
  Recovery-Historie existieren noch nicht.
