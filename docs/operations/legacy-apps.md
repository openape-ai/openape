# Preserved legacy applications

Source of truth: https://repos.openape.ai/patrick/legacy.git.
Local checkout: `../legacy` relative to the main monorepo checkout.
Issue: https://repos.openape.ai/patrick/monorepo/issues/1482.

Nest, Troop, ape-agent, CRM, ape-troop, ape-crm, Chat and ape-chat are preserved in
that independent repository with selected Git history, tests, documentation and
build instructions. They no longer participate in this monorepo's workspace
inventory, builds, package publication or source deployment targets.

The `monorepo-extraction-2026-10-15` tag and preservation manifests record the
original six-workspace source. Chat and its CLI retain their additional filtered
history and separate preservation manifest in `docs/extraction/` there.
Shared active libraries use pinned releases or source-backed build archives;
the legacy repository does not require this checkout to install or build.

## Runtime boundary

`apes`, `agent-runtime`, authentication/grants and shared task libraries remain
active here. Existing `apes nest` and agent compatibility commands remain; their
runtime target is legacy. Moving source does not remove installed npm packages.

Production Troop, CRM and Chat were separately retired with owner authorization
on October 15, 2026 (issue 1498). Their Compose services, containers, proxy routes
and associated monitors are removed. All application databases and environment
files remain under `/home/openape/projects/<app>/shared`; source and history
remain in the legacy repository. Troop schedules and hooks were disabled before
shutdown, and the local operator support jobs were disabled and archived.
Operational verification and provider-side webhook receipts are recorded on the
issue and implementing PR. Do not restart these services from old recipes.

The local demo stack covers active applications. Retired guides and historical
recipes remain available through Git history and the legacy repository. Their
old URLs and recipes do not authorize restarting retired infrastructure.

## Recovery

Clone the legacy repository and follow its README for independent frozen
installation and checks. Use its extraction tags/manifests for original source
comparison. Revert the monorepo removal PR if active integration regresses; do
not rewrite either repository's history or restore stale production data.

## Question Service follow-up

Question Service joined the legacy repository under issue 1488 after a usage
audit on October 15, 2026. Production held three completed July questions and
no pending work; none of the 16 active Pods referenced it. The active service
agent targets zaz instead. The initial audit also found a homepage uptime monitor.
No access logs were available, so historical reads and unknown external clients
cannot be excluded. Source/history and independent build instructions are
preserved. In the separately authorized runtime retirement (issue 1489), the
Question Service container, Compose service, reverse-proxy route, uptime monitor
and its check history, and the obsolete question database were removed. Troop, CRM
and Chat were subsequently retired under issue 1498 with their data retained.
