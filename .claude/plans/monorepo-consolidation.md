# Goal

Die 5 proof-link-Apps — tasks, testrun, pr, plans, timetrack — sind je ein eigenes Repo (Forgejo-authoritative, GitHub-Mirror, eigenes CI/Deploy) = die Repo-Wucherung aus dem Original-Audit. Nach diesem Plan leben alle 5 im openape-monorepo: App → apps/openape-<name>/, CLI → packages/ape-<name>/ (konsumiert @openape/proof-cli via workspace:*). Ein Repo, ein GitHub-Mirror, ein .forgejo/ci, eine publish-chain.mjs, ein deploy:image. Die 5 standalone-Forgejo-Repos werden archiviert. Beendet die Mirror-pro-Repo-Frage und vollendet die proof-cli-Konsolidierung.

## Current State (2026-06-26)
- proof-cli@0.1.1 + die 4 Web-Apps schon im Monorepo (deploy-image.mjs APP-Map + compose/chatty.yml; publish-chain.mjs).
- Alle 5 proof-link-CLIs frisch dedupliziert + published (ape-tasks@1.3.1, ape-testruns@0.1.1, ape-pr@0.1.1, ape-plans@1.0.1, ape-timetrack@0.1.5), nutzen @openape/proof-cli.
- plans/timetrack frisch nach Forgejo + tested-image + Prod-Cutover (laufen als Container). tasks/testrun/pr ebenfalls Container (systemd inactive). Alle 5 Sites LIVE.

## Milestones
### M0 — Discovery (kein Touch)
Prod-Stand je App (Image-Tag, Port, prod-<app>/, shared/+DB, nginx-Port); Paketnamen-Kollisionen; deploy-image.mjs APP-Map + compose-Struktur lesen; History-Strategie (git subtree vs copy; Empfehlung subtree).

### M1 — Pilot: testrun ins Monorepo
apps/openape-testrun/ (App) + packages/ape-testruns/ (CLI, proof-cli→workspace:*); pnpm-workspace nimmt sie via globs; CLI in publish-chain PACKAGES; App in deploy:image-Map (3006) + compose/chatty.yml-Service; .forgejo/ci baut mit.
Proof: workspace build+typecheck grün; deploy:image testrun aus Monorepo → testrun.openape.ai/api/health 200 (Image-Swap, shared/ unverändert); ape-testruns --help byte-identisch.

### M2 — tasks/pr/plans/timetrack nachziehen
Je App wie M1 (Ports tasks?/pr 3014/plans 3004/timetrack 3011), einzeln verifiziert (kein Big-Bang).
Proof: je App workspace-build grün, deploy:image → /api/health 200, CLI byte-identisch.

### M3 — Standalone-Repos stilllegen
README-Hinweis "moved to monorepo", Forgejo-Repos archivieren (read-only), push_mirror entfernen, alte per-Repo-prod-Artefakte aufräumen (Container läuft jetzt aus Monorepo-Image).
Proof: 5 Repos archiviert; deploy:image --all deployt alle; kein per-Repo-CI/Mirror.

## Risks
- Prod-Downtime 5 Live-Sites → Image-Swap mit Pre-Bake (bauen+pushen ohne Prod-Touch, dann compose up → Sekunden), shared/ unverändert, <APP>_TAG_PREV-Rollback, je App einzeln.
- Workspace-Konflikte (Paketnamen/Deps/eslint) → M0-Check, Pilot fängt es früh.
- CLI-Publish-Bruch → gleiche Versionen aus publish-chain, release:dry vor release.
- DDISA-Spec-Pakete (proof-link = SPs) → Konformität prüfen.

## E2E
for a in tasks testrun pr plans timetrack: pnpm --filter @openape-$a/app build; pnpm run deploy:image --all; curl https://$a.openape.ai/api/health → 200. Forgejo: 5 Repos archiviert; monorepo enthält apps/openape-{...} + packages/ape-*.

## Progress
- [ ] M0 — Discovery
- [ ] M1 — Pilot testrun
- [ ] M2 — tasks/pr/plans/timetrack
- [ ] M3 — Standalone-Repos archivieren
---
## STATUS: DONE (2026-06-26)
- M1 Pilot testrun ✓ (build/typecheck/byte-diff grün, Prod-Cutover ~4s, live aus Monorepo).
- M2 tasks/pr/plans/timetrack ✓ (alle build/typecheck grün, Cutover je ~4-6s, alle /api/me→401 healthy unter openape-prod).
- M3 ✓ PR #880 gemergt auf monorepo-main; 5 standalone-Forgejo-Repos archiviert + push_mirror entfernt; alte prod-<app>/-Dirs entfernt; Worktree weg.
- Beweis: alle 5 https://<app>.openape.ai/api/health → 200; monorepo apps/openape-{tasks,testrun,pr,plans,timetrack} + packages/ape-*.
