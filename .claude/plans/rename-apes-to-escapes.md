# Rename: apes → escapes (Escalated Privileges with APES)

## Purpose

Das CLI-Binary `apes` (ein setuid-root Programm für Privilege Elevation via OpenAPE Grants) wird zu `escapes` umbenannt. Der Name steht für "Escalated Privileges with APES". Gleichzeitig werden alle Config-Pfade von `/etc/apes/` auf `/etc/openape/` vereinheitlicht (zukunftssicher für weitere OpenAPE-Tools wie den Proxy). Das GitHub-Repo `openape-ai/sudo` wird zu `openape-ai/escapes`. Funktionalität bleibt unverändert — reiner Rename.

---

## Progress

- [ ] Milestone 1: sudo-Repo — Rust Code umbenennen
- [ ] Milestone 2: sudo-Repo — Docs, Config, Skill umbenennen
- [ ] Milestone 3: sudo-Repo — Verifizierung (cargo test + cargo build)
- [ ] Milestone 4: Monorepo — Grapes Code umbenennen
- [ ] Milestone 5: Monorepo — Docs, Skills, UI, Tests umbenennen
- [ ] Milestone 6: Monorepo — Verifizierung (lint, typecheck, test, build)
- [ ] Milestone 7: Commit, Push, GitHub Repo-Rename
- [ ] Milestone 8: Lokales Directory umbenennen

---

## Session Handoff — Getting Up to Speed

Falls dieser Plan in einer neuen Session fortgesetzt wird:

1. Lies diesen Plan bis zur Progress-Section — dort steht welche Milestones erledigt sind.
2. Prüfe den Git-Status beider Repos:

        cd /Users/patrickhofmann/Companies/private/repos/openape/sudo && git status
        cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo && git status

3. Verifiziere ob noch "apes"-Referenzen existieren (die Grep-Befehle aus Milestone 2 und 5 verwenden).
4. Arbeite am nächsten offenen Milestone weiter.

---

## Context & Orientation

Es gibt zwei Repositories die zusammenspielen:

Das **sudo-Repo** (`~/Companies/private/repos/openape/sudo`) enthält ein Rust-Programm das als setuid-root Binary installiert wird. Es empfängt ein von einem Menschen vorab genehmigtes JWT (einen "Grant") und führt dann einen Befehl mit Root-Rechten aus. Das Binary heißt aktuell `apes` und wird mit `sudo apes --grant <jwt> -- whoami` aufgerufen. Das `sudo` in diesem Aufruf ist das System-sudo, nicht der Repo-Name.

Das **Monorepo** (`~/Companies/private/repos/openape/openape-monorepo`) enthält das restliche OpenAPE-Ökosystem. Die relevanten Verbindungspunkte zum sudo-Repo sind:

- **Grapes** (`packages/grapes/`) — ein TypeScript-CLI das Grants beantragt und verwaltet. Es hat einen `run`-Befehl der bei `audience === 'apes'` das apes-Binary direkt aufruft (`execFileSync`). Der Flag `--apes-path` steuert wo das Binary liegt.
- **agent.vue** (`apps/openape-free-idp/`) — zeigt dem User Befehle wie `sudo apes enroll ...` an.
- **Docs** (`apps/docs/`) — Dokumentation die `apes` erklärt und Installationsanleitungen zeigt.
- **Tests** — mehrere Test-Fixtures nutzen `audience: 'apes'` als Beispiel-Audience.
- **Skills** — Grapes und Shapes haben SKILL.md Dateien die `apes` referenzieren.

Der Rename berührt nur Strings, Pfade und Namen. Keine Logik ändert sich.

---

## Glossar

- **audience** — ein String im Grant-JWT der identifiziert welches Tool den Grant konsumieren darf. Aktuell `"apes"`, wird zu `"escapes"`.
- **setuid** — ein Unix-Dateiflag das bewirkt dass ein Binary mit den Rechten seines Besitzers (root) läuft statt mit denen des aufrufenden Users.
- **Grant** — ein von einem Menschen genehmigtes JWT das einem Agent erlaubt eine bestimmte Aktion auszuführen.
- **Grapes** — CLI-Tool zum Beantragen, Verwalten und Konsumieren von Grants.

---

## Decision Log

