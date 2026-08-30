# OpenApe CRM — Variante B (Fokus) in Produktion

**Status:** approved · **Datum:** 2026-08-27
**Quelle UI:** `apps/openape-crm/demo/variante-b-fokus.html`
**Quelle Fachlogik:** `apps/openape-crm/demo/data.js` (CRM_Anforderungsspezifikation v1.0)
**App:** `apps/openape-crm` (crm.openape.ai)

## Ziel

Ein eingeloggter Nutzer arbeitet im CRM wie in Demo-Variante B: drei Spalten (Rail, Liste, Detail), drei feste Phasen Lead / Deal / Kunde, Verträge und Angebot, persönliche Outlook-Inbox, Versand und OneDrive über Microsoft Graph (ein O365-Konto), Aufgaben, Katalog, Suche per ⌘K. Nach dem Umbau gibt es kein Kanban und keine editierbare Pipeline mehr.

## Nicht-Ziele

- Elektronische Signatur mit Beweisspur (Zeichnung, IP, qualifizierte Signatur, DocuSign). Signatur ist ein Stub.
- Shared Mailbox `support@` — weder Inbox noch Versand.
- Microsoft-Graph-Anbindung als eigener Dienst.
- Anbindung an `openape-tasks`.
- Rechnungsstellung, Zahlungen, Dokumentensafe als Produkt.
- Datei-Bytes in der CRM-DB (LibSQL-Blobs, S3). Dokumente leben in OneDrive.
- Kanban-Ansicht und nutzerdefinierte Stufen.

## Bauweg

Eine App, vier Scheiben. Jede Scheibe ist allein deploybar und testbar. Graph ist echt, aber nicht der erste Commit.

1. Shell + Vorgänge + Migration + Historie + Kontakte in der Shell + ⌘K
2. Katalog + Verträge + Angebots-Wizard + Signatur-Stub (Versand und PDF-Ablage warten auf Graph)
3. Microsoft Graph: ein O365-Konto pro Nutzer für Inbox, Versand, Termine/Teams **und** OneDrive
4. Aufgaben

## Shell und Navigation

Layout 1:1 aus Variante B: Grid `52px | 300px | 1fr`, Höhe Viewport, kein Seitenwechsel für die tägliche Arbeit.

**Rail:** Vorgänge, Aufgaben, Support, Kontakte, Katalog. Unten: Suche (`⌘K`) und User-Menü (Workspace wechseln, Mitglieder/Einladen, Microsoft verbinden).

**Liste:** Master zur aktuellen Rail-Auswahl. Bei Vorgängen Segmentsteuerung Lead / Deal / Kunde; darunter Gruppen pro fester Stufe.

**Detail:** geöffneter Vorgang. Kopf (Firma, Phase-Pill, Titel, Personen), Aktionen (Mail, Termin, Angebot erstellen), Pipeline-Track (Klick setzt Stufe), Historie, Verträge, Sidebar Firma / Personen / Aufgaben / Dokumente. Angebot als Slide-over von rechts.

**Look:** Demo-Tokens. Hintergrund `#0c0e13`, Panel `#12151c`, Akzent `#7c6cff`. Nicht Emerald/Zinc-Kanban. Primärfarbe in `app.config.ts` entsprechend (Violett-Skala, nicht `emerald`).

**Routen**

| URL | Inhalt |
|-----|--------|
| `/` und `/board` | Redirect auf `/vorgaenge` |
| `/vorgaenge` | Pane Vorgänge; Query `phase`, `id` |
| `/aufgaben` | Pane Aufgaben |
| `/support` | Pane Support (Graph-Inbox + CRM-Threads) |
| `/support/:id` | Thread im Slide-over |
| `/kontakte` | Pane Firmen & Personen |
| `/katalog` | Pane Preiskatalog |
| `/anfrage` | Öffentliches Webformular, kein Login |
| `/workspace` | Mitglieder und Einladen (User-Menü) |
| `/invite`, `/docs`, Login | unverändert |

Login leitet nach `/vorgaenge` weiter (heute `/board`).

## Feste Pipelines

Phasen und Stufen sind Code, nicht Daten. Tabelle `pipeline_stages` entfällt. APIs zum Anlegen, Umbenennen, Verschieben und Löschen von Stufen entfallen.

