---
'@openape/core': minor
'@openape/grants': minor
'@openape/nuxt-auth-idp': minor
'@openape/apes': minor
---

Add three shape tiers with one import path (issue 1553). Program calls resolve
with the caller's personal shapes first, then the shapes of the owner's email
domain, then the IdP-wide shapes; an upper tier overrides a lower one by
`cli_id` or executable, and an overridden shape drops out with its tested
digests. Only the Pods desktop names `pod-runtime`, `pod-http` and `pod-ssh`
stay reserved, so personal shapes may now use registry names. Grants on
personal and domain shapes bind tier and digest (`execution_context.adapter_owner`
or the new `adapter_domain`, written only by the IdP); IdP-wide grants keep
carrying over adapter updates. `POST /api/shapes/import?scope=instance|domain|personal`
(`?dry_run=1`) writes one all-or-nothing batch with optional `prune` and an
audit in `shape_changes`: IdP-wide shapes only with the management token,
domain shapes only by root admins and operators of their own domain, personal
shapes by the human owner. `PUT`/`DELETE /api/shapes/{cliId}` and
`GET /api/shapes` accept `?scope=`, `GET /api/shapes/changes?scope=` lists the
audit. `apes shapes import <dir> [--scope] [--dry-run] [--prune]` imports a
shapes-registry checkout or a folder of adapters (management token only from
`APES_MANAGEMENT_TOKEN`), and `publish`, `list` and `remove` take `--scope`.
The `/shapes` page has Personal, Domain and IdP-wide tabs, and the grant card
names the tier, its writer and what it overrides.