| Datum | Entscheidung | Begründung |
|-------|-------------|------------|
| 2026-03-22 | Binary: `apes` → `escapes` | "Escalated Privileges with APES" |
| 2026-03-22 | Config: `/etc/apes/` → `/etc/openape/` | Zukunftssicher — ein Verzeichnis für alle OpenAPE-Tools |
| 2026-03-22 | Logs: `/var/log/apes/` → `/var/log/openape/` | Konsistent mit Config-Pfad |
| 2026-03-22 | Env-Var: `APES_GRANT` → `ESCAPES_GRANT` | Binary-spezifisch, passt zum neuen Namen |
| 2026-03-22 | Grapes Flag: `--apes-path` → `--escapes-path` | Konsistenz |
| 2026-03-22 | Grapes Audience: `"apes"` → `"escapes"` | Audience muss zum Binary passen |
| 2026-03-22 | `~/.apes/keys/` ersatzlos entfernen | Existiert nur in Doku, nicht im Code, nicht in der Realität |
| 2026-03-22 | Cargo Package: `openape-sudo` → `openape-escapes` | Konsistenz mit Repo-Name |
| 2026-03-22 | GitHub Repo: `openape-ai/sudo` → `openape-ai/escapes` | Via `gh api` |
| 2026-03-22 | Lokales Dir: `sudo/` → `escapes/` | Konsistenz |
| 2026-03-22 | Gleichzeitig committen (beide Repos) | Vermeidet inkonsistenten Zwischenzustand |

---

## Surprises & Discoveries

_(Wird während der Implementierung befüllt)_

---

## Rename-Mapping (vollständig)

    Binary:         apes           → escapes
    Cargo Package:  openape-sudo   → openape-escapes
    GitHub Repo:    openape-ai/sudo → openape-ai/escapes
    Lokales Dir:    ~/Companies/private/repos/openape/sudo → .../escapes
    Config Dir:     /etc/apes/     → /etc/openape/
    Log Dir:        /var/log/apes/ → /var/log/openape/
    Env-Var:        APES_GRANT     → ESCAPES_GRANT
    Grapes Flag:    --apes-path    → --escapes-path
    Grapes Audience: "apes"        → "escapes"
    Skill Dir:      skills/openape-sudo/ → skills/openape-escapes/
    User Keys:      ~/.apes/keys/  → ENTFERNEN (existiert nicht im Code)

---

## Interfaces and Dependencies (Endzustand nach Rename)

Nach Abschluss aller Milestones sehen die Code-Schnittstellen so aus:

**Grapes `run.ts` — CLI-Flag-Definition (packages/grapes/src/commands/run.ts):**

    'escapes-path': {
      type: 'string',
      description: 'Path to escapes binary',
      default: 'escapes',
    }

    // Audience-Check:
    if (args.audience === 'escapes') {
      execFileSync(args['escapes-path'], ['--grant', authz_jwt, '--', ...command], { ... })
    }

**Rust CLI (src/cli.rs):**

    #[command(name = "escapes", about = "Privilege elevation via OpenApe grants")]
    #[arg(long, default_value = "/etc/openape/config.toml")]
    #[arg(long, env = "ESCAPES_GRANT")]

**Config-Defaults (src/config.rs):**

    allowed_audiences: vec!["escapes"]
    audit_log: PathBuf::from("/var/log/openape/audit.log")

**agent.vue — Variable und UI-Text:**

    const escapesCommands = computed(() => { ... })
    // Befehle: sudo escapes enroll/update/remove
    // Config-Pfad: /etc/openape/agent.key

---

## Umgang mit gelöschten Zeilen

An mehreren Stellen steht "ENTFERNEN" im Plan. Das betrifft ausschließlich Dokumentations-Zeilen die `~/.apes/keys/deploy.key` referenzieren — einen User-Level-Key-Pfad der nie im Code existierte und rein fiktiv ist. Diese Zeilen werden ersatzlos gelöscht. Falls die Zeile Teil eines Code-Beispiels ist (z.B. `apes --key ~/.apes/keys/deploy.key -- apt-get upgrade`), wird das gesamte Beispiel entfernt oder durch ein Beispiel ohne den fiktiven Key-Pfad ersetzt (z.B. `escapes --grant <jwt> -- apt-get upgrade`).