| Phase | Stufe (Key) | Label | Besonderheit |
|-------|-------------|-------|--------------|
| lead | kalt | Kalter Lead | |
| lead | warm | Warmer Lead | |
| lead | kontaktiert | Kontaktiert | |
| lead | konvertiert | Zu Deal konvertiert | Endmarker → `deal` |
| lead | disqualifiziert | Disqualifiziert | Endstufe |
| lead | blacklist | Blacklist | Endstufe |
| deal | inbound | Inbound | |
| deal | termin | Termin vereinbart | |
| deal | demo | Demo durchgeführt | |
| deal | followup | Follow-up-Phase | |
| deal | angebot | Angebotsphase | |
| deal | gewonnen | Gewonnen | Endmarker → `kunde` |
| deal | spaet | Abschluss spät oder unwahrscheinlich | |
| deal | verloren | Final verloren | Endstufe |
| kunde | onboarding | Onboarding | |
| kunde | zahlend | Zahlender Kunde | |
| kunde | abwehr | Kündigungsabwehr | |
| kunde | gekuendigt | Final gekündigt | Endstufe |

**Endmarker:** `setzeStufe` setzt bei Endmarker-Stufe `phase` auf die Zielphase und `stufe` auf deren erste Stufe, plus Historienzeile. Sonst nur `stufe`. Landestufen: Deal → `inbound`, Kunde → `onboarding`.

Konstante und Funktion leben in `apps/openape-crm/shared/pipelines.ts` (ersetzt die Rollen von `shared/stages.ts` für Laufzeit; Outcome `open/won/lost` entfällt als Steuergröße).

## Datenmodell

LibSQL / Drizzle, workspace-scoped wie bisher. UI-Sprache Deutsch, Tabellennamen Englisch. Die Tabelle `deals` bleibt der Vorgang (kein Rename, weniger Migrationsbruch).

### Vorgang (`deals`)

Neue Spalten: `phase` (`lead` \| `deal` \| `kunde`), `stufe` (Key aus der Tabelle oben). Bestehende `stage` wird nach Migration fallen gelassen. `title`, `org_id`, `position`, `created_by`, `created_at` bleiben. `value_cents` bleibt als Anzeigewert, **solange der Vorgang keinen Vertrag hat**; sobald mindestens ein Vertrag existiert, ist die Anzeigesumme die Summe der Vertragswerte (Cent, Währung des neuesten Vertrags — bei gemischten Währungen getrennt je Vertrag zeigen, nicht addieren).

`contact_id` am Deal entfällt zugunsten von `deal_contacts` (n:m).

### Firma (`organizations`)

Dazu: `website`, `address`, `postal_code`, `city`, `country`. `domain` bleibt.

### Person (`contacts`)

Dazu: `first_name`, `last_name`, `title`, `gender`. `name` bleibt denormalisiert als Anzeigename (`[title, first_name, last_name]` bzw. bisheriger `name` nach Migration). E-Mails und Telefone: Tabellen `contact_emails` und `contact_phones` (Reihenfolge). Nach der Migration entfallen `contacts.email` und `contacts.phone`.

### Produkte (`products`)

Pro Workspace: `name`, `description`, `standard_price_cents`, `standard_billing` (`monatlich` \| `jaehrlich` \| `einmalig` \| `verwendung`).

### Verträge (`contracts`) + Positionen (`contract_lines`)

Am Vorgang: `status` (`offen` \| `aktiv` \| `fertig` \| `gekuendigt`), `start_date`, `minimum_term_months` (nullable), `currency`, `offer_number`, optionale OneDrive-`item_id` + `web_url` für Angebots-PDF und Stub-Signatur-PDF.

Position: `product_id`, `price_cents`, `discount_cents`, `billing`.

**Abgeleitet, nie gespeichert:**

- Positionsbetrag = Preis − Rabatt
- Vertragswert = Summe der Positionen
- Vertragsart = `einmalig` / `laufend` / `gemischt` (Billing `einmalig` vs. Rest)
- Vertragsende = Start + Mindestlaufzeit in Monaten, nur wenn Mindestlaufzeit gesetzt

Währungen wie in der Demo: EUR, CHF, USD, GBP, SEK, NOK, DKK, PLN, CZK, HUF, CAD, AUD, JPY.

Angebotsnummern: `AG-{Jahr}-{laufend}` pro Workspace, dreistellig, z.B. `AG-2026-042`.

### Historie (`notes` erweitern oder `activities`)

