---
id: recovery-broadcast
status: approved
app: openape-free-idp
issue: 462
tests: []
guide: null
---

# Wiederherstellungs-Warnung auf allen Kanälen mit Ein-Tap-Abbruch

Als Account-Inhaber möchte ich bei jedem Wiederherstellungs-Versuch auf allen meinen
Geräten (Push) und über alle je mit meinem Konto verknüpften E-Mail-Adressen gewarnt
werden und den Versuch mit einem Tap abbrechen können, damit ein einzelnes
kompromittiertes Postfach die Warnung nicht geräuschlos verschlucken und die
Übernahme nicht unbemerkt durchlaufen kann.

## Akzeptanzkriterien

1. WENN eine Wiederherstellung angefragt wird, DANN MUSS eine Warnung als
   Push-Benachrichtigung an alle Geräte des Inhabers mit registrierter
   Push-Subscription gesendet werden.
2. WENN eine Wiederherstellung angefragt wird, DANN MUSS eine Warn-E-Mail an alle
   jemals mit dem Konto verknüpften Adressen gesendet werden — auch an ehemalige,
   inzwischen ersetzte Adressen.
3. WENN der Inhaber in einer Push-Benachrichtigung oder Warn-E-Mail auf „Abbrechen"
   tippt, DANN MUSS der Wiederherstellungs-Versuch sofort und ohne Anmeldung oder
   weitere Zwischenschritte abgebrochen werden; das gilt während der gesamten
   Wartefrist.
4. WENN ein Versuch abgebrochen wurde, DANN MUSS er dauerhaft abgebrochen bleiben —
   er DARF auch nach Ablauf der Wartefrist NICHT mehr abgeschlossen werden können.
5. Der Abbruch-Mechanismus DARF NICHT zum Abschließen der Wiederherstellung oder zum
   Anmelden nutzbar sein; nur die aktuelle Konto-Adresse DARF den Link zum
   Abschließen der Wiederherstellung erhalten — Warnungen an ehemalige Adressen und
   Push-Benachrichtigungen enthalten ausschließlich Warnung und Abbruch.
6. WENN die Zustellung auf einem Kanal fehlschlägt (z. B. eine unzustellbare Adresse
   oder eine abgelaufene Push-Subscription), DANN MÜSSEN die Warnungen auf allen
   übrigen Kanälen trotzdem zugestellt werden.
7. Wiederholte Wiederherstellungs-Anfragen für dasselbe Konto MÜSSEN begrenzt werden,
   sodass der Warn-Versand nicht als Belästigungs- oder Spam-Kanal gegen den Inhaber
   missbraucht werden kann.

## Abhängigkeiten

- Keine E-Mail-Alias-/Historien-Tabelle: `users` kennt genau eine E-Mail (Primary
  Key, `apps/openape-free-idp/server/database/schema.ts`) — „alle je verknüpften
  Adressen" braucht eine neue Tabelle (Aliase inkl. Historie ehemaliger Adressen).
- Push-Store-Grenze App vs. Modul: `push_subscriptions` liegt im App-Schema
  (Milestone 7, gebaut für Grant-Approver); die Recovery-Endpoints des Moduls
  `nuxt-auth-idp` (cancel/verify/options) kennen keinen Push — Versand-Hook bzw.
  Interface zwischen App und Modul nötig.
- Ein-Tap-Abbruch: tokenisierte Cancel-URL existiert bereits für Mail
  (`/recover/cancel?token=…` in `request.post.ts`); für Push-Payloads muss derselbe
  Token-Mechanismus angebunden werden — der Modul-Endpoint
  `api/recovery/cancel.post.ts` verlangt heute eine Session.