---

## Invarianten (DÜRFEN SICH NICHT ÄNDERN)

- Alle CLI-Subcommands bleiben identisch (enroll, update, remove, --grant, --grant-file, --grant-stdin)
- Die Rust-Logik (JWT-Verifizierung, setuid, exec, audit) bleibt unverändert
- Grapes-Funktionalität bleibt identisch (nur Audience-String und Flag-Name ändern sich)
- Bestehende Monorepo-Tests müssen grün bleiben
- DDISA-Protokoll-Compliance bleibt gewahrt

---

## Implementierung

### Milestone 1: sudo-Repo — Rust Code umbenennen

Das sudo-Repo hat folgende Quelldateien unter `src/`: `cli.rs` (Clap-CLI-Definition), `main.rs` (Entry Point), `config.rs` (TOML-Config-Loading mit Defaults und Tests), `audit.rs` (JSONL Audit-Logging mit Tests), `grant_mode.rs` (JWT-Verifikation und Grant-Ausführung mit Tests), `exec.rs` (Prozess-Exec), `error.rs` (Error-Types), `crypto.rs` (Ed25519). Nur die ersten 5 enthalten "apes"-Referenzen.

**Arbeitsverzeichnis:** `/Users/patrickhofmann/Companies/private/repos/openape/sudo`

**Datei: `Cargo.toml`** — Package- und Binary-Name.
- Zeile 2: `name = "openape-sudo"` → `name = "openape-escapes"`
- Zeile 9: `name = "apes"` → `name = "escapes"`

**Datei: `src/cli.rs`** — Clap command definition. Enthält den CLI-Namen, den Default-Config-Pfad und die Env-Variable für den Grant.
- Zeile 6: `#[command(name = "apes"` → `#[command(name = "escapes"`
- Zeile 9: `default_value = "/etc/apes/config.toml"` → `default_value = "/etc/openape/config.toml"`
- Zeile 13: `env = "APES_GRANT"` → `env = "ESCAPES_GRANT"`

**Datei: `src/main.rs`** — Entry Point. Enthält einen Usage-Hint-String.
- Zeile 26: `apes --grant` → `escapes --grant`

**Datei: `src/config.rs`** — Config-Loading. Enthält Default-Werte für `allowed_audiences` und `audit_log`, plus Tests die diese Defaults verifizieren.
- Zeile 15: Kommentar `["apes"]` → `["escapes"]`
- Zeile 21: Default-Vec `"apes"` → `"escapes"`
- Zeile 58: Default-Pfad `/var/log/apes/audit.log` → `/var/log/openape/audit.log`
- Zeile 120: Test-TOML `allowed_audiences = ["apes"]` → `["escapes"]`
- Zeile 136: Test-Assertion `vec!["apes"]` → `vec!["escapes"]`
- Zeile 156: Test-Assertion Pfad → `/var/log/openape/audit.log`
- Zeile 157: Test-Assertion `vec!["apes"]` → `vec!["escapes"]`

**Datei: `src/audit.rs`** — Audit-Logging. Ein Test-Fixture enthält die Audience.
- Zeile 89: `"apes"` → `"escapes"`

**Datei: `src/grant_mode.rs`** — Grant-JWT-Verifikation. Zwei Test-Fixtures enthalten die Audience.
- Zeile 241: `aud: "apes"` → `aud: "escapes"`
- Zeile 265: `"aud": "apes"` → `"aud": "escapes"`

**Akzeptanzkriterium:**

    cd /Users/patrickhofmann/Companies/private/repos/openape/sudo
    cargo check 2>&1 | tail -3

    Erwartete Ausgabe:
    Compiling openape-escapes v0.X.X (/Users/patrickhofmann/Companies/private/repos/openape/sudo)
        Finished `dev` profile [unoptimized + debuginfo] target(s) in X.XXs

---

### Milestone 2: sudo-Repo — Docs, Config, Skill umbenennen

**Datei: `Makefile`** — Definiert die `BINARY`-Variable die in Install-Targets verwendet wird.
- Zeile 3: `BINARY = apes` → `BINARY = escapes`

