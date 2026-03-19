# Repository Boundary Decision: `apps/*` vs Separate Repos

## Scope
Evaluate whether these applications should stay inside `openape-monorepo/apps/*` or move to separate repositories:

- `apps/openape-agent-mail`
- `apps/openape-agent-proxy`
- `apps/service` (`@openape/cloud`)

## Current State (from this repo)

- Workspace is configured as a monorepo with `packages/*`, `modules/*`, `apps/*`, `examples/*`.
- All three apps depend on internal workspace packages via `workspace:*`:
  - `openape-agent-mail` -> `@openape/core`, `@openape/auth`, `@openape/nuxt-auth-sp`
  - `openape-agent-proxy` -> `@openape/nuxt-auth-sp`
  - `@openape/cloud` -> `@openape/nuxt-auth-idp`, `@openape/unstorage-s3-driver`
- CI currently runs `lint typecheck test build` across the full turbo workspace.
- Changesets are configured to ignore these apps for public package release/versioning.

## Option A: Keep Apps in `openape-monorepo`

### Pros

- Atomic cross-repo changes are easy (app + shared package updates in one PR).
- `workspace:*` links keep integration friction low while modules are evolving.
- Single lockfile/toolchain (`pnpm`, `turbo`, Node 22) reduces setup drift.
- CI validates compatibility between apps and shared OpenApe packages continuously.
- Onboarding is simpler: one clone, one install, one command surface.

### Cons

- Broader CI blast radius: unrelated app changes can slow/impact whole pipeline.
- Repository access is all-or-nothing (harder to isolate teams or sensitive services).
- Change noise is higher; app-specific history and ownership are less clean.
- Incident isolation is weaker (urgent app fixes still happen in shared repo context).

## Option B: Move Apps to Separate Repositories

### Pros

- Stronger ownership boundaries (team autonomy, clearer responsibility).
- Smaller, faster CI per app with reduced unrelated failures.
- Cleaner security/access boundaries for production-facing services.
- Independent release cadence and operational workflows per app.

### Cons

- Requires package distribution strategy for internal deps:
  - publish internal packages regularly, or
  - consume via git refs/vendoring (higher maintenance).
- Cross-cutting changes become multi-PR/multi-repo coordination.
- Dependency drift risk increases (apps lag behind core/module updates).
- Duplicate tooling/automation across repos increases maintenance overhead.
- End-to-end local development across app + core becomes more complex.

## Recommendation

Keep these apps in `openape-monorepo` for now.

Rationale: all three apps currently rely on internal `workspace:*` packages and benefit from fast atomic iteration with shared modules. Splitting now would introduce packaging/versioning overhead before boundaries appear mature enough to justify it.

## Decision Plan

1. **Stabilize boundaries first (now)**
   - Define explicit API/contracts for shared packages consumed by apps.
   - Reduce accidental coupling (no app-specific logic in shared package internals).

2. **Prepare for optional split (next)**
   - Ensure each app can build/test/deploy independently from repo root and from its own folder.
   - Add per-app CI entrypoints and ownership docs (`OWNERS.md` or CODEOWNERS rules).
   - Version internal packages with clear changelogs and compatibility policy.

3. **Use split triggers (decision gate)**
   Split when at least 2-3 of these are true for a sustained period:
   - Different teams need separate access control/compliance boundaries.
   - Cross-app/package atomic changes become rare.
   - CI duration or failure coupling materially slows delivery.
   - App release cadence diverges significantly from core/modules.
   - Operational/security requirements demand repo isolation.

4. **If split is approved (execution)**
   - Start with one app (`openape-agent-proxy`, likely lowest migration risk).
   - Publish/consume internal packages by semver (no `workspace:*` in target repo).
   - Keep a temporary integration test job in monorepo to detect regressions.
   - Migrate remaining apps only after first split proves stable.

## Practical Bottom Line

- **Short term:** stay monorepo.
- **Medium term:** harden boundaries and package contracts.
- **Long term:** split only when clear org/ops signals justify the added coordination cost.
