# Plan: Chat-Attachments — Dateien/Bilder in beide Richtungen (#980)

> Self-contained: ohne Vorwissen von oben nach unten ausführbar.

## Purpose / Big Picture

- **Ziel:** Patrick hängt im Cockpit-Chat ein Bild/PDF an („schau dir diesen Screenshot an") — der Operator SIEHT es (echte Vision via `codex exec -i`). Umgekehrt liefert der Operator Dateien als Beweis zurück (Headless-Screenshot, generiertes PDF) und sie erscheinen als Bild/Karte in der Chat-Bubble.
- **Kontext:** Issue #980. Der Mobile-Layout-Fix (21.07.) startete mit drei iPhone-Screenshots — musste über eine Claude-Session laufen, weil der Operator Bilder weder empfangen noch senden kann. Verifikations-Screenshots („Beweis vor fertig") gehen heute ebenfalls nicht.
- **Scope:** Cockpit-Chat in `apps/openape-troop` + Worker. Dateitypen v1: `image/png`, `image/jpeg`, `image/webp`, `application/pdf` — **bewusst kein SVG** (Script-Träger). Limit **8 MB**/Datei, max **4** Dateien/Nachricht. NICHT drin: sp-tasks/externe Services, Videos/Audio, Datei-Browser/Galerie, Downloads-Verwaltung.

## Repo-Orientierung

- **Projekt:** openape-monorepo, App `apps/openape-troop` (Nuxt 4, h3, Drizzle/LibSQL, Vitest)
- **Relevante Dateien:**
  - `server/database/schema.ts` + `server/plugins/02.database.ts` — neue Tabelle `cockpit_files`; `cockpit_chat_messages` + Spalte `files` (JSON, additive ALTER wie `meta` in #981)
  - `server/utils/cockpit/chat-store.ts` — `saveChatMessage(…, files?)`
  - `server/api/cockpit/message.post.ts` — nimmt `files: [fileId]` am letzten user-Turn an, hängt sie an den Task
  - `server/utils/cockpit/queue.ts` — `QueueTask.files?: {id, mime, name}[]`; `task-store.ts` persistiert sie (Spalte `files` TEXT)
  - `server/api/cockpit/agent/tasks/next.post.ts` — data-Part bekommt `files`
  - `server/api/cockpit/agent/tasks/resolve.post.ts` — artifact-Parts `kind:'file'` mit `fileId`
  - `public/worker/parse.py` — schreibt `files.txt` (eine Zeile: `id<TAB>mime<TAB>name`)
  - `public/worker/worker.sh` + `cockpit-agent.sh` — Download/Upload-Subcommands; `generate_codex` bekommt `-i <pfad>` pro Bild
  - `app/components/cockpit/CockpitComposer.vue` (📎 + Preview-Chips), `CockpitBubble.vue` (Bild inline / PDF-Karte), `useCockpitChat.ts`, `types.ts`, `cockpit.css`
- **Muster aus #981 wiederverwenden:** additive nullable Spalten mit `ALTER … .catch(() => {})`; Owner-Guard bei jeder Schreiboperation (`task.owner === agent`); `meta`/`files` im messages.get → Bubble; Verifikation via `COCKPIT_DEV_OWNER` + Playwright-core/System-Chrome.
- **Dev-Setup:** `cd apps/openape-troop && COCKPIT_DEV_OWNER=patrick@hofmann.eco pnpm dev` (3010) · Tests `pnpm vitest run` · Gates `pnpm lint && pnpm typecheck`
- **Fakt geprüft:** `codex exec -i/--image <FILE>` existiert (Vision für den Operator ist real, nicht nur Pfad-im-Text).

## Architektur-Entscheidungen (vorab fixiert)

1. **Storage = LibSQL-Blob** (`cockpit_files`: id, owner_email, org_id, name, mime, bytes BLOB, size, created_at). Kein S3/unstorage — 8-MB-Bilder in SQLite sind unkritisch, kein neues Infra-Stück, Backup läuft mit der DB. Wenn Volumen je stört → dann unstorage-S3 (Treiber existiert im Monorepo). Aufräumen: Files ohne Chat-Referenz älter 30d löscht ein Boot-Sweep (analog Prune).
2. **Vier Endpoints, alle owner-bound:**
   - `POST /api/cockpit/files` (Owner, multipart via `readMultipartFormData`) → `{id, name, mime, size}`
   - `GET /api/cockpit/files/:id` (Owner) → Bytes, korrekte `content-type`, `content-disposition: inline; filename=…`, `cache-control: private, max-age=31536000, immutable` (id ist UUID)
   - `POST /api/cockpit/agent/files` (Agent-Auth; org muss dem Agent-Owner gehören) — Rückkanal
   - `GET /api/cockpit/agent/files/:id` (Agent-Auth, owner-bound) — Worker-Download
   - Validierung serverseitig: Mime-Allowlist UND Magic-Bytes-Check (PNG/JPEG/WebP/PDF-Signaturen — Content-Type-Header ist Client-Behauptung), Size-Limit vor dem Insert.
3. **Wire:** Chat-Nachricht trägt `files: [{id, mime, name}]` (eigene Spalte, nicht in `meta` — meta bleibt ask-shaped). Task trägt dieselbe Liste; `next.post` liefert sie im data-Part; `resolve` akzeptiert `artifact.parts[{kind:'file', fileId}]` zusätzlich zum text-Part.
4. **Worker:** `cockpit-agent.sh file <id> <outpath>` (Download) und `cockpit-agent.sh upload <pfad> [name]` (→ druckt fileId). `worker.sh`: nach parse.py jede Zeile aus `files.txt` nach `$S/att-<n>.<ext>` laden; Bilder → `-i`-Flags an codex, PDFs → Pfad-Hinweis in user.txt („Anhang: $S/att-1.pdf — lies ihn mit pdftotext"). Directive-Satz: *„Willst du dem Owner eine Datei zeigen (Screenshot-Beweis!), lade sie mit `upload` hoch und resolve mit dem file-Part; behaupte nie einen Anhang, den du nicht hochgeladen hast."*
5. **UI:** Composer-📎 (nativer `<input type=file accept="image/png,image/jpeg,image/webp,application/pdf" multiple>`), Upload sofort beim Auswählen (Chip mit Name + ✕), `send()` schickt `files`-Ids mit. Bubble: Bilder als `<img loading="lazy">` (max-height 320px, Tap = neue Tab-URL), PDFs als Karte (Name + Größe, Tap = öffnen). User- wie Assistant-Bubbles.
6. **Kein Freitext-Zwang:** Anhang ohne Text ist erlaubt (Text default „(Anhang)").

## Milestones

### Milestone 1: Files-API + Storage (server-only, curl-beweisbar)

**Ziel:** Dateien lassen sich owner-bound hoch-/runterladen, mit echten Grenzen; Chat-Nachrichten können Datei-Referenzen tragen.

**Schritte:**
1. Schema + DDL: `cockpit_files`-Tabelle (02.database.ts + schema.ts), `cockpit_chat_messages.files` (additive ALTER), `cockpit_tasks.files`.
2. Neu `server/utils/cockpit/file-store.ts`: `saveFile` (validiert Mime-Allowlist + Magic Bytes + Size), `loadFile` (owner-bound), `sweepOrphans(maxAge)`; Boot-Sweep im Rehydrate-Plugin.
3. Die 4 Endpoints (Entscheidung 2).
4. `chat-store.saveChatMessage(…, files?)`, `messages.get` liefert `files` mit.
5. Tests `tests/cockpit-files.test.ts`: Magic-Bytes-Mismatch → reject · >8MB → reject · fremder Owner → 404 · Roundtrip Bytes identisch · Sweep löscht Unreferenziertes, behält Referenziertes.

**Akzeptanzkriterien:**
- [ ] `pnpm vitest run` grün inkl. neuer Datei
- [ ] `curl -F file=@bild.png http://localhost:3010/api/cockpit/files` → `{id,…}`; `curl …/files/<id> -o out.png` → `cmp bild.png out.png` still
- [ ] PNG mit `content-type: application/pdf` hochladen → 400 (Magic Bytes) · 9-MB-Datei → 413
- [ ] `GET /api/cockpit/agent/files/<id>` mit Agent-Token eines ANDEREN Owners → 404

**Rollback:** Branch-Revert; Spalten/Tabelle additiv.

### Milestone 2: Owner → Operator (sehen, nicht nur wissen)

**Ziel:** Bild im Composer anhängen → der Operator beschreibt den Inhalt korrekt (Vision), PDF wird per pdftotext gelesen.

**Schritte:**
1. `message.post`: `files` am Request annehmen (Ids validieren: existieren + gehören dem Owner), an `enqueue`/Task + `saveChatMessage` durchreichen.
2. `next.post`: `files` im data-Part; `queue.ts`/`task-store.ts`: Feld durchschleifen (Restart-sicher).
3. `parse.py`: `files.txt` schreiben. `worker.sh`: Downloads nach `$S/att-*`; Bilder als `-i`-Flags an `generate_codex` (nur cockpit-Pfad), PDF-Pfade als Zusatzzeile in user.txt.
4. Composer: 📎-Button, Upload beim Auswählen, Preview-Chips, `send`-Event um `files` erweitert; `useCockpitChat.send(text, files?)`.
5. User-Bubble rendert die angehängten Bilder/Karten (aus `files` der persistierten Nachricht).

**Akzeptanzkriterien:**
- [ ] Browser (Dev, `COCKPIT_DEV_OWNER`): PNG mit erkennbarem Inhalt (z. B. roter Kreis auf weißem Grund) anhängen + „Was siehst du?" → Operator-Antwort beschreibt den Inhalt korrekt (echter codex-Lauf lokal)
- [ ] PDF anhängen + „Fasse zusammen" → Antwort enthält Inhalt aus dem PDF
- [ ] Reload: user-Bubble zeigt das Bild weiterhin (aus DB, nicht Blob-URL)
- [ ] Task mit Anhang übersteht Server-Restart (files aus cockpit_tasks rehydriert)

**Rollback:** UI+Worker-Commit revertierbar; M1-API bleibt nutzbar.

### Milestone 3: Operator → Owner (Beweis-Rückkanal)

**Ziel:** Der Operator liefert eine Datei als Teil seiner Antwort; sie erscheint inline im Chat.

**Schritte:**
1. `cockpit-agent.sh upload <pfad> [name]` (POST agent/files, druckt fileId) und `resolve`-Erweiterung: `--file <fileId>` (mehrfach) → artifact-Parts `kind:'file'`.
2. `resolve.post.ts`: file-Parts validieren (fileId existiert, gehört demselben Owner — Guard-Muster #989/#981), `saveChatMessage(…, files)`.
3. Assistant-Bubble rendert Bilder/Karten (gleiche Komponente wie M2).
4. Directive-Satz (Entscheidung 4, „behaupte nie einen Anhang…").
5. Screenshot-Beweis 390px per SendUserFile, Worker-Kopien nach Deploy aktualisieren.

**Akzeptanzkriterien:**
- [ ] CLI-Kette: `cockpit-agent.sh upload test.png` → id; `resolve <task> completed --file <id> <<< "Hier der Beweis"` → Bild in der Assistant-Bubble (Browser)
- [ ] resolve mit fileId eines FREMDEN Owners → 400, keine Chat-Message
- [ ] `pnpm lint && pnpm typecheck` grün, Screenshot an Patrick geschickt

**Rollback:** Revert; keine Datenmigration nötig.

## Progress

- [x] `[2026-07-23 15:00]` Milestone 1: DONE — Commit caa49ae0; curl-Kette komplett (Roundtrip byte-identisch, Magic-Bytes-Lüge 400, 9MB→413, SVG→400)
- [x] `[2026-07-23 15:07]` Milestone 2: DONE — Commit 7de68fe1; Vision-E2E mit echtem codex-Lauf: „Patrick, ich sehe einen roten Kreis." · Composer/Bubbles im Browser verifiziert
- [x] `[2026-07-23 15:12]` Milestone 3: DONE — upload + resolve --file, fremde fileId → 400; Screenshots an Patrick. PR #993, CI läuft.

## Surprises & Discoveries

- `2026-07-23` `parse.py` schrieb files.txt ohne trailing newline → `while IFS read` verwirft die letzte Zeile (bei EINEM Anhang: alle). Fix beidseitig: newline immer schreiben + `read || [ -n "$id" ]`.
- `2026-07-23` `loading="lazy"` auf `<img>` ohne intrinsische Größe in einem `content-visibility:auto`-Container lädt NIE (2×2px-Layout-Box, Intersection feuert nicht). Fix: lazy weg (Historie ist eh virtualisiert) + min-height reserviert die Box.
- `2026-07-23` Composer-Datei-Upload ist headless testbar, ohne nativen Datei-Dialog: `DataTransfer` + `File` aus Canvas-Blob in `input.files` injizieren und `change` dispatchen — läuft durch den ECHTEN Component-Pfad.
- `2026-07-23` Jeder Worktree hat seine eigene Dev-DB — Org-Ids aus einer früheren Session existieren dort nicht („unknown company" ist dann kein Bug).

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-07-23 | Blobs in LibSQL statt S3/unstorage | Kein neues Infra, Backup inklusive, 8-MB-Limit macht es unkritisch; S3-Treiber existiert als späterer Ausweg | unstorage-S3 (Infra+Creds für v1 unnötig), Dateisystem (Container-Volume-Kopplung) |
| 2026-07-23 | Kein SVG in der Allowlist | SVG = Script-Träger, Bubbles rendern inline | SVG mit Sanitizer (Aufwand/Risiko für v1 unnötig) |
| 2026-07-23 | Magic-Bytes-Check zusätzlich zur Mime-Allowlist | Content-Type ist Client-Behauptung; Security-Checklist „Input Validation an Grenzen" | Nur Header prüfen |
| 2026-07-23 | `files` als eigene Spalte, nicht in `meta` | meta bleibt ask-shaped (#981); zwei orthogonale Features nicht in ein JSON quetschen | meta-Union-Typ |
| 2026-07-23 | Bilder via `codex exec -i` (echte Vision) | Flag existiert (geprüft); Pfad-im-Text wäre für Bilder wertlos | „lies die Datei"-Hinweis für Bilder |

## Session-Checkliste

1. Plan lesen, Progress prüfen · 2. `git log` · 3. Worktree von origin/main + `pnpm install` + Baseline `pnpm vitest run` · 4. nächster Milestone · 5. pro Milestone committen (Branch `feat/issue-980-chat-attachments`) · 6. E2E wie oben · 7. Progress/Discoveries pflegen

## Outcomes & Retrospective

- **Ergebnis:** PR #993 merged (#980 zu), deployed als `prod-5cb60f24`, lokaler Worker (worker.sh, cockpit-agent.sh, parse.py) aktualisiert. Bilder/PDFs fließen in beide Richtungen; der Operator sieht Bilder echt (codex -i, bewiesen), liefert Dateien als Beweis zurück, und die Directive verbietet behauptete Anhänge.
- **Abweichungen vom Plan:** Keine inhaltlichen. Ein CI-Re-Run wegen der bekannten e2e-Flake (#991, Team arbeitet dran).
- **Learnings:** (1) `while read` + fehlender trailing newline ist bei Ein-Zeilen-Dateien ein Totalausfall — Generator UND Konsument absichern. (2) `loading="lazy"` niemals in `content-visibility:auto`-Containern ohne reservierte Box. (3) DataTransfer-Injection testet echten Composer-Code ohne nativen Datei-Dialog. (4) Die in-memory-LibSQL-Mock-Schablone (cockpit-files.test.ts) macht DB-nahe Utils erstmals unit-testbar — wiederverwenden.