**Datei: `config.example.toml`** — Beispiel-Config für neue Installationen.
- Zeile 1: `# apes configuration` → `# escapes configuration`
- Zeile 8: `/var/log/apes/` → `/var/log/openape/`
- Zeile 13: `["apes"]` → `["escapes"]`

**Datei: `README.md`** — ~24 Referenzen. Globale Ersetzungen in dieser Reihenfolge (spezifischste zuerst, um Fehlmatches zu vermeiden):
1. `/var/log/apes/` → `/var/log/openape/`
2. `/etc/apes/` → `/etc/openape/`
3. Zeilen mit `~/.apes/keys/deploy.key` → ENTFERNEN (Pfad existiert nicht)
4. `/usr/local/bin/apes` → `/usr/local/bin/escapes`
5. `target/release/apes` → `target/release/escapes`
6. `"audience":"apes"` → `"audience":"escapes"`
7. `allowed_audiences = ["apes"]` → `allowed_audiences = ["escapes"]`
8. `grapes "apes"` → `grapes "escapes"`
9. `grapes run apes` → `grapes run escapes`
10. `apes --grant` → `escapes --grant`
11. `echo "$JWT" | apes` → `echo "$JWT" | escapes`
12. Titel: `# apes —` → `# escapes —`
13. Inline-Referenzen: `` `apes` `` → `` `escapes` `` (nur standalone, NICHT in "openape")

**Skill-Directory umbenennen:**

    mv skills/openape-sudo skills/openape-escapes

**Datei: `skills/openape-escapes/SKILL.md`** — ~30 Referenzen. Gleiches Ersetzungsmuster wie README, plus:
- `name: openape-sudo` → `name: openape-escapes`
- `cargo install openape-sudo` → `cargo install openape-escapes`
- Alle `sudo apes` → `sudo escapes`

**Akzeptanzkriterium — Null-Matches-Verifizierung:**

    cd /Users/patrickhofmann/Companies/private/repos/openape/sudo
    grep -rn '"apes"' . --exclude-dir=target | wc -l
    grep -rn '/etc/apes' . --exclude-dir=target | wc -l
    grep -rn '/var/log/apes' . --exclude-dir=target | wc -l
    grep -rn '~/\.apes' . --exclude-dir=target | wc -l
    grep -rn 'openape-sudo' . --exclude-dir=target | wc -l

    Erwartete Ausgabe für JEDEN Befehl:
    0

    Zusätzlich eine Positiv-Prüfung dass der Rename stattgefunden hat:
    grep -rn '"escapes"' . --exclude-dir=target | wc -l

    Erwartete Ausgabe: >0 (mindestens 5 Matches)

---

### Milestone 3: sudo-Repo — Verifizierung

Alle Rust-Tests müssen grün sein (die Test-Fixtures wurden in Milestone 1 angepasst). Das Release-Binary muss unter dem neuen Namen gebaut werden.

    cd /Users/patrickhofmann/Companies/private/repos/openape/sudo
    cargo test 2>&1 | tail -5

    Erwartete Ausgabe:
    test result: ok. X passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

    cargo build --release 2>&1 | tail -3

    Erwartete Ausgabe:
    Compiling openape-escapes ...
        Finished `release` profile [optimized] target(s) in X.XXs

    ls target/release/escapes

    Erwartete Ausgabe:
    target/release/escapes

**Git-Commit:**

    git add -A
    git commit -m "rename: apes → escapes, /etc/apes → /etc/openape"

---

### Milestone 4: Monorepo — Grapes Code umbenennen

Grapes ist das einzige Package im Monorepo das executable Code hat der `apes` referenziert. Der `run`-Befehl ruft bei `audience === 'apes'` das Binary direkt auf via `execFileSync`. Der `request`-Befehl zeigt `"apes"` als Beispiel in der Hilfe-Beschreibung.

**Arbeitsverzeichnis:** `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`

**Datei: `packages/grapes/src/commands/run.ts`** — 6 Änderungen:
- Zeile 16: `"apes", "proxy"` → `"escapes", "proxy"`
- Zeile 41: `'apes-path'` → `'escapes-path'`
- Zeile 42: `'Path to apes binary'` → `'Path to escapes binary'`
- Zeile 43: `default: 'apes'` → `default: 'escapes'`
- Zeile 86: `args.audience === 'apes'` → `args.audience === 'escapes'`
- Zeile 89: `args['apes-path']` → `args['escapes-path']`

