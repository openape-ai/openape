---
'@openape/cli-auth': minor
'@openape/apes': minor
---

In-process Ed25519 challenge-response refresh for agent IdP tokens (closes #259).

Agent tokens have no `refresh_token` — the IdP's `/agent/authenticate` endpoint deliberately doesn't issue one. Before this change, `ensureFreshIdpAuth` threw `NotLoggedInError` when an agent token expired, which left the chat-bridge daemon in a 1-hour crash-restart loop: launchd's KeepAlive bounced the process every time the cached token aged out, the start.sh shell-out re-ran `apes login` to mint a fresh one, and the cycle repeated.

- **`@openape/cli-auth`** now refreshes agent tokens in-process. When `auth.json.refresh_token` is missing but `key_path` (or `~/.ssh/id_ed25519`) is present, `ensureFreshIdpAuth` signs a new challenge against the IdP's `/agent/challenge` + `/agent/authenticate` endpoints — same flow `apes login --key` uses — and persists the rotated token. The chat-bridge daemon now stays connected across the 1h expiry boundary.
- **`@openape/apes`**: `apes login` and `apes agents spawn` write `key_path` into auth.json so any cli-auth consumer (chat-bridge, ape-tasks, ape-plans, …) inherits the in-process refresh capability for free. `saveAuth` merges with existing fields so older spawns retain `owner_email` across logins (mirrors PR #257's cli-auth fix). `start.sh` no longer shells out to `apes login` at boot — the install is now ~3-5s instead of doing the legacy refresh dance.
- **`@openape/cli-auth`** new public types: `IdpAuth.key_path` (optional, absolute path to the Ed25519 signing key).