Typ `mail` \| `notiz` \| `aufgabe` \| `termin` \| `dokument`. Titel, Text, Autor, Zeit. Bestehende Notizen werden Typ `notiz`, Titel „Notiz“.

### Dateien (`deal_files`)

Keine Bytes in der CRM-DB. Pro Eintrag: Graph `drive_item_id`, `web_url`, `name`, `size`, `mime`, `deal_id`, optionales `contract_id`. Öffnen heißt die `web_url` (OneDrive / Office im Browser), nicht ein CRM-Download.

Pro Vorgang ein Ordner im OneDrive des verbundenen Kontos: `OpenApe CRM/{workspace-id}/{deal-id}/`. Liste „Dokumente“ am Vorgang ist der Graph-Inhalt dieses Ordners (direkt, live). Hochladen und Angebots-PDFs landen dort per Graph `PUT`. Beim Anlegen eines Items speichert das CRM zusätzlich einen Organisations-Sharing-Link (`webUrl` mit Tenant-Scope), damit andere CRM-Nutzer im selben M365-Tenant die Datei in OneDrive öffnen können. Fehlt die Graph-Verbindung, sind Upload und Liste der Connect-Hinweis.

### Aufgaben (`tasks`)

Am Vorgang: Titel, Beschreibung, Fällig, `assignee_email`, `status` `offen` \| `erledigt`.

### Threads (`threads` + `thread_messages`)

`subject`, `status` (`neu` \| `warten_kunde` \| `warten_uns` \| `abgeschlossen`), `source` (`mail` \| `webformular` \| `automatisch`), optionales `deal_id`, optionales Graph-`internetMessageId` für Dedup.

Nachrichten: `from_address`, `body`, `at`.

### Graph-Verbindung (`graph_accounts`)

Ein Datensatz pro Nutzer (E-Mail aus der CRM-Session): verschlüsselter Refresh-Token, Graph-User-ID, Mailadresse des O365-Kontos, Subscription-ID und Ablauf für Inbox-Webhook. Ein Nutzer hat genau ein verbundenes Konto. Kein Workspace-Postfach.

## Migration bestehender Daten

Beim Deploy / erster DB-Öffnung nach Schema-Update:

1. Jeder Deal wird `phase = 'deal'`.
2. Mapping über das bisherige Stufen-`outcome`: `open` → `stufe = inbound`, `won` → `gewonnen`, `lost` → `verloren`. Freie Stufennamen gehen verloren. Gewonnene Deals werden **nicht** nach Phase Kunde geschoben.
3. `deal_contacts` aus `deals.contact_id`, wenn gesetzt.
4. Notizen → Historie Typ `notiz`.
5. `pipeline_stages` droppen.
6. Kontakt: `name` bleibt; `first_name`/`last_name` leer, bis jemand sie pflegt. `contacts.email` → erste Zeile in `contact_emails`, `contacts.phone` → `contact_phones`; danach die beiden alten Spalten droppen.

Workspaces ohne Deals starten leer in den drei Phasen (kein Seed der Demo-Firmen).

## Microsoft Graph

**Ein O365-Konto pro CRM-Nutzer erledigt Inbox, Versand und OneDrive.** Kein zweites Postfach, kein `support@`, kein CRM-Dateispeicher.

