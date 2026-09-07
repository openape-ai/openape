# Native forge CLI

Run `pnpm git:cli -- <command>` in this checkout (or `node scripts/ape-git.mjs`).
The CLI uses `.openape/repository.json` and the existing `@openape/cli-auth`
exchange/refresh path. Install frozen dependencies and run the shared prebuild
first. Authenticate your identity with `apes login`; tokens are never arguments
or output. No additional API key is required.

```sh
pnpm git:cli -- repo
pnpm git:cli -- pr list
pnpm git:cli -- pr create --title 'Fix local app ports' --source fix/issue-1342-local-ports --body-file /tmp/pr-body.md
pnpm git:cli -- pr show 19
pnpm git:cli -- pr diff 19
pnpm git:cli -- checks FULL_SOURCE_SHA
pnpm git:cli -- logs FULL_SOURCE_SHA --context 'CI / ci (push)'
pnpm git:cli -- wait FULL_SOURCE_SHA --timeout 900
pnpm git:cli -- pr comment 19 --body-file /tmp/review.md
pnpm git:cli -- pr merge 19 --expected-source FULL_REVIEWED_SOURCE_SHA --expected-target FULL_REVIEWED_TARGET_SHA
```

Use the actual PR number returned by `pr create`. All results are JSON (`--json`
is accepted explicitly). `--repo owner/name` selects another repository on the
same native forge. `--branch` selects the protection policy when reading checks.
The merge command requires both **previously reviewed full SHAs**. After a stale
review error, inspect the new diff/checks before submitting a new pair. It never
fetches new heads and silently approves them for you.

Exit codes: 0 success, 1 failed checks, 2 usage/auth/API error, 3 checks pending,
missing, unavailable or unconfigured. Error objects carry `error.code`, `message`
and optional HTTP `status`. A missing policy or context cannot look green.
`wait` polls at most every 10 seconds by default and has a bounded timeout.
`logs` returns signed CI excerpts matched to the external run; `targetUrl` leads
to the run and its complete artifacts. A missing excerpt is not a fabricated log.

## Read-only diagnosis

```sh
pnpm doctor
pnpm doctor -- --app @openape-tasks/app
pnpm doctor -- --network
pnpm doctor -- --services --app @openape-tasks/app
```

The doctor reports Node/pnpm, canonical remote and branch upstream, checkout
state, installation and CLI build presence, generated-map freshness and conflicting explicit dev ports.
It does not infer dependency integrity or build freshness from file existence.
App mode shows the actual start command, configuration source and whether
isolated database/session variables are present, never their values.

`--services` derives services from the actual Compose file, includes the selected
app when available, and checks its explicit TCP port. Missing/stopped services include a startup remedy; port presence alone is
not an application health check. This mode is optional when using in-process
IdP fixtures instead of Docker.

Network mode reads canonical main via `ls-remote` and native mirror/protection
state. It can refresh the normal local authentication cache through cli-auth;
it does not change Git refs, service settings, Docker state or application data.
A missing permission is reported as unavailable, not as a healthy mirror.
Suggested commands are printed but never executed automatically. Follow
[local development](local-development.md) for real login fixtures and isolated
app data; the doctor does not start services or reset databases.
