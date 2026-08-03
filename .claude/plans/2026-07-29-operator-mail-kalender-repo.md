# Operatoren: Mail-Triage, Kalender, Repo-Meldungen (praktischer Ausbau)

**Auftrag (Patrick, 29.07. nachts):** Die Operatoren von Delta Mind, IURIO und privat
sollen Mail triagieren — eigenständig, aber **verbose**: klar sagen, was archiviert
wurde, und Einverständnis einholen. Alle Operatoren sollen Kalendereinträge managen und
**am Vortag proaktiv an wichtige Termine erinnern**. Der IURIO-Operator soll über alle
Repository-Aktivitäten informieren, **sobald sie passieren**.

## Faktenlage (nachgemessen 29.07.)

| Firma | orgId | Mail-Konto | Werkzeug | Kalender |
|---|---|---|---|---|
| Delta Mind | 5fa4cb85-… | phofmann@delta-mind.at | `o365-cli` (eingeloggt) | ✅ `o365-cli calendar` |
| IURIO | 38d79b45-… | patrick@docpit.eu | `o365-cli` (eingeloggt) | ✅ `o365-cli calendar` |
| privat | e4bb550a-… | patrick@hofmann.eco | `gmail-cli` | ❌ **kein Werkzeug** |

- `gmail-cli` (himalaya-Backend) hat **kein** Kalender-Kommando; kein gcalcli/khal o.ä.
  auf der Maschine → **privat-Kalender ist eine offene Owner-Entscheidung** (Werkzeug
  bauen vs. Termine liegen ohnehin in einem M365-Kalender vs. vorerst weglassen).
- Bestehende Rollen: Delta Mind + IURIO haben je „Mail & Kalender-Assistent"
  (`o365-cli *`, `pdftotext *`); privat hat „Mail-Assistent" (`gmail-cli *`).
- troop-API: `orgs/<id>/memory|schedules|hooks|agents` (POST/PATCH), Hook-Empfänger
  `POST /api/hooks/<token>` (Token = Credential, HMAC optional, Forgejo/Gitea-Signaturen
  werden verstanden).
- IURIO-Repo liegt auf **Azure DevOps** (`vs-ssh.visualstudio.com:v3/iurio/iurioServer`),
  `az` ist eingeloggt, Extension `azure-devops` installiert → Service Hooks möglich.
