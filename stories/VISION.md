# Vision — OpenApe (Kanon, gegliedert nach Apps)

> Dieses Dokument ist der komprimierte Kanon. Es wird ausschließlich vom
> `story-consistency`-Agent fortgeschrieben (Single Writer) und ist Pflicht-Kontext
> für jeden Agent-Lauf im Story-Workflow. App-Scope-Seeds sind menschliche
> Eingaben (wie die Stories selbst) und entsprechend datiert.

## openape-free-idp (id.openape.ai) — Hand-Seed: 2026-06-10

### Was die App ist

`id.openape.ai` (openape-free-idp) ist ein kostenloser DDISA-Identity-Provider: Nutzer
melden sich überall im offenen Web mit ihrer E-Mail-Domain und einem Passkey an — ohne
Passwort, ohne per-App-Konto. Service Provider entdecken den IdP per DNS-TXT-Record und
holen sich Autorisierung über Grants. Der IdP ist der Ort, an dem die Identität des
Nutzers wohnt; entsprechend konservativ ist jede Änderung an Auth-Flows.

### Was die App nicht ist

Kein Social Login, kein Passwort-Manager, kein Session-Broker für Dritte. Recovery ist
**permission-to-enrol** (Erlaubnis, einen neuen Passkey zu registrieren), niemals eine
Session. Es gibt keine stillen Admin-Hintertüren in Nutzer-Accounts.

### Sicherheits-Philosophie

Passkeys statt Passwörter; jede sicherheitsrelevante Aktion ist laut (Benachrichtigung,
Audit) statt still; zeitliche Hürden (Cooldowns) schützen aktive Nutzer, ohne verwaiste
Accounts dauerhaft auszusperren; ein einzelner kompromittierter Kanal (z. B. ein Postfach)
darf nie ausreichen, um einen Account geräuschlos zu übernehmen.

### Fähigkeiten (vom Konsistenz-Agent gepflegt)

- Passkey-Sign-in/Sign-up, DDISA-Discovery, Consent + Grants (Bestand, v1)
- Account-Recovery v1: 72h-Mail-Hold mit Abbruch bei Login (Bestand, #297/PR #460)
- (Bestand, #462) Adaptive Recovery-Wartefrist nach Konto-Aktivität (72h inaktiv / 7d aktiv / bis 14d Urlaubs-Schalter)
- (Bestand, #462) Recovery-Warnung auf allen Kanälen (Push + alle je verknüpften E-Mail-Adressen) mit Ein-Tap-Abbruch
- (Bestand, #462) Sichtbares Audit aller Recovery-Ereignisse in den Konto-Einstellungen

## openape-coder (coder.openape.ai) — Hand-Seed v3: 2026-06-11 (2. Pivot durch Patrick)

### Was die App ist

`coder.openape.ai` ist die Cloud-Heimat für Software-Vorhaben: **Projekte** mit
Nutzern in den Rollen **Admin** und **Member**. Jedes Projekt hat eine
**Vision**, eine Liste **betroffener Repos** und seine **User-Stories**. Eine
User-Story hat die üblichen Bestandteile (Titel, „Als … möchte ich …, damit …",
Akzeptanzkriterien) und kann zusätzlich tragen: Repos, Links, Test-Referenzen
und einen Status. Die App ist ein DDISA Service Provider (Muster plans/tasks)
mit eigener Datenbank.

### Rollen & Berechtigungen

Admins können alles im Projekt — insbesondere Nutzer einladen und deren
Berechtigungen steuern. Members haben selektiv freigeschaltete Funktionalität
(von Admins pro Member bestimmt). Wer in keinem Projekt Mitglied ist, sieht
nichts — auch nicht, welche Projekte oder Personen existieren. Agenten erhalten
nie Admin-Rechte (`act:'human'`-Prinzip für Berechtigungs-Verwaltung).

### CLI & Repo-Sync (client-seitig)

Das CLI `ape-coder` (SSO via `apes login`, Muster ape-plans/ape-tasks) bietet
dieselben Funktionen wie die App (`ape-coder projects list`, Stories lesen/
ändern …). In einem Repo kann `.ape-coder/config` (plus optional Story-Dateien)
die Bindung an ein Projekt hinterlegen — der Sync läuft **client-seitig** über
das CLI; der Service kennt und erreicht kein Repo. Repo-Haltung der Stories ist
unterstützt, aber optional: Stakeholder arbeiten vollständig in der App.

### Prinzipien

Lesbar für Nicht-Techniker; Berechtigungs- und Status-Änderungen sind
auditierbar (wer, wann); Sync-Konflikte sind laut statt still; die App zeigt
den Kanon eines Projekts, sie interpretiert ihn nicht um.

### Fähigkeiten (vom Konsistenz-Agent gepflegt)

- (geplant, #585) Passkey-Sign-in via OpenApe-Identität; Außenstehende sehen weder Projekte noch Beteiligte
- (geplant, #585) Projekte anlegen (Anleger wird Admin) und Vision + betroffene Repos pflegen
- (geplant, #585) Mitglieder einladen und Berechtigungen pro Member steuern (Admin-only, act:'human')
- (geplant, #585) User-Stories anlegen/bearbeiten — übliche Bestandteile, optional Repos/Links/Test-Referenzen/Status
- (geplant, #585) Story-Board: alle Stories eines Projekts mit Status auf einen Blick, lesbar aufbereitet
- (geplant, #585) CLI `ape-coder` mit denselben Funktionen und Berechtigungen wie die App (SSO via `apes login`)
- (geplant, #585) Repo-Bindung via `.ape-coder/config` mit client-seitigem Zwei-Wege-Sync, Konflikte laut
