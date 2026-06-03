# OpenApe Konsolidierung — Phase 1, M0 + M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen sicheren Baseline-Stand herstellen (M0) und allen beweisbar toten Code aus dem OpenApe-Universum entfernen (M1) — ohne Verhaltensänderung an irgendeinem deployten System.

**Architecture:** Reine Subtraktion + Dokumentation. M0 verifiziert grün (`lint` + `typecheck` + `test`) und katalogisiert die Kill-Liste. M1 entfernt tote Artefakte in drei getrennten Git-Repos (`openape-monorepo`, `escapes`, plus Decommission separater Repos), jeder Schritt durch denselben grünen Gate abgesichert und als eigener Commit-Checkpoint. Quelle: `docs/superpowers/specs/2026-06-03-openape-konsolidierung-design.md`.

**Tech Stack:** pnpm + Turborepo (Monorepo), Vitest, Drizzle/LibSQL (troop), Rust + Cargo (escapes), `gh` CLI (Repo-Archivierung), Git.

---

## ⚠️ Workflow-Constraints (aus monorepo `CLAUDE.md` — verbindlich)

1. **Issue-First / kein Source-Edit auf `main`.** Ein Claude-Hook blockiert Edit/Write von Source-Dateien auf `main`. Alle M1-Quellcode-Löschungen im Monorepo laufen über einen Issue-Branch (`<type>/issue-<nr>-<slug>`) und einen PR. Ausnahme-Pfade (direct-to-main erlaubt): `.claude/`, `.github/`, `.githooks/`, `scripts/`, Config-Dateien.
2. **Definition of Done = `pnpm lint` + `pnpm typecheck` grün** (zusätzlich zu `pnpm test`). Kein Commit/PR ohne diese drei.
3. **DDISA-Spec-Relevanz:** M1 berührt keine protokollrelevante Logik (nur Löschung verwaister/toter Artefakte). Falls ein Schritt wider Erwarten einen protokollrelevanten Pfad anfasst → User warnen und fragen.

---

## File Structure (was wird angefasst)

**Repo `openape-monorepo`** (ein Issue-Branch, ein PR):
- Delete: `apps/idp/` (gesamte App inkl. `apps/idp/local.db`) — alter Standalone-IdP, nicht in `deploy.mjs`, nichts importiert `openape-idp`. Ersatz ist `examples/idp`.
- Delete: `packages/shapes/` — Zombie-Verzeichnis ohne `package.json` (nur `dist/`, `coverage/`, `.turbo/`, `node_modules/`).
- Modify: `apps/openape-troop/server/plugins/02.database.ts:65-68` — Boot-`ALTER TABLE … ADD COLUMN soul` entfernen.
- Modify: `apps/openape-troop/server/database/schema.ts:43-47` — `soul`-Tombstone-Kommentar entfernen.
- Modify: `CLAUDE.md` (Repo-Wurzel) — gedriftete Struktur-/Deploy-Doku auf den Ist-Stand bringen.
- Create: `DELETION-MANIFEST.md` (Repo-Wurzel) — Kill-Liste mit Evidenz (M0).

**Repo `escapes`** (separater Repo, eigener Commit/PR):
- Modify: `src/audit.rs:39-…` — tote Funktion `log_error` + `#[allow(dead_code)]` entfernen.
- Modify: `src/main.rs:32-42` — deprecated `--update`-Flag-Pfad entfernen (das neue `escapes update`-Subcommand bleibt).
- Modify: `src/cli.rs` — `update`-Feld der `Cli`-Struct + zugehöriges clap-`#[arg]` entfernen.

**Separate-Repo-Decommission (Ops, kein PR):**
- `desktop/` (Repo `openape-ai/desktop`) — GitHub-Repo archivieren (reversibel), lokalen Checkout nach `.archived/` verschieben.
- `ape-tg-bridge/` (lose Dateien, kein `.git`) — nach `.archived/` verschieben.
- `test-deltamind-at/` (lokaler Checkout des Remotes `openape-ai/sp-starter`) — redundanten lokalen Ordner entfernen (Remote bleibt unberührt).

