# Dependency audit repair (issue 1347)

The production audit at canonical base `db8d87cdbf67f6ac497a84004edebddc2f624240`
failed with four high findings and blocked the Pods M0 commit.
[Issue 1347](https://git.openape.ai/openape-ai/openape/issues/1347) tracks this
repair independently of [Pods M0](https://git.openape.ai/openape-ai/openape/issues/1346).

## Final dependency contract

| Dependency | Before | Required version | Primary advisory |
| --- | --- | --- | --- |
| sharp | 0.35.3 | 0.35.4 | [GHSA-rgj7-g3m4-5g8c](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c) |
| @tiptap/core | 3.27.1 | 3.30.5 | [GHSA-j95f-988m-3j2f](https://github.com/advisories/GHSA-j95f-988m-3j2f) |
| svgo | 4.0.2 | 4.1.0 | [GHSA-w27v-7q3p-w38r](https://github.com/advisories/GHSA-w27v-7q3p-w38r) |
| smol-toml | 1.7.0 | 1.7.1 | [GHSA-7w5x-hrqm-74c2](https://github.com/advisories/GHSA-7w5x-hrqm-74c2) |

Tiptap's packages declare exact matching peer versions. Its existing package
family therefore moves together to 3.30.5, with y-tiptap 3.0.7 satisfying the
collaboration peer requirement. Nuxt UI remains 4.9.0. The generated lockfile
contains no old Tiptap 3.27.1 copy. The broader lockfile diff includes related
peer snapshots and sharp/SVGO dependencies; it is not an application migration.

All added pins exceed the existing seven-day quarantine. Verified npm publication
timestamps: sharp 0.35.4 on August 26; core/pm 3.30.5 on August 26; SVGO 4.1.0 on
August 24; smol-toml 1.7.1 on July 26; y-tiptap 3.0.7 on July 14 (2026).
No quarantine exclusion or audit suppression was added. Existing exclusions
were preserved. Touched configuration comments were translated to English.

## Dependency ownership found by verification

Fresh resolution hoisted H3 2 instead of H3 1 at the repository root. Nine apps
imported `h3` without declaring it; six more module consumers use its types or
Nuxt auto-imports. Their existing H3 1 contract is now explicit through the
catalog, preventing accidental major-version selection from unrelated dependencies.
A scoped `packageExtensions` entry also declares H3 1 for Nuxt Content 3.14.0,
whose published runtime imports H3 but omits the dependency. Without it, the
Docs landing-page query called H3 2 against a Nitro 2 event and failed during
prerendering. Application runtime code is unchanged. `ape-secrets` also now declares its
existing Node type requirement as a development dependency rather than relying
on a hoisted copy.

These were observed failures, not speculative cleanups: TypeScript reported
possibly-undefined request bodies under H3 2, incompatible H3Event types in the
SP example, and a missing Node type definition in ape-secrets. Correct dependency
ownership fixed those checks without changing handler behavior or suppressing
compiler errors. Nuxt 4.5.2 also emits a production `defineProdDiagnostics`
import resolved from the root build context. The already-present nostics 1.2.0
is explicitly declared there so the build cannot accidentally load nostics 0.2.0,
which lacks that export. The real Docs prerender failure reproduced both
resolution defects; temporary diagnostic logging was removed.

## Validation

- Reproduced `pnpm audit --prod --audit-level=high` failure before editing.
- After resolution: zero high/critical findings; eight moderate and one low
  remain outside this blocker repair. The audit exits 0.
- `pnpm install --frozen-lockfile`: passed.
- `pnpm lint --force`: 50/50 tasks, zero cached.
- `pnpm typecheck --force`: 71/71 tasks, zero cached.
- `pnpm build --concurrency=2`: 48/48 tasks passed (16 cached library builds).
- `pnpm check:ci`: PASS, unit + all four E2E suites + all three layout suites.
  Evidence: `.openape/check-results/1789196274249-db8d87cd-all/summary.json`.
  The pre-push hook repeats this contract against the committed source.

The worktree is `openape-monorepo.worktrees/audit-dependencies`, branch
`bugfix/issue-1347-audit-dependencies`. No product deployment or package publication
is included. The Pods experiment remains in its separate worktree.