**Datei: `packages/grapes/src/commands/request.ts`** — 1 Änderung:
- Zeile 21: `"apes", "proxy"` → `"escapes", "proxy"`

**Akzeptanzkriterium:**

    pnpm turbo run typecheck --filter=@openape/grapes 2>&1 | tail -3

    Erwartete Ausgabe:
    Tasks:    X successful, X total

---

### Milestone 5: Monorepo — Docs, Skills, UI, Tests umbenennen

Dies ist der umfangreichste Milestone — 16 Dateien mit reinen Text-Ersetzungen. Keine Logik ändert sich.

**Datei: `apps/openape-free-idp/app/pages/agent.vue`** — Vue-Komponente die dem User Befehle anzeigt.
- Zeile 37: `sudo apes enroll` → `sudo escapes enroll`, `/etc/apes/agent.key` → `/etc/openape/agent.key`
- Zeile 66: Variable `apesCommands` → `escapesCommands`
- Zeile 73: `sudo apes enroll` → `sudo escapes enroll`, `/etc/apes/agent.key` → `/etc/openape/agent.key`
- Zeile 77: `sudo apes update` → `sudo escapes update`
- Zeile 81: `sudo apes remove` → `sudo escapes remove`
- Zeile 85: `sudo apes remove` → `sudo escapes remove`
- Zeile 311: `Server-Befehle (apes)` → `Server-Befehle (escapes)`
- Zeile 360: `Enroll with apes` → `Enroll with escapes`
- Template-Referenzen auf `apesCommands` → `escapesCommands`

**Datei: `packages/grapes/skills/openape-grapes/SKILL.md`** — Grapes-Skill-Dokumentation.
- Alle `` `apes` `` standalone → `` `escapes` ``
- Alle `~/.apes/keys/` Referenzen → ENTFERNEN
- Alle `--audience apes` → `--audience escapes`
- Alle `grapes run apes` → `grapes run escapes`
- Alle `--at apes` → `--at escapes`
- `consumed by apes/shapes` → `consumed by escapes/shapes`

**Datei: `packages/shapes/skills/openape-shapes/SKILL.md`**
- Zeile 25: `` `apes`/`escapes` `` → `` `escapes` `` (deduplizieren — dort steht bereits beides)
- Alle `--audience apes` → `--audience escapes`
- Alle `` `apes` `` standalone → `` `escapes` ``

**Docs-Dateien** (6 Dateien in `apps/docs/content/`):

`index.md` — Zeile 19: `` `apes` CLI `` → `` `escapes` CLI ``

`1.getting-started/3.usage.md`:
- Zeile 71: `## apes — sudo for Agents` → `## escapes — Privilege Elevation for Agents`
- Zeile 73: `` `apes` is a Rust binary `` → `` `escapes` is a Rust binary ``
- Zeile 76: Zeile mit `~/.apes/keys/` → ENTFERNEN (Pfad existiert nicht)

`2.ecosystem/1.index.md`:
- Zeile 35+47: `` `openape-sudo` (`apes`) `` → `` `openape-escapes` (`escapes`) ``

`2.ecosystem/3.grants.md`:
- Zeile 75: `## openape-sudo` → `## openape-escapes`
- Zeile 82: `/usr/local/bin/apes` → `/usr/local/bin/escapes`
- Zeile 85: `sudo apes enroll` → `sudo escapes enroll`
- Zeilen mit `~/.apes/keys/` → ENTFERNEN
- Alle `/etc/apes/` → `/etc/openape/`

`3.security/1.compliance.md` — Zeile 69: `**apes audit log**` → `**escapes audit log**`

`3.security/2.threat-model.md` — Zeile 75: `` `apes` `` → `` `escapes` ``

**Test-Dateien:**

`examples/e2e/tests/grant-visibility.test.ts` — Zeile 32: `audience: 'apes'` → `audience: 'escapes'`

`examples/idp/README.md` — Zeile 80: `` `apes` CLI `` → `` `escapes` CLI ``

`modules/nuxt-auth-idp/test/consume.test.ts` — Zeilen 72, 86, 101, 115, 129: `audience: 'apes'` → `audience: 'escapes'`

