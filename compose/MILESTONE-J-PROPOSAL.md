# Milestone J — HUMAN-IN-THE-LOOP destructive cleanup proposal

**Status:** Awaiting Patrick's explicit per-action approval. No file in this
list has been deleted yet. This document is the proposal — Patrick says
GO per item (or per group), and only then does the deletion PR get
opened.

**Precondition (must be true before any deletion):**

1. PR #494 + #495 (HostPlatform interface + privileged-exec collapse) are merged to main.
2. The container migration plan in `compose/MIGRATION-CODER.md` has been executed once successfully:
   - `docker compose up` brings up both services.
   - `coder` agent spawns inside the container.
   - `coder` opens a PR on a real `agent`-labelled issue.
   - `coder` is destroyed cleanly, no tombstones.
3. The bare-host macOS `coder` has been retired (no live agents on Patrick's Mac depend on the deleted code).

---

## Group 1 — macOS-only lifecycle code (safe to delete after step F-success)

These files are reachable ONLY via the legacy macOS bare-host path that
the container nest replaces.

| File | Size (LOC) | Why it goes |
|------|------------|-------------|
| `packages/apes/src/lib/agent-bootstrap.ts` | 752 | dscl/sysadminctl/launchctl bash scripts. Linux uses useradd/userdel. |
| `packages/apes/src/lib/launchd-reconcile.ts` | 282 | Per-task launchd plists — Linux uses systemd timers. |
| `packages/apes/src/lib/troop-bootstrap.ts` | 119 | Troop-sync launchd plist generator. Linux fold this into the bridge unit. |
| `packages/apes/src/lib/llm-bridge.ts` | 247 | macOS bridge plist + start script. Linux runs the bridge as a long-lived process inside the agent container. |
| `packages/apes/src/lib/macos-host.ts` | 31 | `ioreg` for `IOPlatformUUID`. Linux uses `/etc/machine-id`. |
| `packages/apes/src/lib/macos-user.ts` | 170 | dscl wrappers + orphan tombstone scan. Linux uses getent. |
| `packages/apes/src/commands/agents/cleanup-orphans.ts` | ~90 | Entire command — `sysadminctl -deleteUser` for tombstones. Linux has no tombstone concept. |

**Total: ~1690 LOC.**

The HostPlatform interface I built in PR #494/#495 routes the surviving
callers through `getHostPlatform()` — these files only stay reachable
via *direct imports* of the macOS modules from within themselves. Once
the imports are excised, they're dead code.

### Subtask 1.1 — Excise the dscl/launchctl direct imports

The remaining direct imports (post-#494/#495) are:

```
commands/agents/allow.ts:6: { whichBinary } from '../../lib/macos-user'
commands/agents/spawn.ts:29: { isShellRegistered, whichBinary } from '../../lib/macos-user'
commands/agents/destroy.ts:11: { whichBinary } from '../../lib/macos-user'
```

`whichBinary` + `isShellRegistered` are pure POSIX helpers; move them to
a platform-neutral `lib/posix-helpers.ts` and the `macos-user.ts`
imports across the codebase drop to zero. **Deferred to the deletion
PR itself** so the move and the delete land together.

### Subtask 1.2 — Excise `agent-bootstrap.ts` callers

`spawn.ts` still calls `buildSpawnSetupScript`, `registerAgentAtIdp`,
`issueAgentToken`, `buildAgentAuthJson`, `CLAUDE_SETTINGS_JSON`,
`BASH_VIA_APE_SHELL_HOOK_SOURCE` from `agent-bootstrap.ts`. NOT ALL of
those are macOS-specific:

- `registerAgentAtIdp` / `issueAgentToken` / `buildAgentAuthJson` are
  pure HTTP + JSON — keep, move to `lib/agent-identity.ts`.
- `CLAUDE_SETTINGS_JSON` / `BASH_VIA_APE_SHELL_HOOK_SOURCE` are static
  string constants — keep, move to `lib/claude-hook.ts`.
- `buildSpawnSetupScript` / `buildDestroyTeardownScript` /
  `runPhaseGTeardownInProcess` are the macOS dscl/launchctl bash —
  **delete** as part of this PR. spawn.ts/destroy.ts will need rewriting
  to build a Linux-flavoured setup script (`useradd`, `cp authorized_keys`,
  no plist) — that work lives in the deletion PR itself.

---

## Group 2 — Coexistence shims that become dead (delete after Group 1)

| File | What |
|------|------|
| `packages/apes/src/lib/host-platform/darwin.ts` | Façade over deleted modules. |
| `packages/apes/src/lib/host-platform/darwin-exec.ts` | `apes run --as <user> --wait` flow → only useful when escapes-via-DDISA exists, which it doesn't on Linux. |
| `packages/apes/src/lib/host-platform/darwin-nest.ts` | macOS launchd nest plist writer. |

Once `linuxHostPlatform` is the only impl, the `isDarwin` predicate is
also dead — flatten the factory to return `linuxHostPlatform` directly.

---

## Group 3 — Commands that lose meaning on Linux-only

| File | Why |
|------|-----|
| `packages/apes/src/commands/agents/cleanup-orphans.ts` | No tombstones to clean. |
| `packages/apes/src/commands/agents/allow.ts` | The "contact allowlist" the bridge consumes → revisit whether this still applies in container mode (the bridge there receives chat over the WS tunnel from troop, not over DDISA contacts). **Deferred decision** — discuss before deletion. |

---

## What stays

- `commands/agents/spawn.ts` (rewritten to produce a Linux setup script)
- `commands/agents/destroy.ts` (rewritten — `userdel -r` + systemd unit removal)
- `commands/agents/list.ts` (already platform-neutral via HostPlatform)
- `commands/agents/sync.ts` (already platform-neutral)
- `commands/nest/{install,uninstall,enroll,authorize,sync,reload-bridge}.ts` (Linux-aware)
- `commands/run.ts` — `apes run --as` keeps making sense (in-container `sudo -u`); the macOS `escapes`/DDISA path goes away.

---

## Execution plan (when Patrick says GO)

1. **Group 1 PR** — pure subtraction: move `whichBinary` + `isShellRegistered` + the identity/HTTP helpers to neutral homes; delete `macos-*` + `launchd-reconcile` + `troop-bootstrap` + `agent-bootstrap`'s macOS-only halves. Rewrite `spawn.ts` + `destroy.ts` to emit Linux setup/teardown scripts. CI green inside container.
2. **Group 2 PR** — delete the darwin host-platform files, flatten the factory, drop `isDarwin` predicate.
3. **Group 3 PR** — delete `cleanup-orphans` + decide `allow.ts` fate (separate small PR with the decision).

Each group is independently mergeable. Group 2 + 3 are blocked on Group 1.

**Net deletion when all three land: ~2000 LOC.**