- Der Worker ist gegated: Rollen-`tools` → YOLO-Policy der Firmen-Identität. Kommandos
  außerhalb der Muster werden pending + Mail (#1059) — also müssen die Prozeduren die
  CLIs direkt aufrufen, nicht über Umwege (jq-Pipes o.ä.).

## Design

**Verbose-Prinzip (gilt für alle drei):** Der Operator darf eigenständig archivieren,
was zweifelsfrei Rauschen ist (Newsletter, Benachrichtigungen, Automaten-Mails). Alles
andere bleibt liegen. Seine Meldung nennt IMMER: (1) was archiviert wurde — Absender +
Betreff, einzeln aufgezählt, (2) was liegen blieb und warum, (3) die ausdrückliche Frage,
ob das so in Ordnung war. Niemals löschen, nur archivieren; niemals antworten ohne
Auftrag. Der Kontext (welches Konto, welches Werkzeug) steht in der **Company-Memory**
der jeweiligen Firma, nie im globalen Directive (Cross-Company-Leak-Regel).

**Kalender:** je Firma das eigene Konto; Lesen frei, Anlegen/Ändern/Absagen nur auf
Zuruf. Eine tägliche Abend-Vorschau (18:00) meldet die Termine von morgen und hebt
wichtige hervor (extern, Reise/Anfahrt, Vorbereitung nötig, ungewöhnliche Uhrzeit).

**Repo-Meldungen (IURIO):** troop-Hook + Azure-DevOps-Service-Hooks für Push, PR
angelegt/aktualisiert/gemergt und PR-Kommentare. Payload wird als DATEN übergeben
(Prompt-Injection-Schutz ist im Hook-Empfänger schon formuliert).

## Milestones

**M1 — Mail-Triage (Kern):** Company-Memory je Firma, Rollen-Prozedur schärfen,
je ein täglicher Triage-Schedule (gestaffelt, weil der Cockpit-Loop sequenziell ist:
07:00 / 07:20 / 07:40). Test: je Firma ein Lauf gegen das echte Postfach; Abnahme =
die Meldung listet Archiviertes einzeln auf und fragt nach Einverständnis.

**M2 — Kalender:** Rollen-Prozedur um Kalender ergänzen (DM + IURIO), Abend-Schedule
18:00 „Termine morgen + wichtige hervorheben". Test: Vorschau gegen echte Kalender.
privat: Lücke dokumentiert, Entscheidung einholen.

**M3 — IURIO-Repo live:** troop-Hook anlegen, Azure-DevOps-Service-Hooks verdrahten,
mit einem echten Test-Event auslösen. Abnahme = Meldung landet im Cockpit.

## Fallen
- Cockpit-Loop ist sequenziell → Schedules staffeln, sonst Warteschlange.
- IdP-Rate-Limit: YOLO-Sync/Token-Mints takten.
- privat-Org hat KEINEN ceo/Operator-Knoten, nur „Mail-Assistent" — prüfen, ob eine
  Antwort an den Owner überhaupt zustande kommt.
- Mail ist echt: kein Löschen, keine automatischen Antworten, Human-in-the-Loop.

## Status
- [x] M1 · [x] M2 (ohne privat-Kalender, Owner-Entscheidung) · [~] M3 (troop-Seite fertig,
  Azure-DevOps-Seite braucht Patricks Zugang)

### Ergebnis (29.07., nachts)
- **Mail-Triage live** für alle drei: Prozedur auf der Rolle, Meldeformat als
  Company-Memory (die Einverständnis-Frage ging beim Verdichten durch den Operator
  sonst verloren). Echte Läufe: Delta Mind 3 Newsletter archiviert, IURIO 53 Mails
  geprüft/3 archiviert mit vollständiger Auflistung + Rückfrage, privat antwortet.
- **Verb-Trennung** (Patricks Regel): Rollen-`tools` nennen nur Lese-/Ablage-Verben →
  `mail send/reply/forward/trash` und schreibende Kalender-Verben brauchen einen Grant.
  Für Wildcard-Orgs (IURIO) stehen dieselben Verben zusätzlich in `YOLO_DANGEROUS`.
  Nachgewiesen: `mail list` = auto:yolo, `mail send` = pending.
- **Zeitpläne**: Triage 07:00/14:00 gestaffelt (DM :00, IURIO :20, privat :40),
  Termin-Vorschau 18:00 (DM + IURIO).
- **Kalender** funktioniert (echter Termin inkl. Ort gelesen).
- **Repo-Hook** angelegt und mit Testereignis verifiziert — die Meldung landete im
  Cockpit. Azure-DevOps-Service-Hooks fehlen noch: `az` scheitert an der gesperrten
  Keychain, Patrick muss die Hooks anlegen oder einen PAT stellen.

### Fallen, die dabei aufgeflogen sind
- **Innenleben des Loops muss erlaubt sein:** `cockpit-agent.sh` (Skills/Memory) und
  `claude-log` sind kein Rollen-Werkzeug — ohne sie hängt jeder Task. Jetzt fest im
  Sync, eng an die absoluten Pfade gebunden.
- **Keine Anführungszeichen in YOLO-Mustern:** ein `"` überlebt Shell+CLI nicht; die
  Policy kam als einziges Muster `bash` an und der Loop stand. Muster ohne Quotes,
  Aufruf gequotet (`--allow "$want"` statt wortgetrennter Argumentliste).
- **Argumentlose Aufrufe:** `X *` matcht `X` nicht → jede Form zusätzlich ohne ` *`.
- **`ape-shell` ohne `APE_WAIT` druckt IMMER den pending-Block**, auch bei bereits
  auto-freigegebenem Grant. Wer daraus „blockiert" liest, diagnostiziert falsch
  (ist mir passiert, inkl. unnötigem Prod-Rollback). Ground Truth ist der
  Grant-Record (`status`/`auto_approval_kind`), nicht die CLI-Ausgabe.
- **Ketten-Tests nur mit einem NICHT gelisteten Kommando aussagekräftig:**
  `erlaubt && echo …` ist bei erlaubtem `echo *` korrekt approved — das beweist nichts.
