# Secrets vault (v2)

The passkey vault of `apps/openape-secrets` keeps secrets that only the owner's
passkeys open, and hands one approved secret version to one machine at a time.
Plan: https://report.openape.ai/d/01M5JEGAHN8GK0VWGQ4HAYH0VM (issue
https://repos.openape.ai/patrick/monorepo/issues/1535). The v1 fill/collect gate
is unchanged and independent: it cannot read the vault or create v2 approvals.

## Configuration

| Variable | Production value | Meaning |
| --- | --- | --- |
| `NUXT_VAULT_ENABLED` | `true` | Off by default; while off, every `/api/v2` vault route answers 404. |
| `NUXT_VAULT_OWNERS` | `patrick@hofmann.eco` | Rollout allowlist, comma-separated. Empty means every signed-in person. Requests and collections for other owners answer 404. |
| `NUXT_VAULT_RP_ID` | `secrets.openape.ai` | WebAuthn relying party. Passkeys are bound to it; changing it orphans every vault passkey. |
| `NUXT_VAULT_ORIGIN` | `https://secrets.openape.ai` | Exact origin for WebAuthn and for vault writes; also the base of approval links in notifications. |

The variables live in `/home/openape/projects/openape-secrets/shared/.env` on the
host (see `compose/chatty.yml`). The database is the existing `NUXT_TURSO_URL`
file; startup applies the additive vault tables and switches a file database to
WAL. An hourly sweep runs only while the vault is enabled.

## What the service stores

Never: PRF outputs, the vault master key (VMK), data keys, the recovery secret,
plaintext values or the private half of any signing key.

| Data | Visible to the service | Kept until |
| --- | --- | --- |
| Vault, passkeys | Owner email, passkey public keys, counters, labels, PRF inputs and salts (not secret), wrapped VMK per passkey | Removed passkeys keep their row with `disabled_at` |
| Recovery | Wrapped VMK and proof key, proof public key | The vault exists |
| Signing key | Public key; private key wrapped under the VMK | The vault exists |
| Secrets | Name, type, version numbers, timestamps; values and data keys only as ciphertext | Deleting a secret removes all its version ciphertext; the name stays as a tombstone for approval history |
| Requests | Requester identity, machine, key fingerprint, secret name, the requester's reason, status | Not purged |
| Approvals | Mode, end time, collection count; package ciphertext and vault signature | Packages are emptied when collected once, revoked, expired, superseded or swept |
| Audit | Event, actor, vault and credential IDs, result (`ok`/`refused`) | Not purged |

Emptying a column is not physical deletion: SQLite pages, the WAL and backups can
still hold old ciphertext. Expiry and revoke stop further API delivery; they do
not recall a value a machine already collected.

## Owner flows

`/vault/setup` creates the first passkey (one confirmation when the authenticator returns PRF output at creation; otherwise two local ceremonies whose PRF output must match),
the recovery kit and the signing key. `/vault` stores, shows, versions and
deletes secrets; every change needs a fresh passkey. `/approve/:id` approves
one request (once, for a while, until revoked). `/vault/approvals` lists and
revokes. `/vault/passkeys` adds passkeys, removes lost ones (confirmed by a
passkey that stays) and shows the vault key. `/vault/recover` replaces lost
passkeys with the recovery code; remove the lost passkeys afterwards.

## Machine and agent flow

```sh
ape-secrets keygen --name "Build box" --allow agent@example.com   # once, as the owner, on the machine
ape-secrets request --secret TELEGRAM_BOT_TOKEN --consumer ID --purpose "Deploy the bot"
ape-secrets wait REQUEST_ID
ape-secrets deliver APPROVAL_ID --out ./bot.env                   # or --stdin -- CMD, --env NAME -- CMD
```

`deliver` checks the approval, the local key and the target before collecting,
pins the vault key on first use (`~/.config/apes/secrets/vault-keys.json`) and
refuses packages with a different key or an invalid signature.

## Rollout and rollback

1. Deploy the image with the vault still disabled; check `/api/health` and the v1 fill page.
2. Set `NUXT_VAULT_ENABLED=true`, `NUXT_VAULT_OWNERS=patrick@hofmann.eco`, `NUXT_VAULT_RP_ID` and `NUXT_VAULT_ORIGIN`, then restart the container.
3. Owner acceptance on real devices: setup on iPhone and MacBook, a security key if available, a browser without PRF (must be refused), recovery on a second device, and one request per mode through `ape-secrets` with expiry, revoke and a new secret version.
4. Widen `NUXT_VAULT_OWNERS` only after that acceptance.

Rollback: set `NUXT_VAULT_ENABLED=false` (or remove the owner from the allowlist)
and restart; if the build itself is at fault, redeploy the previous image. Keep
the database and its backups: vault tables are additive, and dropping them would
destroy ciphertext only the owner can recreate. Never convert vault data to
server-side plaintext to recover.