**Bewusst NICHT in diesem Plan (siehe „Open Decisions"):** `apps/openape-agent-proxy` (deployt → Produkt-Entscheidung nötig), `soul`-`DROP COLUMN` auf bestehende Prod-DBs.

---

## M0 — Baseline & Kill-Liste

### Task 0.1: Grünen Baseline-Stand verifizieren

**Files:** keine (read-only Verifikation)

- [ ] **Step 1: Dependencies frisch installieren**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
pnpm install --frozen-lockfile
```
Expected: Install endet mit exit 0, keine „missing dependency"-Fehler.

- [ ] **Step 2: Den vollständigen Gate laufen lassen (Baseline)**

```bash
pnpm lint && pnpm typecheck && pnpm test
```
Expected: exit 0. Turbo druckt für alle Pakete `cache miss/hit` und am Ende `Tasks: N successful, N total`, `0 failed`. Den Output (Task-Anzahl, Dauer) notieren — er ist der Vergleichsmaßstab für jeden M1-Schritt.

- [ ] **Step 3: Falls der Baseline NICHT grün ist → STOPP**

Wenn `lint`/`typecheck`/`test` schon vor jeder Änderung rot sind: NICHT mit M1 fortfahren. Stattdessen die vorbestehenden Fehler dokumentieren und mit dem User klären. M1 darf nur auf grünem Baseline starten (sonst lässt sich „keine Verhaltensänderung" nicht beweisen).

### Task 0.2: `DELETION-MANIFEST.md` erstellen

**Files:**
- Create: `DELETION-MANIFEST.md` (Repo-Wurzel `openape-monorepo`)

> Hinweis: `.md` an der Wurzel ist kein blockierter Source-Pfad; dieser Schritt darf auf dem aktuellen Branch erfolgen.

- [ ] **Step 1: Manifest mit verifizierter Evidenz schreiben**

```markdown
# DELETION MANIFEST — Konsolidierung Phase 1 / M1

Stand: 2026-06-03. Jeder Eintrag ist beweisbar tot. Evidenz pro Zeile.

## openape-monorepo
- `apps/idp/` (+ `apps/idp/local.db`) — alter Standalone-IdP.
  Evidenz: nicht in `scripts/deploy.mjs` (nur free-idp/agent-proxy/org/troop/chat/docs/proxy);
  `grep -r '"openape-idp"' --include=package.json` ist leer (nichts depended darauf);
  Ersatz ist `examples/idp`.
- `packages/shapes/` — Zombie-Verzeichnis ohne `package.json` (nur dist/coverage/.turbo/node_modules).
  Evidenz: Shapes-Logik lebt in `packages/apes/src/shapes/`.
- `soul`-Spalte (Boot-ALTER in `apps/openape-troop/server/plugins/02.database.ts:65-68`)
  Evidenz: Schema-Kommentar `schema.ts:43-47` deklariert sie als „benign tombstone,
  Drizzle doesn't reference it". (DROP COLUMN auf Prod-DBs ist separat — siehe Open Decisions.)
- `CLAUDE.md` (Repo-Wurzel) — gedriftet: listet nicht-existente `apps/service`,
  `apps/openape-agent-mail`; nennt `deploy.yml` (real ist `scripts/deploy.mjs`);
  kennt troop/org/nest/chat/ape-agent/llm nicht. → korrigieren, nicht löschen.

## escapes (separater Repo)
- `src/audit.rs` `log_error` — `#[allow(dead_code)]`, nicht aufgerufen.
- `src/main.rs:32-42` + `src/cli.rs` — deprecated `--update`-Flag (neues `update`-Subcommand bleibt).

## Separate Repos (Decommission)
- `desktop` (openape-ai/desktop) — abgebrochener Step-4-Effort; entfernt dritte Auth-Linie.
- `ape-tg-bridge` — lose Dateien, kein `.git`, durch claude-plugin-openape-chat ersetzt.
- `test-deltamind-at` — lokaler Checkout des Remotes openape-ai/sp-starter (redundant).
```

- [ ] **Step 2: Committen**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
git add DELETION-MANIFEST.md
git commit -m "docs: deletion-manifest für konsolidierung m1"
```
Expected: ein Commit, 1 file changed.

---

## M1 — De-Sedimentation

### Task 1.0: Issue + Branch für die Monorepo-Löschungen anlegen

**Files:** keine (Git/GitHub-Setup)

- [ ] **Step 1: GitHub-Issue erstellen**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
gh issue create \
  --title "M1: De-Sedimentation — apps/idp, packages/shapes, soul-tombstone, CLAUDE.md" \
  --body "Konsolidierung Phase 1 / M1. Siehe docs/superpowers/plans/2026-06-03-konsolidierung-phase1-m0-m1.md und DELETION-MANIFEST.md."
```
Expected: gibt die Issue-URL + Nummer aus (z. B. `#123`). Nummer für Step 2 merken.

- [ ] **Step 2: Issue-Branch anlegen** (ersetze `<nr>` durch die echte Nummer)

```bash
git checkout main && git pull
git checkout -b chore/issue-<nr>-m1-de-sedimentation
```
Expected: `Switched to a new branch 'chore/issue-<nr>-m1-de-sedimentation'`.

### Task 1.1: `apps/idp` löschen (+ local.db)

**Files:**
- Delete: `apps/idp/` (gesamtes Verzeichnis)

- [ ] **Step 1: Letzter Beweis, dass nichts depended (muss leer sein)**

```bash
grep -rn '"openape-idp"' --include=package.json apps packages modules examples | grep -v 'apps/idp/package.json'
grep -rn "from ['\"].*apps/idp" apps packages modules examples
```
Expected: beide Ausgaben leer. Falls NICHT leer → STOPP, der Befund muss aufgelöst werden.

- [ ] **Step 2: Verzeichnis entfernen**

```bash
git rm -r apps/idp
```
Expected: listet die entfernten Dateien inkl. `apps/idp/local.db`, `apps/idp/package.json`.

- [ ] **Step 3: Lockfile/Workspace neu auflösen + Gate**

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```
Expected: exit 0, Task-Anzahl nun um die idp-App reduziert, weiterhin `0 failed`.

- [ ] **Step 4: Committen**

```bash
git add -A
git commit -m "chore: remove legacy standalone idp app (apps/idp)"
```

### Task 1.2: `packages/shapes/` Zombie-Verzeichnis löschen

**Files:**
- Delete: `packages/shapes/`

- [ ] **Step 1: Bestätigen, dass kein `package.json` / kein Consumer existiert**

```bash
ls packages/shapes/package.json 2>&1   # erwartet: "No such file or directory"
grep -rn '"@openape/shapes"' --include=package.json . | grep -v node_modules
```
Expected: erste Zeile = not found; zweite Ausgabe leer.

- [ ] **Step 2: Entfernen**

```bash
git rm -r --cached packages/shapes 2>/dev/null; rm -rf packages/shapes
```
Expected: Verzeichnis weg (`.turbo`, `dist`, `coverage`, `node_modules` waren ohnehin nicht getrackt).

- [ ] **Step 3: Gate**

```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test
```
Expected: exit 0, `0 failed`.

- [ ] **Step 4: Committen**

```bash
git add -A
git commit -m "chore: remove orphaned packages/shapes zombie dir"
```

### Task 1.3: `soul`-Tombstone entfernen (Boot-ALTER + Schema-Kommentar)

**Files:**
- Modify: `apps/openape-troop/server/plugins/02.database.ts:65-68`
- Modify: `apps/openape-troop/server/database/schema.ts:43-47`

> Sicher, weil: nur das Re-Anlegen der Spalte auf FRISCHEN DBs entfällt. Bestehende Prod-DBs behalten die harmlose Spalte (laut Schema-Kommentar „benign tombstone"). Kein Lese-/Schreibpfad nutzt sie. Ein `DROP COLUMN` für Prod ist NICHT Teil dieser Task (Open Decisions).

- [ ] **Step 1: Boot-Migration-Block entfernen**

In `apps/openape-troop/server/plugins/02.database.ts` diesen Block löschen:
```ts
    try {
      await db.run(sql`ALTER TABLE agents ADD COLUMN soul TEXT NOT NULL DEFAULT ''`)
    }
    catch { /* column exists */ }
```
(Die `userAddendum`- und Skills-Kommentare/Migrationen drumherum bleiben unverändert.)

- [ ] **Step 2: Schema-Kommentar entfernen**

In `apps/openape-troop/server/database/schema.ts` diese fünf Kommentarzeilen löschen:
```ts
  // (legacy) `soul` text column still exists in the DB for back-compat
  // with rows written before the SOUL.md + system_prompt merge. New code
  // doesn't read or write it — the system_prompt above absorbed its role.
  // Future migration can DROP COLUMN once we're confident no read path
  // is left. Drizzle doesn't reference it, so it's a benign tombstone.
```

- [ ] **Step 3: Bestätigen, dass kein Code `soul` liest/schreibt**

```bash
grep -rn "\bsoul\b" apps/openape-troop/server | grep -v "02.database.ts"
```
Expected: leer (oder nur weitere reine Kommentare). Falls ein echter Lese-/Schreibpfad auftaucht → STOPP, das wäre kein Tombstone.

- [ ] **Step 4: Gate (inkl. troop-Build, da App geändert)**

```bash
pnpm turbo run build --filter=openape-troop
pnpm lint && pnpm typecheck && pnpm test
```
Expected: troop baut, exit 0, `0 failed`.

- [ ] **Step 5: Committen**

```bash
git add apps/openape-troop/server/plugins/02.database.ts apps/openape-troop/server/database/schema.ts
git commit -m "chore: drop soul tombstone migration + schema comment (troop)"
```

### Task 1.4: Gedriftete Root-`CLAUDE.md` korrigieren

**Files:**
- Modify: `CLAUDE.md` (Repo-Wurzel)

> Begründung: Die Datei ist das Agent-Onboarding-Dokument und beschreibt eine veraltete Struktur (nennt nicht-existente `apps/service`, `apps/openape-agent-mail`; verweist auf `deploy.yml` statt `scripts/deploy.mjs`; kennt troop/org/nest/chat/ape-agent/llm/free-idp nicht vollständig). Drift im Onboarding-Dokument ist genau das Sediment, das die Kampagne bekämpft.

- [ ] **Step 1: Ist-Struktur ermitteln (Belege für die Korrektur)**

```bash
ls apps; echo "---"; ls packages; echo "---"; ls modules
node -e "const m=require('./scripts/deploy.mjs');" 2>/dev/null || grep -n "script:\|service:" scripts/deploy.mjs | head -40
```
Expected: die echte App-/Package-/Module-Liste + die realen Deploy-Targets aus `deploy.mjs`.

- [ ] **Step 2: `CLAUDE.md` aktualisieren**

In `CLAUDE.md`:
- Den „Monorepo Structure"-Block auf die tatsächlichen `apps/` (docs, openape-free-idp, openape-agent-proxy, openape-ape-agent, openape-chat, openape-chat-cli, openape-llm, openape-nest, openape-org, openape-troop) umschreiben. `apps/service`, `apps/openape-agent-mail` und das (jetzt gelöschte) `apps/idp` entfernen.
- `packages/` um die fehlenden ergänzen: `apes`, `cli-auth`, `server`, `shapes` (→ jetzt entfernt, nicht listen), `prompt-injection-detector`, `idp-test-suite`, `vue-components`, `ape-troop`.
- „Deploy Flow"-Abschnitt: `deploy.yml`/Vercel-Secrets durch den realen `scripts/deploy.mjs` + self-hosted systemd-Mechanismus ersetzen (Targets gemäß Step-1-Output).
- Den Hinweis „`desktop/` and `sudo/` are separate repos" anpassen: `desktop` ist decommissioned (siehe Task 1.6), `escapes` (vormals „sudo") bleibt separater Repo.

- [ ] **Step 3: Gate (Doku-Änderung, aber Gate trotzdem grün halten)**

```bash
pnpm lint
```
Expected: exit 0 (CLAUDE.md ist nicht lint-relevant, aber der Gate muss grün bleiben).

- [ ] **Step 4: Committen**

```bash
git add CLAUDE.md
git commit -m "docs: korrigiere gedriftete monorepo CLAUDE.md auf ist-struktur"
```

### Task 1.5: PR für die Monorepo-Löschungen öffnen

**Files:** keine (PR)

- [ ] **Step 1: Branch pushen + PR erstellen**

```bash
git push -u origin chore/issue-<nr>-m1-de-sedimentation
gh pr create --fill --title "chore/issue-<nr>-m1-de-sedimentation"
```
Expected: PR-URL. CI muss grün werden (lint/typecheck/test) bevor gemergt wird.

- [ ] **Step 2: Nach grüner CI mergen** (per Review-Konvention des Repos)

Expected: PR gemergt, Issue `#<nr>` automatisch geschlossen.

### Task 1.6: `desktop`-Repo decommissionieren

**Files:** separater Repo `openape-ai/desktop` + lokaler Checkout

> Outward-facing: GitHub-Repo wird archiviert (reversibel via `gh repo unarchive`), NICHT gelöscht. Lokale uncommittete WIP-Änderungen (`M .claude/CLAUDE.md`, `M src-tauri/Cargo.*`) zuerst sichern.

- [ ] **Step 1: WIP sichern (nicht verwerfen)**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape/desktop
git stash push -u -m "wip vor decommission 2026-06-03" && git stash list | head -1
```
Expected: ein Stash-Eintrag (falls uncommittete Änderungen existieren). Falls nichts zu stashen ist → ok, weiter.

- [ ] **Step 2: GitHub-Repo archivieren (reversibel)**

```bash
gh repo archive openape-ai/desktop --yes
gh repo view openape-ai/desktop --json isArchived
```
Expected: `{"isArchived":true}`.

- [ ] **Step 3: Lokalen Checkout aus dem aktiven Arbeitsbereich nehmen**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape
mv desktop .archived/desktop
ls .archived/
```
Expected: `desktop` liegt jetzt unter `.archived/` (nicht gelöscht — der Stash + Remote bleiben erhalten).

### Task 1.7: `ape-tg-bridge` archivieren

**Files:** lose Dateien (kein `.git`)

- [ ] **Step 1: Bestätigen, dass kein Git-Repo dranhängt**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape
test -d ape-tg-bridge/.git && echo "HAS GIT — STOP" || echo "lose Dateien, ok"
```
Expected: `lose Dateien, ok`.

- [ ] **Step 2: Nach `.archived/` verschieben**

```bash
mv ape-tg-bridge .archived/ape-tg-bridge
ls .archived/
```
Expected: `ape-tg-bridge` unter `.archived/`.

### Task 1.8: redundanten `test-deltamind-at`-Checkout entfernen

**Files:** lokaler Checkout des Remotes `openape-ai/sp-starter`

- [ ] **Step 1: Bestätigen, dass es der sp-starter-Remote ist (kein eigener Code)**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape
git -C test-deltamind-at remote -v | head -1
git -C test-deltamind-at status --short
```
Expected: Remote = `…/sp-starter.git`; keine uncommitteten Eigenänderungen. Falls doch uncommittete Änderungen → STOPP und mit User klären.

- [ ] **Step 2: Lokalen Ordner nach `.archived/` verschieben (Remote bleibt unberührt)**

```bash
mv test-deltamind-at .archived/test-deltamind-at
ls .archived/
```
Expected: Ordner unter `.archived/`. Der GitHub-Remote `openape-ai/sp-starter` ist davon nicht betroffen.

### Task 1.9: escapes — toten Code entfernen

**Files (Repo `escapes`):**
- Modify: `src/audit.rs` (`log_error` + `#[allow(dead_code)]`)
- Modify: `src/main.rs:32-42` (deprecated `--update`-Pfad)
- Modify: `src/cli.rs` (`update`-Feld der `Cli`-Struct)

- [ ] **Step 1: Branch anlegen**

```bash
cd /Users/patrickhofmann/Companies/private/repos/openape/escapes
git checkout main && git pull
git checkout -b chore/remove-dead-code
```

- [ ] **Step 2: `log_error` entfernen**

In `src/audit.rs` die `#[allow(dead_code)]`-Zeile und die komplette folgende Funktion `pub fn log_error(...) { … }` löschen.

- [ ] **Step 3: Deprecated `--update`-Flag entfernen**

In `src/main.rs` den Block der Zeilen 32–42 löschen:
```rust
    // Deprecated flag: keep working for one release, hint at the new form.
    if cli.update {
        eprintln!(
            "note: `escapes --update` is deprecated — use `escapes update` in future releases."
        );
        if let Err(e) = update::self_update() {
            eprintln!("{}", e.to_json());
            std::process::exit(e.exit_code());
        }
        return;
    }
```
(Das neue `Commands::Update`-Subcommand in Zeile 23 bleibt erhalten.)

In `src/cli.rs` das `update`-Feld der `Cli`-Struct samt seiner `#[arg(long)]`-Annotation löschen. Lokalisieren:
```bash
grep -n "update" src/cli.rs
```
und das `pub update: bool`-Feld (+ darüberstehendes `#[arg(...)]`) entfernen.

- [ ] **Step 4: Build + Test (Dead-Code-Warnung muss weg sein)**

```bash
cargo build 2>&1 | grep -i "warning: .*never used" || echo "keine dead-code warnings"
cargo test
```
Expected: `keine dead-code warnings`; `cargo test` → `test result: ok`.

- [ ] **Step 5: Committen + PR**

```bash
git add -A
git commit -m "chore: remove dead log_error fn and deprecated --update flag"
git push -u origin chore/remove-dead-code
gh pr create --fill
```
Expected: PR-URL; CI grün → mergen.

---

## Definition of Done (M0 + M1)

- [ ] `DELETION-MANIFEST.md` existiert und ist committet.
- [ ] Monorepo-PR gemergt; `pnpm lint && pnpm typecheck && pnpm test` grün auf `main`.
- [ ] `grep -rn "apps/idp\|packages/shapes" openape-monorepo --include=*.ts` liefert keine Code-Referenzen mehr.
- [ ] `grep -rn "soul" apps/openape-troop/server` liefert keinen aktiven Pfad mehr.
- [ ] Root-`CLAUDE.md` beschreibt die echte `apps/`/`packages/`-Struktur und `deploy.mjs`.
- [ ] escapes-PR gemergt; `cargo build` ohne Dead-Code-Warnung.
- [ ] `gh repo view openape-ai/desktop --json isArchived` → `true`; `desktop`, `ape-tg-bridge`, `test-deltamind-at` liegen unter `.archived/`.
- [ ] Keine Verhaltensänderung an deployten Systemen (free-idp, troop, org, chat, agent-proxy, docs, proxy laufen unverändert).

---

## Open Decisions (NICHT in diesem Plan — separat entscheiden)

1. **`apps/openape-agent-proxy`** — leere „Coming soon"-App, ABER deployt (systemd `openape-agent-proxy.service`, Target in `deploy.mjs`). Entscheidung nötig: befüllen (echtes Proxy-Dashboard) oder abschalten (App + Deploy-Target + Service entfernen). Bis dahin unangetastet.
2. **`soul` `DROP COLUMN` auf Prod-DBs** — die Spalte bleibt als harmloser Tombstone in bestehenden troop-DBs. Ein echtes `DROP COLUMN` (Drizzle-Migration gegen Prod-LibSQL) ist optional und braucht eigene Sorgfalt/Backup.
3. **`test-deltamind-at` als Deploy-Branch von `sp-starter`** — der Design-Doc schlug vor, die Demo künftig als Deploy-Branch von `openape-sp-starter` zu führen statt als separaten Checkout. Reines Ops-Setup, später.
