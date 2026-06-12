---
id: coder-invite-members
status: documented
app: openape-coder
issue: 585
tests:
  - apps/openape-coder/tests/coder-invite-members.test.ts
guide: invite-members
---

> Endpoint-Grün (2026-06-11, Etappe 2/4): alle App-Tests dieser Story sind
> grün — Invite- und Capability-Endpoints sind admin-only UND human-only
> (`requireHuman` → 403 für Agent-Token), Einladung leakt keine Existenz,
> Rate-Limit store-seitig, Audit auf Capability-Änderungen. `acceptInvite`
> hängt am ersten Sign-in (`requireUser` → `acceptPendingInvites`). Status
> bleibt bewusst `red`: green erst mit UI-Flow + Story-Kit-Guide (Etappe 3).

> Verfeinerung (2026-06-12): **kein E-Mail-Dienst.** Einladen heißt: der
> Eingeladene wird eine pending Mitgliedschaft, die beim ersten Sign-in still
> als read-only Member realisiert wird (war schon so) — und sieht diese
> Aufnahme als Benachrichtigung in einer **Inbox** auf seiner Startseite
> (Kriterium 8). Der „Einladungslink" ist in Wahrheit nur diese Notification;
> nichts läuft über unseren Server hinaus. Optional bietet die App dem Admin
> einen **`mailto:`-Link** (aus der eingegebenen Adresse + dem Projektnamen
> client-seitig gebaut), um die Person aus dem eigenen Mail-Client
> anzustupsen — rein optional, kein Server-Versand, kein Resend.

# Mitglieder einladen und Berechtigungen steuern

Als Projekt-Admin möchte ich andere Nutzer in mein Projekt einladen und pro
Member steuern, welche Funktionen sie nutzen dürfen (Admins können alles,
Members nur das selektiv Freigeschaltete), damit Stakeholder und Entwickler
genau die Rechte haben, die ihre Rolle braucht — und nicht mehr.

## Akzeptanzkriterien

1. WENN ein Admin eine Person per E-Mail-Adresse einlädt, DANN MUSS diese
   beim nächsten Sign-in mit der zugehörigen OpenApe-Identität als Member des
   Projekts erscheinen — ohne dass die App eine E-Mail versendet (kein
   Server-Versand, kein externer Mail-Dienst).
2. Ein neu aufgenommener Member MUSS zunächst nur lesen können
   (Basis-Recht); jede schreibende Funktion MUSS einzeln von einem Admin
   freigeschaltet werden.
3. WENN ein Admin die Berechtigungen eines Members ändert (freischalten oder
   entziehen), DANN MUSS die Änderung sofort wirken und mit Urheber und
   Zeitpunkt auditierbar festgehalten werden.
4. Ein Member DARF NICHT einladen oder Berechtigungen ändern können —
   unabhängig davon, welche Funktionen ihm sonst freigeschaltet sind.
5. Einladen und Berechtigungs-Steuerung DÜRFEN NICHT mit einem Agent-Token
   möglich sein, sondern nur in einer menschlichen Sitzung; ein Versuch per
   Agent-Token MUSS abgelehnt werden.
6. Die Einladungs-Funktion DARF NICHT preisgeben, ob eine E-Mail-Adresse
   bereits eine OpenApe-Identität oder andere Projekt-Mitgliedschaften
   besitzt.
7. WENN ein Admin in kurzer Zeit ungewöhnlich viele Einladungen verschickt,
   DANN MUSS die App weitere Einladungen vorübergehend ablehnen
   (Spam-Begrenzung) und das sichtbar mitteilen.
8. WENN ein eingeladener Nutzer sich anmeldet und dadurch Member wird, DANN
   MUSS er diese Aufnahme als Benachrichtigung in einer Inbox auf seiner
   Startseite sehen (Projektname + wer ihn hinzugefügt hat), und er MUSS die
   Benachrichtigung wegklicken können, sodass sie nicht wiederkehrt.

## Abhängigkeiten

- Einladungs-Mechanik: rein server-intern (pending Mitgliedschaft, Realisierung
  beim ersten Sign-in) — KEIN E-Mail-Versand, kein Resend. Inbox-Notification
  als sichtbarer Kanal; optionaler `mailto:`-Link nur als Client-Bequemlichkeit.
- Permission-Modell-Granularität: welche Funktionen sind pro Member einzeln
  schaltbar (Stories lesen/schreiben, Vision/Repos pflegen, …) und was ist
  Member-Basis-Recht
- Audit-Trail für Berechtigungs-Änderungen (wer, wann — Vision: auditierbar)
- `act:'human'`-Enforcement: Einladen + Berechtigungs-Steuerung nur für
  menschliche Sessions, nie für Agent-Token
- Abhängig von `coder-projects` (Projekte + Rollenmodell)
