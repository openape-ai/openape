# DELETION MANIFEST — Konsolidierung Phase 1 / M1

Stand: 2026-06-03. Jeder Eintrag ist beweisbar tot. Evidenz pro Zeile.
Plan: `docs/superpowers/plans/2026-06-03-konsolidierung-phase1-m0-m1.md`.

## openape-monorepo
- `apps/idp/` (+ `apps/idp/local.db`) — alter Standalone-IdP.
  Evidenz: nicht in `scripts/deploy.mjs` (Targets: free-idp/agent-proxy/org/troop/chat/docs/proxy);
  `grep -r '"openape-idp"' --include=package.json` ist leer (nichts depended darauf);
  Ersatz ist `examples/idp`. (Enthält auch den toten Re-Export `server/utils/idp-context.ts`.)
- `packages/shapes/` — Zombie-Verzeichnis ohne `package.json` (nur dist/coverage/.turbo/node_modules).
  Evidenz: Shapes-Logik lebt in `packages/apes/src/shapes/`.
- `soul`-Spalte (Boot-ALTER in `apps/openape-troop/server/plugins/02.database.ts:65-68`).
  Evidenz: Schema-Kommentar `schema.ts:43-47` deklariert sie als „benign tombstone,
  Drizzle doesn't reference it". (DROP COLUMN auf Prod-DBs ist separat — siehe Open Decisions im Plan.)
- `CLAUDE.md` (Repo-Wurzel) — gedriftet: listet nicht-existente `apps/service`,
  `apps/openape-agent-mail`; nennt `deploy.yml` (real ist `scripts/deploy.mjs`);
  kennt troop/org/nest/chat/ape-agent/llm nicht. → korrigieren, nicht löschen.

## escapes (separater Repo)
- `src/audit.rs` `log_error` — `#[allow(dead_code)]`, nicht aufgerufen.
- `src/main.rs:32-42` + `src/cli.rs` — deprecated `--update`-Flag (neues `update`-Subcommand bleibt).

## Separate Repos (Decommission)
- `desktop` (openape-ai/desktop) — abgebrochener Step-4-Effort; entfernt dritte Auth-Linie. GitHub-Repo archivieren (reversibel).
- `ape-tg-bridge` — lose Dateien, kein `.git`, durch claude-plugin-openape-chat ersetzt.
- `test-deltamind-at` — lokaler Checkout des Remotes openape-ai/sp-starter (redundant).

## Bewusst NICHT in M1 (Open Decisions)
- `apps/openape-agent-proxy` — deployt (systemd `openape-agent-proxy.service`), Produkt-Entscheidung nötig.
- `soul` DROP COLUMN auf bestehende Prod-DBs — braucht Backup/eigene Migration.
