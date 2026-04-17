---
'@openape/apes': minor
'@openape/nuxt-auth-idp': patch
---

Add generic-fallback mode for `apes run -- <cli>` when the CLI has no
registered shape.

**Before:** `apes run -- kubectl get pods` hard-failed with
`"No adapter found for kubectl"` unless a full `kubectl.toml` shape was
written first.

**After:** `apes run -- kubectl get pods` creates a synthetic adapter
in-memory, requests a single-use grant with `risk=high` and
`exact_command=true`, and runs the command once approved. An stderr
warning makes the fallback explicit:

```
⚠ No shape registered for `kubectl`.
Generic mode active — single-use grant will be required.
```

**Safety layers:**
- Forced `risk: "high"` on every generic grant
- Forced `exact_command: true` — grant is bound to the exact argv hash
- Single-use by default (enforced by IdP `usedAt` timestamp)
- `~/.config/apes/generic-calls.log` captures every successful generic
  execution as JSONL for later shape promotion
- Free-IdP approval page shows a prominent "⚠ Unshaped CLI" banner

**Opt-out:** `[generic] enabled = false` in `~/.config/apes/config.toml`
restores the legacy hard-fail behaviour.

**Compatibility:**
- Existing shapes are unaffected — generic-fallback only activates when
  `loadAdapter()` throws "No adapter found".
- The synthetic path bypasses `resolveCommand()` entirely and feeds a
  pre-built `ResolvedCommand` into the grant pipeline. Parser remains
  unchanged.
- The audit-log hook sits in `verifyAndExecute`, covering sync (`--wait`),
  async-default (`apes run` → `apes grants run <id> --wait`), and REPL
  one-shot paths with one implementation.
- `apes run --as <user>` (escapes) and `ape-shell` one-shot session-grant
  behaviour are unchanged.

**New public surface (`@openape/apes`):**
- `shapes/generic.ts`: `buildGenericAdapter`, `buildGenericResolved`,
  `isGenericResolved`, `GENERIC_OPERATION_ID`
- `shapes/adapters.ts`: `resolveGenericOrReject`
- `audit/generic-log.ts`: `appendGenericCallLog`, `defaultGenericLogPath`
- `config.ts`: `isGenericFallbackEnabled`, `getGenericAuditLogPath`,
  `ApesConfig.generic`