Voraussetzung: Azure-App (Delegated), Redirect `https://crm.openape.ai/api/auth/microsoft/callback` und lokal der Dev-Origin, Admin-Consent, Secret `NUXT_GRAPH_TOKEN_SECRET` (Token-Verschlüsselung). Scopes: `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `Files.ReadWrite`, `offline_access`, `User.Read`.

**Verbinden:** User-Menü „Microsoft verbinden“ → OAuth → Token verschlüsselt in `graph_accounts`. Ohne Verbindung: Mail, Termin, Support-Pane und Dokumente zeigen denselben Hinweis und den Connect-Button. Kein stilles Fehlschlagen.

**Versand am Vorgang:** Graph `sendMail` vom verbundenen Konto an die Personen des Vorgangs. Danach Historienzeile Typ `mail`. Absender ist immer das verbundene Konto (keine Absenderwahl).

**Termin:** Graph-Event im Kalender des Kontos, `isOnlineMeeting: true`, Teilnehmer = Kontakt-Mails. Teams-Join-URL aus der Response in die Historie Typ `termin`.

**Inbox:** In Produktion Graph-Subscription auf den Inbox-Ordner (`NUXT_GRAPH_WEBHOOK_URL` muss öffentlich HTTPS sein). Notification → CRM-Webhook → Nachricht laden. Lokal ohne Webhook-URL: Support-Pane lädt die Inbox per Graph-List (Pull) beim Öffnen, keine Subscription.

- Absender oder Empfänger (außer dem verbundenen Konto selbst) matcht `contact_emails` → Thread `source=mail`, falls möglich an den Vorgang der Person hängen, plus Historienzeile am Vorgang.
- Kein Match → Thread ohne `deal_id`. Im Thread: „Vorgang anlegen“.
- Nachrichten, die das CRM selbst gerade gesendet hat, nicht doppelt anlegen (`internetMessageId`).
- Kein Speichern des Mail-Bodies, wenn weder Absender noch andere Empfänger ein Kontakt sind.

**Antwort im Support-Pane:** Graph `sendMail` / Reply vom selben Konto, Thread-Status wie in der Demo, Kopie in `thread_messages`.

**OneDrive:** Derselbe Token. Ordner des Vorgangs anlegen falls nötig, Kinder listen, Datei hochladen, `webUrl` zurückgeben. Klick im CRM öffnet OneDrive (neuer Tab) — kein Proxy, kein Blob. Zusätzlich „In OneDrive öffnen“ auf den Ordner (`webUrl` des Folders). Mail-Anhänge beim Angebotsversand sind die OneDrive-Items (Graph: Item als Attachment), nicht CRM-Bytes.

Token-Refresh serverseitig. Subscription vor Ablauf erneuern (Graph-Subscriptions leben wenige Tage). Graph-Fehler als Problem-Response; keine halbe Historie ohne erfolgreichen Graph-Call.

## Angebot und Signatur-Stub

Wizard (Slide-over, fünf Schritte) wie Variante B: Kundendaten (readonly aus Vorgang) → Produkte (Positionen, Währung, Start, Mindestlaufzeit) → Bedingungen + Hinweis Lizenzvertrag → Versand → Stub-Signatur.

**Versand (Schritt 4):** Vertrag `offen` anlegen, Angebots-PDF erzeugen, per Graph in den OneDrive-Ordner des Vorgangs legen, Graph-Mail an die erste Kontakt-Mail mit diesem OneDrive-Item als Anhang. Historie Typ `mail`. Es gibt **keinen** öffentlichen Signatur-Link. Ohne Graph-Verbindung ist „Versenden“ disabled.

**Signatur (Schritt 5 und Button am offenen Vertrag):** Stub. Ein Klick „Unterzeichnen“ / „Signatur simulieren“:

1. `status = aktiv`
2. Platzhalter-PDF nach OneDrive (Kopie des Angebots oder Stempel „signiert (Stub)“ — keine EES, keine IP, keine Zeichnung); `web_url` am Vertrag
3. Historie Typ `dokument`
4. Thread `source=automatisch`, Status `neu`, Nachricht dass das Angebot signiert wurde
5. Steht der Vorgang in Phase Deal: `setzeStufe(..., 'gewonnen')` → Phase Kunde, Stufe Onboarding

Lizenzvertrag: statisches PDF im Repo, wird beim Versand mit nach OneDrive gelegt und der Graph-Mail angehängt. Kein Vorlagen-Editor.

## Support-Pane und Webformular

Die Liste im Support-Pane mischt:

1. Mails der Graph-Inbox des verbundenen Kontos (`source=mail`)
2. CRM-Threads `webformular` und `automatisch`

Filter Alle / Neu. Rot-Punkt in der Rail bei Status `neu`.

`/anfrage` (öffentlich): Name, Firma, E-Mail, Nachricht → Thread `webformular` ohne Graph-Versand (es gibt kein System-Postfach). Der Thread hängt am ältesten nicht-archivierten Workspace; gibt es keinen, antwortet die API `503`. Unzugeordnet, bis jemand den Absender einem Kontakt zuordnet oder einen Vorgang anlegt.

## Suche

⌘K / Ctrl+K öffnet die Palette. Query gegen Vorgangstitel, Firma, Personen inkl. E-Mails, Historie-Volltext. Max. 12 Treffer. Person/Firma ohne Vorgang: Toast „Kein Vorgang zu diesem Treffer“. Escape schließt.

## Fehler und Rechte

Bestehende Workspace-Rollen bleiben: Owner/Manager/Member sehen dieselben Vorgänge; Einladen bleibt Owner/Manager. Stufen sind nicht mehr konfigurierbar, also entfällt `canEditStages`.

Problem-Responses wie heute (`problem.ts` / `problem-message.ts`). Graph-Connect und Graph-Calls nutzen dasselbe Muster.

## Tests

- Unit: Port von `demo/check-logik.mjs` — Endmarker, `vertragsArt`, `vertragsende`, Signatur-Stub-Nebenwirkungen (Vertrag aktiv, Thread automatisch, Phase Kunde), Suche.
- API: Vorgang anlegen/verschieben, Vertrag anlegen, Stub-Signatur, Aufgabe, Produkt, öffentliche `/anfrage`.
- Graph: gegen Fake (kein echtes Azure in CI). Connect-Zustand, Send → Historie nur nach Erfolg, Inbox-Match auf Kontakt vs. verwerfen, OneDrive-Ordner anlegen + PUT + `webUrl`.
- Browser (Playwright gegen Dev-Server): Shell, Pipeline-Track 8 Deal-Stufen, Palette, Wizard bis Stub-Signatur, Support-Pane. Referenz: `apps/openape-crm/demo/shots.mjs` Variante B.

Bestehende Board-/Stage-Tests werden auf Vorgang + Track umgeschrieben oder gelöscht, nicht tot mitgeschleppt.

## CLI und Doku

`packages/ape-crm`: Deals-Commands verstehen `phase` + `stufe` statt freier `stage`. Notes bleiben, heißen intern Historie. Neue Commands für Produkte/Verträge/Aufgaben in derselben Scheibe wie die API, nicht früher.

`apps/docs/content/5.apps/10.crm.md` und `apps/openape-crm/docs/stories.json` nachziehen, sobald Scheibe 1 nutzbar ist.

## Dateien (Orientierung)

| Bereich | Wo |
|---------|----|
| Pipelines, Endmarker, Geld/Vertragsableitung | `apps/openape-crm/shared/pipelines.ts`, `shared/contracts.ts` |
| Schema + Migration | `apps/openape-crm/server/database/schema.ts` + Drizzle-Push/Migrate wie die App das heute tut |
| Graph | `apps/openape-crm/server/utils/graph.ts`, `server/api/auth/microsoft/*`, `server/api/graph/notifications.post.ts`, OneDrive-Ordner/PUT/List in demselben Modul |
| Layout | `app/layouts/fokus.vue` (oder `default.vue` ersetzen), Komponenten Rail / ListPane / DealDetail / OfferWizard / CommandPalette |
| Theme | `app/app.config.ts`, `app/assets/main.css` |
| Entfernen | `BoardColumn.vue`, `DealCard.vue`, `StageHeader.vue`, Stage-APIs, Kanban-Drag in `app/utils/board.ts` soweit ungenutzt |

## Decision Log

| Entscheidung | Wahl | Verworfen |
|--------------|------|-----------|
| Umfang | Ganze Demo, nicht nur Skin | Nur Look; nur Shell dann Fach-Features |
| Integrationen | Echt (Graph-Mail/Kalender/OneDrive) | Alles Stub; Datei-Bytes in der CRM-DB |
| Mail/Kalender/Dateien | Microsoft Graph, ein persönliches O365-Konto für Inbox, Send **und** OneDrive | Resend; Shared Mailbox support@; Graph als Extra-Dienst |
| Signatur | Stub (Button, Statuswechsel, Thread, Endmarker) | Öffentliche EES-Seite; Login zum Signieren |
| Pipelines | Drei feste Phasen/Stufen 1:1 Demo | Hybrid editierbar; eine Pipeline wie heute |
| Shell | Variante B, kein Kanban | Liste ↔ Board wie Variante A |
| Migration gewonnen | Bleibt Phase Deal, Stufe `gewonnen` | Auto nach Kunde/Onboarding |
| Persönliche Inbox | Mitlesen, wenn Absender oder Empfänger CRM-Kontakt ist | Nur senden, kein Inbox-Sync |
| Aufgaben | Tabelle in CRM | openape-tasks |
| Dateien | OneDrive des verbundenen O365-Kontos, CRM hält Item-ID + `webUrl` + Organisations-Sharing-Link | LibSQL-Blobs; S3; SharePoint-Bibliothek pro Workspace |
| Bau | Vertikale Scheiben in einer App | Graph-first; eigener Connector |
