---
'@openape/nest': major
'@openape/apes': minor
---

Phase D of the architecture simplification (#sim-arch): the Nest is now a pure long-running CLIENT — no HTTP server.

**What changed**: `apes nest <op>` no longer POSTs to `127.0.0.1:9091`. Instead, the CLI drops a JSON intent file into `$NEST_HOME/intents/<uuid>.json`; the Nest polls the directory, executes the intent, writes `<uuid>.response` back. UNIX permissions on the dir gate access (mode 770, group `_openape_nest`) — same trust model the localhost HTTP+DDISA layer used to enforce, just at filesystem level. Patrick is in the `_openape_nest` group post-`migrate-to-service-user`, so he can drop intents.

**Why no HTTP**: the DDISA-grant gating at the HTTP boundary required a `nest spawn` grant per call; humans have no YOLO so each spawn would have re-prompted. Filesystem permissions sidestep that without losing security: anyone with shell access as Patrick can already do `apes run --as root --` directly.

**Removed**:
- `lib/auth.ts` (HTTP Bearer JWT verifier, JWKS cache)
- `tests/auth-negative.sh` (smoke test for the HTTP auth, no longer applicable)
- `apes nest status` command (consolidated into `apes nest list`)
- `nest-grant-flow.ts` (grant request + reuse logic for the now-deleted HTTP path)

**Added**:
- `apps/openape-nest/src/lib/intent-channel.ts` — directory-watcher
- `packages/apes/src/lib/nest-intent.ts` — CLI-side intent dispatcher
- `OPENAPE_NEST_INTENT_DIR` env override for tests / non-default installs

**Breaking change** for any operator that hand-rolled `curl http://127.0.0.1:9091/...` integrations: those break. Use `apes nest spawn|destroy|list` (which now drop intent files) or write JSON to the intents dir directly.