**Code-Kommentar:**

`modules/nuxt-auth-idp/src/runtime/server/api/grants/[id]/consume.post.ts` — Zeile 10: `Called by apes` → `Called by escapes`

**Plan-Datei:**

`packages/proxy/PLAN.md` — 5 Referenzen: `/etc/apes/` → `/etc/openape/`, alle `apes` standalone → `escapes`, `openape-sudo` → `openape-escapes`

**Projekt-Config:**

`.claude/CLAUDE.md` — Zeile 108: `openape-ai/sudo` → `openape-ai/escapes`

**Akzeptanzkriterium — Null-Matches-Verifizierung:**

    cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
    grep -rn '"apes"' packages/grapes/src/ modules/nuxt-auth-idp/test/ examples/e2e/ --include="*.ts" | wc -l
    grep -rn 'sudo apes' apps/ packages/ modules/ --include="*.vue" --include="*.md" --include="*.ts" | wc -l
    grep -rn '/etc/apes' . --exclude-dir=node_modules --exclude-dir=.git | wc -l
    grep -rn '~/\.apes' . --exclude-dir=node_modules --exclude-dir=.git | wc -l

    Erwartete Ausgabe für JEDEN Befehl:
    0

---

### Milestone 6: Monorepo — Verifizierung

Alle Tests müssen grün sein — insbesondere `consume.test.ts` (audience geändert) und Grapes-Tests.

    cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo

    pnpm turbo run test --filter=@openape/nuxt-auth-idp 2>&1 | tail -5

    Erwartete Ausgabe:
    Test Files  12 passed (12)
         Tests  59 passed (59)

    pnpm turbo run test --filter=@openape/grapes 2>&1 | tail -5

    Erwartete Ausgabe:
    Tests: X passed

    pnpm lint 2>&1 | tail -3

    Erwartete Ausgabe:
    Tasks:    18 successful, 18 total

    pnpm typecheck 2>&1 | tail -3

    Erwartete Ausgabe:
    Tasks:    24 successful, 24 total

    pnpm turbo run build --filter=openape-free-idp 2>&1 | tail -3

    Erwartete Ausgabe:
    Tasks:    X successful, X total

**Git-Commit:**

    git add -A
    git commit -m "rename: apes → escapes, /etc/apes → /etc/openape"

---

### Milestone 7: Push + GitHub Repo-Rename

Die Reihenfolge ist wichtig: erst pushen (während das Repo noch `sudo` heißt), dann umbenennen (GitHub erstellt automatisch einen Redirect).

**sudo-Repo pushen:**

    cd /Users/patrickhofmann/Companies/private/repos/openape/sudo
    git push

**Monorepo pushen:**

    cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
    git push

**GitHub Repo umbenennen:**

    gh api repos/openape-ai/sudo --method PATCH --field name=escapes

    Erwartete Ausgabe (JSON, relevant):
    "name": "escapes",
    "full_name": "openape-ai/escapes"

**Remote-URL im lokalen Repo aktualisieren:**

    cd /Users/patrickhofmann/Companies/private/repos/openape/sudo
    git remote set-url origin git@github.com:openape-ai/escapes.git
    git remote -v

    Erwartete Ausgabe:
    origin	git@github.com:openape-ai/escapes.git (fetch)
    origin	git@github.com:openape-ai/escapes.git (push)

---

### Milestone 8: Lokales Directory umbenennen

    mv /Users/patrickhofmann/Companies/private/repos/openape/sudo /Users/patrickhofmann/Companies/private/repos/openape/escapes

    cd /Users/patrickhofmann/Companies/private/repos/openape/escapes
    git status

    Erwartete Ausgabe:
    On branch main
    Your branch is up to date with 'origin/main'.
    nothing to commit, working tree clean

---

## Migrations-Hinweis für bestehende Installationen

Für Server die `/etc/apes/` nutzen:

    # 1. Config-Verzeichnis umbenennen
    sudo mv /etc/apes /etc/openape

    # 2. Binary ersetzen
    sudo rm /usr/local/bin/apes
    sudo install -m 4755 -o root target/release/escapes /usr/local/bin/escapes

    # 3. Log-Verzeichnis umbenennen (optional, alte Logs bleiben lesbar)
    sudo mv /var/log/apes /var/log/openape

    # 4. Grapes audience aktualisieren
    # Neue Grants verwenden audience "escapes" statt "apes"

