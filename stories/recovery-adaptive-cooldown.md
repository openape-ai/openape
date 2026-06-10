---
id: recovery-adaptive-cooldown
status: approved
app: openape-free-idp
issue: 462
tests: []
guide: null
---

# Adaptive Wartefrist bei Account-Wiederherstellung

Als Account-Inhaber möchte ich, dass die Wartefrist einer Account-Wiederherstellung
von meiner Konto-Aktivität abhängt — kurz für lange ungenutzte Konten, lang für aktiv
genutzte, am längsten im Urlaub —, damit ein Angreifer mein aktiv genutztes Konto
nicht schnell übernehmen kann, ich ein verwaistes Konto aber zügig zurückbekomme.

Rahmen aus Issue #462: aktiv in den letzten 30 Tagen → 7 Tage; Urlaubs-Schalter
gesetzt → 14 Tage (vom Nutzer konfigurierbares Maximum); 30+ Tage inaktiv → 72 h
(heutiger Default).

## Akzeptanzkriterien

1. WENN eine Wiederherstellung für ein Konto angefragt wird, dessen Inhaber sich in
   den letzten 30 Tagen angemeldet hat, DANN MUSS die Wartefrist 7 Tage betragen.
2. WENN eine Wiederherstellung für ein Konto angefragt wird, dessen Inhaber sich
   30 Tage oder länger nicht angemeldet hat und dessen Urlaubs-Schalter nicht gesetzt
   ist, DANN MUSS die Wartefrist 72 Stunden betragen.
3. WENN der Urlaubs-Schalter gesetzt ist, DANN MUSS die vom Inhaber konfigurierte
   Urlaubs-Frist gelten (Standard und Obergrenze: 14 Tage) — unabhängig von der
   Konto-Aktivität; eine Frist über 14 Tagen DARF NICHT einstellbar sein.
4. Der Urlaubs-Schalter und die Urlaubs-Frist DÜRFEN NUR vom angemeldeten
   Konto-Inhaber in seinen Konto-Einstellungen geändert werden.
5. WENN eine Wiederherstellung angefragt wird, DANN MUSS die Wartefrist zum Zeitpunkt
   der Anfrage verbindlich festgelegt werden; spätere Anmeldungen oder
   Einstellungs-Änderungen DÜRFEN eine bereits laufende Frist NICHT verkürzen.
6. Die Warn-Benachrichtigung an den Inhaber MUSS den tatsächlichen Zeitpunkt nennen,
   ab dem die Wiederherstellung abgeschlossen werden kann; die Antwort an den
   Anfragenden DARF NICHT verraten, ob das Konto existiert oder welche Frist gilt.
7. Vor Ablauf der Wartefrist DARF die Wiederherstellung NICHT abgeschlossen werden
   können; ihr Abschluss DARF NIE eine angemeldete Sitzung erzeugen, sondern nur die
   Registrierung eines neuen Passkeys erlauben.

## Abhängigkeiten

- `users`-Tabelle hat kein `lastLoginAt`/Aktivitäts-Feld
  (`apps/openape-free-idp/server/database/schema.ts`) — muss ergänzt und beim Login
  gepflegt werden; der Login-Flow liegt im Modul `nuxt-auth-idp`, das Schema in der
  App → Schnittstelle/Hook nötig.
- Kein Urlaubs-Schalter und keine per-User-Recovery-Einstellung (konfigurierbares
  Maximum) — neues Feld bzw. Settings-Tabelle plus Konto-Einstellungen-UI.
- Cooldown ist statisch: `COOLDOWN_MS = 72 * HOUR_MS` hardcoded in
  `apps/openape-free-idp/server/api/recovery/request.post.ts` — muss pro Nutzer
  dynamisch aus Aktivität/Urlaubs-Schalter berechnet werden.
