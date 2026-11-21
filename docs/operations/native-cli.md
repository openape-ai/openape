# Project doctor

The native forge CLI (`pnpm git:cli`) was removed with the retired forge; use `gh`
for repository, issue and pull request work.

## Read-only diagnosis

```sh
pnpm run doctor
pnpm run doctor -- --app @openape-tasks/app
pnpm run doctor -- --network
pnpm run doctor -- --services --app @openape-tasks/app
```

The explicit `run` is required: `pnpm doctor` invokes pnpm's built-in doctor,
which can exit successfully without running any OpenApe checks. A successful
project diagnosis prints JSON with `readOnly: true`, the checkout `root`, a
`checks` array and `ok: true`. If pnpm itself cannot start, follow
[session toolchain setup](session-toolchain.md). Calling the Node script directly
does not fix a broken pnpm on PATH: its workspace inventory still uses pnpm.

The doctor checks exact Node from `.nvmrc` and pnpm from `package.json`, and reports
canonical remote and branch upstream, checkout
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

## Git authentication inside Pods

The `apps/openape-pods/scripts/git-credential-apes` helper reads `APES_AUTH_FILE` when set. Pods supplies
this managed, refreshed identity file to scheduled program calls and Pod terminals.
The helper returns credentials only for `protocol=https` and `host=repos.openape.ai`.
An empty, unreadable or invalid explicit file fails without using the owner's identity.
Outside Pods, the helper uses `$HOME/.config/apes/auth.json` from `apes login`.
Install it with `install -m 755 apps/openape-pods/scripts/git-credential-apes ~/.local/bin/git-credential-apes`
when the host Git configuration uses the `apes` credential helper.

Git smart-HTTP resolves the signing IdP from the direct token subject's DDISA domain.
The configured IdP is used only when that domain has no DDISA record; lookup failures
fail closed. Public HTTPS JWKS access, issuer, signature and audience checks precede
repository authorization. A foreign IdP cannot replace the verified subject through
email or delegation claims. Existing configured-IdP delegation trust is retained;
this direct-agent fix does not introduce federated delegation. Repository grants and
token scope caps still determine read/write access.