---

## Betroffene Dateien (vollständig)

### sudo-Repo (11 Dateien + 1 Dir-Rename)
- `Cargo.toml` — Package- und Binary-Name
- `Makefile` — BINARY-Variable
- `README.md` — ~24 Referenzen
- `config.example.toml` — 3 Referenzen
- `src/cli.rs` — CLI-Name, Config-Pfad, Env-Var
- `src/main.rs` — Usage-String
- `src/config.rs` — Defaults + 4 Test-Assertions
- `src/audit.rs` — 1 Test-Fixture
- `src/grant_mode.rs` — 2 Test-Fixtures
- `skills/openape-sudo/SKILL.md` → Dir-Rename + ~30 Referenzen

### Monorepo (17 Dateien)
- `packages/grapes/src/commands/run.ts` — Audience-Check, Flag, execFileSync
- `packages/grapes/src/commands/request.ts` — Hilfe-Beschreibung
- `packages/grapes/skills/openape-grapes/SKILL.md` — ~15 Referenzen
- `packages/shapes/skills/openape-shapes/SKILL.md` — ~5 Referenzen
- `packages/proxy/PLAN.md` — 5 Referenzen
- `apps/openape-free-idp/app/pages/agent.vue` — UI-Befehle + Variable
- `apps/docs/content/index.md`
- `apps/docs/content/1.getting-started/3.usage.md`
- `apps/docs/content/2.ecosystem/1.index.md`
- `apps/docs/content/2.ecosystem/3.grants.md`
- `apps/docs/content/3.security/1.compliance.md`
- `apps/docs/content/3.security/2.threat-model.md`
- `examples/e2e/tests/grant-visibility.test.ts` — Test-Fixture
- `examples/idp/README.md`
- `modules/nuxt-auth-idp/test/consume.test.ts` — 5 Test-Fixtures
- `modules/nuxt-auth-idp/src/runtime/server/api/grants/[id]/consume.post.ts` — Kommentar
- `.claude/CLAUDE.md` — Repo-Referenz

### Unveränderte Dateien
- Rust: `src/exec.rs`, `src/error.rs`, `src/crypto.rs`
- CI: `.github/workflows/ci.yml`, `.github/workflows/security.yml`
- Alle Packages außer grapes, shapes, proxy
- Alle Apps außer free-idp, docs

---

## Idempotenz & Recovery

Alle Änderungen sind Text-Ersetzungen — wiederholbar ohne Seiteneffekte. Git-Commits nach Milestone 3 (sudo-Repo) und Milestone 6 (Monorepo) als Checkpoints. Bei Problemen: `git checkout -- .` revertiert alle Änderungen. Der GitHub-Rename (Milestone 7) erstellt automatisch ein Redirect von `openape-ai/sudo` → `openape-ai/escapes`.

---

## Baseline-Verifizierung (vor Implementierungsbeginn)

    # sudo-Repo
    cd /Users/patrickhofmann/Companies/private/repos/openape/sudo
    cargo test 2>&1 | tail -3

    Erwartete Ausgabe:
    test result: ok. X passed; 0 failed

    # Monorepo
    cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
    pnpm turbo run test --filter=@openape/nuxt-auth-idp 2>&1 | tail -5

    Erwartete Ausgabe:
    Test Files  12 passed (12)
         Tests  59 passed (59)

    pnpm turbo run test --filter=@openape/grapes 2>&1 | tail -5

    Erwartete Ausgabe:
    Tests: X passed

Falls einer fehlschlägt: STOPP. Zuerst fixen.

---

## Outcomes & Retrospective

_(Wird nach Abschluss befüllt)_

---

## Plan-Revisions

Falls sich während der Implementierung etwas ändert (unerwartete Referenzen, fehlende Dateien, Entscheidungsänderungen): die Änderung hier dokumentieren mit Datum und Grund, den Decision Log aktualisieren, und die betroffenen Milestone-Beschreibungen anpassen. Der Plan ist ein Living Document — er muss zu jedem Zeitpunkt den aktuellen Stand widerspiegeln.
