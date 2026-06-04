# Linux-only Agent-Spawn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apes agents spawn` work on the Linux Docker nest by creating the agent OS user with `useradd` instead of macOS `dscl`, and rip out the now-dead macOS-native execution path entirely (one platform, one tested code path).

**Architecture:** `apes agents spawn` builds a privileged bash script and runs it through the existing `HostPlatform.runPrivilegedBash(script)` boundary (already Linux-capable: `runPrivilegedBashOnLinux` execs `bash <script>` as root in the container). The script today is `dscl`-coded and gated behind an `isDarwin()` guard; we replace its body with `useradd`/`getent`/`install`/`chown`, drop the guard, and stop constructing launchd plists (the nest's cross-platform `Pm2Supervisor` already supervises each agent's `ape-agent` process and forwards env via pm2's `env:` block — no per-agent bridge `.env` or troop-sync plist is needed on Linux). Then we delete the macOS-only modules and resolve the 16 `isDarwin()` branches to their Linux path.

**Tech Stack:** TypeScript (ESM, NodeNext), citty (CLI), vitest (`vitest run --coverage`), `@antfu/eslint-config` (no semicolons, single quotes). Package: `packages/apes` (`@openape/apes`). Node ≥22.

---

## Context an implementer needs (read once before Task 1)

**Topology.** Troop (chatty) does not spawn agents itself — it dispatches a `spawn-intent` over `nest-ws` to a **nest**, and the nest runs `apes agents spawn <name>` locally. The production nest is the Linux `openape-nest` Docker container (runs as root, PID 1). So "spawn on Linux" is the real production path; macOS-native spawn was only ever the dev-host path and is being retired.

**The privileged-exec boundary already works on Linux.** `packages/apes/src/lib/host-platform/linux-exec.ts` → `runPrivilegedBashOnLinux(script)` writes the script to a temp file and `execFileSync('bash', [path])` when `getuid() === 0` (the container case), else `sudo -n -- bash <path>`. `spawn.ts` already calls `await platform.runPrivilegedBash(script)` at the end. The only thing wrong is **what the script contains** and the `isDarwin()` gate in front of it.

**The supervisor already works on Linux.** `apps/openape-nest/src/lib/pm2-supervisor.ts` → `Pm2Supervisor.reconcile()` reads the agent registry (`/var/openape/agents/<name>`) and runs one pm2-supervised `ape-agent` process per agent, as the agent's OS user (`sudo -n -H -u <name>` when `OPENAPE_BYPASS_APE_SHELL=1`, the container default). Crucially, `ecosystemContents()` forwards LLM/bridge config via pm2's `env:` block **from the nest process's own environment** (the compose `.env`). **Therefore the spawn script must NOT write a per-agent bridge `.env` on Linux** — it would be dead. spawn just creates the user + writes the agent's identity files (ssh key, `auth.json`, x25519 keys, optional Claude token + hook); the nest registry write + `Pm2Supervisor` do the rest.

**Linux user model (already decided in `host-platform/linux.ts`).** No `openape-agent-` prefix on Linux — the agent name **is** the OS username (`agentUsername: (n) => n`). `readLinuxUser` / `listLinuxUserNames` (`linux-user.ts`) read via `getent passwd`. There is **no tombstone concept** on Linux (`userdel` is clean), so `listOrphanAgentUsers()` returns `[]`.

**Home dir.** Keep agents out of `/home/` (where real operator accounts live) by using `/var/openape/homes/<name>` — the same namespace the macOS path used. `useradd --create-home --home-dir /var/openape/homes/<name>` creates the leaf dir; the script must `mkdir -p /var/openape/homes` first (useradd does not create missing parents).

**Definition of Done (repo rule, `.claude/CLAUDE.md`).** Before any commit: `pnpm lint` clean AND `pnpm typecheck` clean. Tests via `pnpm --filter @openape/apes test`. Commit conventional, ≤80 chars, **never** add an AI co-author.

**File map (what each touched file is responsible for after this plan):**

| File | Responsibility after change |
|------|------------------------------|
| `packages/apes/src/lib/which.ts` | **NEW.** Neutral `whichBinary(name)` PATH lookup (moved out of the deleted `macos-user.ts`). |
| `packages/apes/src/lib/agent-bootstrap.ts` | IdP enroll/token + `buildSpawnSetupScript` now emits the **Linux** (useradd) script. macOS dscl script, plist blocks, and Phase-G/destroy dscl teardown helpers removed. |
| `packages/apes/src/commands/agents/spawn.ts` | Linux-only orchestration: register → token → build Linux script → `runPrivilegedBash` → registry write. No `isDarwin` guard, no plist construction, no `/etc/shells` check. |
| `packages/apes/src/commands/agents/{allow,destroy,list,cleanup-orphans}.ts`, `commands/run.ts` | `isDarwin()` branches resolved to the Linux path. |
| `packages/apes/src/lib/host-platform/index.ts` | `getHostPlatform()` returns the Linux impl (or test override); throws on non-Linux. `darwin` import gone. |
| **Deleted** | `lib/macos-user.ts`, `lib/macos-host.ts`, `lib/launchd-reconcile.ts`, `lib/troop-bootstrap.ts`, `lib/host-platform/darwin.ts`, `darwin-exec.ts`, `darwin-nest.ts`; macOS-launchd exports in `lib/llm-bridge.ts`; `test/troop-bootstrap.test.ts` + macOS-only cases. |

---

### Task 1: Extract `whichBinary` into a platform-neutral module

`whichBinary` currently lives in `macos-user.ts` (which we delete in Task 6) but is imported by `spawn.ts`, `allow.ts`, `destroy.ts`. Move it first so nothing breaks.

**Files:**
- Create: `packages/apes/src/lib/which.ts`
- Create: `packages/apes/test/which.test.ts`
- Modify: `packages/apes/src/commands/agents/spawn.ts:25` (import), `commands/agents/allow.ts`, `commands/agents/destroy.ts` (imports)

- [ ] **Step 1: Write the failing test**

`packages/apes/test/which.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

afterEach(() => { vi.resetAllMocks() })

describe('whichBinary', () => {
  it('returns the trimmed absolute path when found', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockReturnValue('/usr/local/bin/apes\n')
    const { whichBinary } = await import('../src/lib/which.js')
    expect(whichBinary('apes')).toBe('/usr/local/bin/apes')
  })

  it('returns null when which exits non-zero', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('not found') })
    const { whichBinary } = await import('../src/lib/which.js')
    expect(whichBinary('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openape/apes exec vitest run test/which.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/which.js'`.

- [ ] **Step 3: Create the module**

`packages/apes/src/lib/which.ts`:
```ts
import { execFileSync } from 'node:child_process'

/**
 * Resolve a binary on PATH using `which`. Returns the absolute path or null.
 */
export function whichBinary(name: string): string | null {
  try {
    const out = execFileSync('which', [name], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || null
  }
  catch {
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openape/apes exec vitest run test/which.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Repoint the three importers**

In `packages/apes/src/commands/agents/spawn.ts` change line 25 from:
```ts
import { isShellRegistered, whichBinary } from '../../lib/macos-user'
```
to (drop `isShellRegistered` — Task 3 removes its use):
```ts
import { whichBinary } from '../../lib/which'
```

In `packages/apes/src/commands/agents/allow.ts` and `commands/agents/destroy.ts`, find the `whichBinary` import (it comes from `'../../lib/macos-user'`) and change the source to `'../../lib/which'`. If `macos-user` is imported only for `whichBinary` in that file, replace the whole import; if it also imports other macos-user symbols, split into two imports (the macos-user ones get cleaned in Task 6 / Task 5 anyway).

- [ ] **Step 6: Verify compile + existing tests still green**

Run: `pnpm --filter @openape/apes typecheck && pnpm --filter @openape/apes test`
Expected: typecheck clean; all tests pass (spawn/allow/destroy still import `whichBinary`, now from the new module).

- [ ] **Step 7: Commit**

```bash
git add packages/apes/src/lib/which.ts packages/apes/test/which.test.ts \
  packages/apes/src/commands/agents/spawn.ts \
  packages/apes/src/commands/agents/allow.ts \
  packages/apes/src/commands/agents/destroy.ts
git commit -m "refactor(apes): extract whichBinary into lib/which"
```

---

### Task 2: Emit a Linux `useradd` spawn script from `buildSpawnSetupScript`

Replace the dscl body of `buildSpawnSetupScript` with a Linux one, and slim `SpawnSetupScriptInput` (drop `macOSUsername`, `bridge`, `troop` — none are used on Linux). The platform-neutral parts (ssh keys, `auth.json`, x25519, Claude settings/hook, Claude token env) stay verbatim.

**Files:**
- Modify: `packages/apes/src/lib/agent-bootstrap.ts` (the `SpawnSetupScriptInput` interface + `buildSpawnSetupScript` and its helper blocks)
- Modify: `packages/apes/test/agents-bootstrap.test.ts` (assert Linux script shape)

- [ ] **Step 1: Write the failing test**

Add to `packages/apes/test/agents-bootstrap.test.ts` a `describe('buildSpawnSetupScript (linux)')`. Use the real export. Minimal valid input:
```ts
import { buildSpawnSetupScript } from '../src/lib/agent-bootstrap.js'

const baseInput = {
  name: 'coder',
  homeDir: '/var/openape/homes/coder',
  shellPath: '/bin/bash',
  privateKeyPem: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
  publicKeySshLine: 'ssh-ed25519 AAAAFAKE',
  x25519PrivateKey: 'PRIVB64',
  x25519PublicKey: 'PUBB64',
  authJson: '{"idp":"https://id.openape.ai"}\n',
  claudeSettingsJson: null,
  hookScriptSource: null,
  claudeOauthToken: null,
}

describe('buildSpawnSetupScript (linux)', () => {
  it('creates the agent user via useradd, not dscl', () => {
    const s = buildSpawnSetupScript(baseInput)
    expect(s).toContain('useradd --create-home --home-dir \'/var/openape/homes/coder\'')
    expect(s).toContain('--shell \'/bin/bash\'')
    expect(s).toContain('--comment \'OpenApe Agent coder\'')
    expect(s).not.toContain('dscl')
    expect(s).not.toContain('launchctl')
    expect(s).not.toContain('NFSHomeDirectory')
    expect(s).not.toContain('Library/Application Support')
  })

  it('guards user creation behind a getent existence check (idempotent)', () => {
    const s = buildSpawnSetupScript(baseInput)
    expect(s).toContain('if ! getent passwd "$NAME" >/dev/null 2>&1; then')
  })

  it('writes the identity files and locks down perms', () => {
    const s = buildSpawnSetupScript(baseInput)
    expect(s).toContain('"$HOME_DIR/.ssh/id_ed25519"')
    expect(s).toContain('"$HOME_DIR/.config/apes/auth.json"')
    expect(s).toContain('"$HOME_DIR/.config/openape/agent-x25519.key"')
    expect(s).toContain('chmod 600 "$HOME_DIR/.ssh/id_ed25519"')
    expect(s).toContain('chown -R "$NAME:" "$HOME_DIR"')
  })

  it('creates the agent-sync task dir under ~/.openape (not ~/Library)', () => {
    const s = buildSpawnSetupScript(baseInput)
    expect(s).toContain('mkdir -p "$HOME_DIR/.openape/agent/tasks"')
  })

  it('includes the claude hook + settings only when provided', () => {
    const withHook = buildSpawnSetupScript({
      ...baseInput,
      claudeSettingsJson: '{"hooks":{}}',
      hookScriptSource: '#!/bin/bash\necho hi\n',
    })
    expect(withHook).toContain('.claude/settings.json')
    expect(withHook).toContain('.claude/hooks/bash-via-ape-shell.sh')
  })
})
```
Also DELETE the old macOS `buildSpawnSetupScript` test cases in this file (any asserting `dscl`, `UniqueID`, `NFSHomeDirectory`, tombstone reuse, or `Library/` bridge paths) — they describe behaviour we are removing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openape/apes exec vitest run test/agents-bootstrap.test.ts`
Expected: FAIL — current script contains `dscl` / `NFSHomeDirectory`, so the new assertions fail.

- [ ] **Step 3: Slim the input interface**

In `packages/apes/src/lib/agent-bootstrap.ts`, replace the `SpawnSetupScriptInput` interface with (drop `macOSUsername`, `bridge`, `troop`):
```ts
export interface SpawnSetupScriptInput {
  name: string
  /** Absolute home dir, under /var/openape/homes/<name>. */
  homeDir: string
  /** Login shell, e.g. /bin/bash. */
  shellPath: string
  privateKeyPem: string
  publicKeySshLine: string
  /** Agent X25519 keypair (base64url) for sealed capability secrets. */
  x25519PrivateKey: string
  x25519PublicKey: string
  authJson: string
  claudeSettingsJson: string | null
  hookScriptSource: string | null
  /** Long-lived Claude Code OAuth token; null = agent auths interactively. */
  claudeOauthToken: string | null
}
```
Delete the `SpawnBridgeFiles` and `SpawnTroopFiles` interfaces and the `buildBridgeBlock`, `buildBridgeBootstrapBlock`, `buildTroopBlock`, `buildTroopBootstrapBlock` helper functions (all macOS/launchd-era; bridge env now comes from the nest's pm2 `env:` block).

- [ ] **Step 4: Replace `buildSpawnSetupScript` body with the Linux script**

Keep the existing `claudeBlock` and `claudeTokenBlock` computations (they reference `$HOME_DIR`, platform-neutral). Replace the `return` template:
```ts
export function buildSpawnSetupScript(input: SpawnSetupScriptInput): string {
  const { name, homeDir, shellPath } = input

  // Trailing newline on PEM keeps OpenSSL happy.
  const privatePemForHeredoc = input.privateKeyPem.endsWith('\n')
    ? input.privateKeyPem
    : `${input.privateKeyPem}\n`

  const claudeBlock = input.claudeSettingsJson && input.hookScriptSource
    ? `
mkdir -p "$HOME_DIR/.claude/hooks"
cat > "$HOME_DIR/.claude/settings.json" ${shHeredoc(input.claudeSettingsJson)}
cat > "$HOME_DIR/.claude/hooks/bash-via-ape-shell.sh" ${shHeredoc(input.hookScriptSource)}
chmod 755 "$HOME_DIR/.claude/hooks/bash-via-ape-shell.sh"
`
    : ''

  const claudeTokenBlock = input.claudeOauthToken
    ? `
mkdir -p "$HOME_DIR/.config/openape"
cat > "$HOME_DIR/.config/openape/claude-token.env" ${shHeredoc(`# Auto-generated by 'apes agents spawn'. chmod 600 — contains a long-lived\n# Claude Code OAuth token. Rotate by editing this file in place; the\n# .zshenv / .profile source-lines below will pick it up automatically.\nexport CLAUDE_CODE_OAUTH_TOKEN=${shQuote(input.claudeOauthToken)}\n`)}
SOURCE_LINE='[ -f "$HOME/.config/openape/claude-token.env" ] && . "$HOME/.config/openape/claude-token.env"'
for f in "$HOME_DIR/.zshenv" "$HOME_DIR/.profile"; do
  touch "$f"
  if ! grep -qF 'config/openape/claude-token.env' "$f" 2>/dev/null; then
    {
      echo ''
      echo '# OpenApe: load Claude Code OAuth token (added by apes agents spawn)'
      echo "$SOURCE_LINE"
    } >> "$f"
  fi
done
`
    : ''

  return `#!/bin/bash
set -euo pipefail

# Wide PATH so useradd / getent / install / chown resolve regardless of
# how the privileged wrapper trimmed the environment.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

NAME=${shQuote(name)}
HOME_DIR=${shQuote(homeDir)}
SHELL_PATH=${shQuote(shellPath)}

# Agent homes live under /var/openape/homes/ — out of /home/ where real
# operator accounts live. useradd --create-home makes the leaf dir but not
# missing parents, so pre-create the parent (world-traversable).
mkdir -p /var/openape/homes
chmod 755 /var/openape/homes

# Create the agent's OS user if absent. spawn.ts already refused earlier
# when the user existed, but guard here too so a re-run of the privileged
# script is idempotent rather than erroring on a half-created account.
if ! getent passwd "$NAME" >/dev/null 2>&1; then
  useradd --create-home --home-dir "$HOME_DIR" --shell "$SHELL_PATH" --comment "OpenApe Agent $NAME" "$NAME"
fi

# Resolve the uid for the final report line (getent is the canonical read).
NEW_UID=$(getent passwd "$NAME" | cut -d: -f3)

# Identity dirs — created owned by the agent so the file writes below land
# with the right owner even before the final recursive chown.
install -d -m 700 -o "$NAME" "$HOME_DIR/.ssh"
install -d -m 700 -o "$NAME" "$HOME_DIR/.config"
install -d -m 700 -o "$NAME" "$HOME_DIR/.config/apes"
install -d -m 700 -o "$NAME" "$HOME_DIR/.config/openape"

cat > "$HOME_DIR/.ssh/id_ed25519" ${shHeredoc(privatePemForHeredoc.trimEnd())}
cat > "$HOME_DIR/.ssh/id_ed25519.pub" ${shHeredoc(input.publicKeySshLine)}
cat > "$HOME_DIR/.config/apes/auth.json" ${shHeredoc(input.authJson)}
cat > "$HOME_DIR/.config/openape/agent-x25519.key" ${shHeredoc(input.x25519PrivateKey)}
cat > "$HOME_DIR/.config/openape/agent-x25519.key.pub" ${shHeredoc(input.x25519PublicKey)}
${claudeBlock}${claudeTokenBlock}
# Per-agent task dir that \`apes agents sync\` writes to (XDG-style on
# Linux; was ~/Library/... on macOS).
mkdir -p "$HOME_DIR/.openape/agent/tasks"

chown -R "$NAME:" "$HOME_DIR"
chmod 700 "$HOME_DIR/.ssh"
chmod 700 "$HOME_DIR/.config"
chmod 700 "$HOME_DIR/.config/openape"
chmod 600 "$HOME_DIR/.ssh/id_ed25519"
chmod 644 "$HOME_DIR/.ssh/id_ed25519.pub"
chmod 600 "$HOME_DIR/.config/apes/auth.json"
chmod 600 "$HOME_DIR/.config/openape/agent-x25519.key"
chmod 644 "$HOME_DIR/.config/openape/agent-x25519.key.pub"
if [ -f "$HOME_DIR/.config/openape/claude-token.env" ]; then
  chmod 600 "$HOME_DIR/.config/openape/claude-token.env"
fi

echo "OK $NAME (linux user) uid=$NEW_UID home=$HOME_DIR"
`
}
```

- [ ] **Step 5: Delete the dscl teardown helpers (dead once macOS is gone)**

In the same file, delete `runPhaseGTeardownInProcess`, `buildPhaseGTeardownScript`, `buildDestroyTeardownScript`, and `DestroyTeardownScriptInput` — all are macOS-dscl/sysadminctl/launchctl teardown. (Task 4 confirms `destroy.ts` no longer imports them; if anything else does, the typecheck in Step 7 will flag it.) Keep `shQuote`, `shHeredoc`, `buildAgentAuthJson`, `AuthJsonInput`, `CLAUDE_SETTINGS_JSON`, `BASH_VIA_APE_SHELL_HOOK_SOURCE`, and the IdP enroll/token functions.

- [ ] **Step 6: Run the bootstrap test to verify it passes**

Run: `pnpm --filter @openape/apes exec vitest run test/agents-bootstrap.test.ts`
Expected: PASS — the new Linux assertions hold; deleted macOS cases are gone.

- [ ] **Step 7: Typecheck (surfaces every now-orphaned reference)**

Run: `pnpm --filter @openape/apes typecheck`
Expected: errors ONLY in `spawn.ts` (still imports `buildSyncPlist`, constructs `bridge`/`troop`, passes `macOSUsername`) — those are fixed in Task 3. If errors appear in any OTHER file, that file still references a deleted teardown helper; note it for Task 4/5. Do not commit yet — Task 3 lands with this.

---

### Task 3: Rewire `spawn.ts` to the Linux path

Remove the `isDarwin()` guard, the `/etc/shells` check, the launchd/plist construction, and the `macOSUsername` plumbing. Default the login shell to `/bin/bash`.

**Files:**
- Modify: `packages/apes/src/commands/agents/spawn.ts`
- Modify: `packages/apes/test/agents-spawn.test.ts`

- [ ] **Step 1: Update the spawn test to the Linux contract**

Rewrite `packages/apes/test/agents-spawn.test.ts`:
- Drop the `../src/lib/macos-user.js` mock entirely.
- In the `hostPlatformMock`, set `isDarwin: () => false`, `isLinux: () => true`, and `agentUsername: (n) => n` (no prefix), `readAgentUser: () => readUserMock()` where `readUserMock` is a `vi.fn(() => null)` you control per-test.
- Remove the `llm-bridge.js` mock's `buildBridgePlist` / `bridgePlistLabel` / `bridgePlistPath` / `buildBridgeStartScript` entries (no longer imported). Keep `captureHostBinDirs`/`resolveBridgeConfig`/`buildBridgeEnvFile` mocks only if `spawn.ts` still imports them after Step 2 — it should NOT, so remove the whole `llm-bridge.js` mock.
- Replace the `rejects on non-darwin platforms` test and the `/etc/shells` test with:
```ts
it('happy path: registers, issues token, runs the linux setup script', async () => {
  const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
  await (spawnAgentCommand as any).run({ args: { name: 'agent-a' } })

  expect(bootstrapMock.registerAgentAtIdp).toHaveBeenCalledWith({
    name: 'agent-a',
    publicKey: 'ssh-ed25519 AAAAFAKE',
    idp: 'https://id.openape.ai',
  })
  expect(bootstrapMock.buildSpawnSetupScript).toHaveBeenCalledTimes(1)
  const buildArgs = bootstrapMock.buildSpawnSetupScript.mock.calls[0]![0] as any
  expect(buildArgs.shellPath).toBe('/bin/bash')
  expect(buildArgs.homeDir).toBe('/var/openape/homes/agent-a')
  expect(buildArgs).not.toHaveProperty('macOSUsername')
  expect(buildArgs).not.toHaveProperty('bridge')
  expect(buildArgs).not.toHaveProperty('troop')
  expect(runPrivilegedBashMock).toHaveBeenCalledTimes(1)
})

it('refuses when the OS user already exists', async () => {
  readUserMock.mockReturnValue({ name: 'agent-a', uid: 1001, shell: '/bin/bash', homeDir: '/var/openape/homes/agent-a' })
  const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
  await expect((spawnAgentCommand as any).run({ args: { name: 'agent-a' } })).rejects.toThrow(/already exists/)
})
```
Keep the `rejects an invalid agent name`, `rejects when escapes binary is missing`, `--no-claude-hook`, and `propagates errors when runPrivilegedBash fails` cases (they're platform-neutral; the escapes/whichBinary mock now comes from the `host-platform` + a `lib/which.js` mock — add `vi.mock('../src/lib/which.js', () => ({ whichBinary: vi.fn((n: string) => `/usr/local/bin/${n}`) }))` and drive the missing-escapes case through it).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openape/apes exec vitest run test/agents-spawn.test.ts`
Expected: FAIL — `spawn.ts` still imports macos-user / plist builders and passes `macOSUsername`.

- [ ] **Step 3: Edit the imports in `spawn.ts`**

Replace lines 14–27 (the `troop-bootstrap`, `llm-bridge`, `macos-user`, `host-platform`, `nest-registry` import cluster) with:
```ts
import { generateKeyPairInMemory } from '../../lib/keygen'
import { resolveBridgeConfig } from '../../lib/llm-bridge'
import { whichBinary } from '../../lib/which'
import { getHostPlatform } from '../../lib/host-platform'
import { upsertNestAgent } from '../../lib/nest-registry'
```
(`resolveBridgeConfig` stays only if the registry `upsertNestAgent` call still passes a `bridge` object — see Step 6. If after Step 6 nothing uses it, drop this import too.)

- [ ] **Step 4: Remove the guard + shell-registration check + default shell to bash**

Delete the `if (!isDarwin()) { … }` block (lines ~91–96). Delete the `if (!isShellRegistered(loginShell)) { … }` block (lines ~126–132). Change the default shell at line ~114:
```ts
const loginShell = (args.shell ?? '/bin/bash').toString()
```
Update the command `meta.description`, the `name` arg description, and the `shell` arg description to say "Linux agent" / "Login shell for the agent's OS user. Default: /bin/bash." instead of macOS wording.

- [ ] **Step 5: Replace the username/home derivation**

Replace the `macOSUsername` block (lines ~141–159) with:
```ts
const platform = getHostPlatform()
const osUsername = platform.agentUsername(name) // identity on Linux: name === username
const existing = platform.readAgentUser(osUsername)
if (existing) {
  throw new CliError(`OS user "${existing.name}" already exists (uid=${existing.uid ?? '?'}). Refusing to overwrite.`)
}
const homeDir = `/var/openape/homes/${osUsername}`
```

- [ ] **Step 6: Remove plist construction; build the slim script input**

Delete the `bridge` IIFE block (lines ~199–223), the troop-plist block (lines ~225–240), and replace the `buildSpawnSetupScript({...})` call (lines ~242–257) with:
```ts
const withBridge = !args['no-bridge']
const script = buildSpawnSetupScript({
  name,
  homeDir,
  shellPath: loginShell,
  privateKeyPem: privatePem,
  publicKeySshLine: publicSshLine,
  x25519PrivateKey,
  x25519PublicKey,
  authJson,
  claudeSettingsJson: includeClaudeHook ? CLAUDE_SETTINGS_JSON : null,
  hookScriptSource: includeClaudeHook ? BASH_VIA_APE_SHELL_HOOK_SOURCE : null,
  claudeOauthToken,
})
```
Keep the `upsertNestAgent({...})` call as-is (it still records `bridge: withBridge ? {...} : undefined` so the nest's `Pm2Supervisor` supervises the agent). The `uid` read at line ~273 should use `platform.readAgentUser(osUsername)?.uid ?? -1` (drop the macOS-only `readMacOSUidOrNull`/`name`-fallback). If `resolveBridgeConfig` is unused after this, delete its import from Step 3.

- [ ] **Step 7: Run typecheck + the spawn test**

Run: `pnpm --filter @openape/apes typecheck && pnpm --filter @openape/apes exec vitest run test/agents-spawn.test.ts`
Expected: typecheck clean for `spawn.ts` + `agent-bootstrap.ts`; spawn test passes. (Other files with `isDarwin` are Task 4 — they still compile because `isDarwin` still exists in `host-platform/index.ts` until Task 5.)

- [ ] **Step 8: Commit**

```bash
git add packages/apes/src/lib/agent-bootstrap.ts packages/apes/test/agents-bootstrap.test.ts \
  packages/apes/src/commands/agents/spawn.ts packages/apes/test/agents-spawn.test.ts
git commit -m "feat(apes): spawn agents on linux via useradd, drop macOS path"
```

---

### Task 4: Resolve the remaining `isDarwin()` branches to the Linux path

`run.ts`, `allow.ts`, `destroy.ts`, `list.ts`, `cleanup-orphans.ts` each branch on `isDarwin()`. On a Linux-only world the Linux side is the only side.

**Files:**
- Modify: `packages/apes/src/commands/run.ts:29,46–52`
- Modify: `packages/apes/src/commands/agents/allow.ts:7,36–41`
- Modify: `packages/apes/src/commands/agents/destroy.ts:12,89–90,242–244` (+ teardown call site)
- Modify: `packages/apes/src/commands/agents/list.ts:6,49,93`
- Modify: `packages/apes/src/commands/agents/cleanup-orphans.ts:5,41–43`

- [ ] **Step 1: `run.ts` — the prefix-mapping helper becomes pass-through-ish**

The helper maps `igor` → `openape-agent-igor` on macOS. On Linux `agentUsername` is identity, so the lookup still works but never rewrites. Change the import (line 29) to `import { getHostPlatform } from '../lib/host-platform'` and delete the `if (!isDarwin()) return runAs` line (line 46) — keep the rest (it now resolves `platform.agentUsername(runAs)`, which equals `runAs` on Linux, then checks `readAgentUser`). Net behaviour identical on Linux, no macOS conditional.

- [ ] **Step 2: `allow.ts` — drop the macOS-only refusal**

Change import (line 7) to `import { getHostPlatform } from '../../lib/host-platform'`. Delete the `if (!isDarwin()) { throw new CliError('… macOS-only') }` block (lines 36–38). Keep the `if (!getHostPlatform().lookupAgentUser(agent))` check, but reword its error to drop "macOS": `No OS user for agent "${agent}" — has it been spawned?`.

- [ ] **Step 3: `destroy.ts` — Linux teardown via the platform, no dscl/sysadminctl**

Change import (line 12) to `import { getHostPlatform } from '../../lib/host-platform'`. At line 89 replace `const osUser = isDarwin() ? getHostPlatform().lookupAgentUser(name) : null` with `const osUser = getHostPlatform().lookupAgentUser(name)`. At lines 242–244 delete the `else if (… && isDarwin())` "No macOS user to remove" branch (or fold its message into the unconditional path). For the actual OS-user removal: the previous macOS path piped an admin password into `buildDestroyTeardownScript`. On Linux, removal is `userdel -r <name>` run through `platform.runPrivilegedBash`. Replace the macOS teardown invocation with:
```ts
if (osUserExists) {
  consola.start(`Removing OS user ${name}…`)
  await getHostPlatform().runPrivilegedBash(
    `#!/bin/bash\nset -euo pipefail\nif getent passwd ${JSON.stringify(name)} >/dev/null 2>&1; then\n  pkill -9 -u ${JSON.stringify(name)} 2>/dev/null || true\n  userdel -r ${JSON.stringify(name)}\nfi\n`,
  )
}
```
Remove any now-dead imports (`readPasswordSilent` from `silent-password`, `buildDestroyTeardownScript`). If `silent-password.ts` is unused repo-wide after this, leave it for Task 5's dead-code sweep (note it).

- [ ] **Step 4: `list.ts` — Linux is always "real" OS state**

Change import (line 6) to `import { getHostPlatform } from '../../lib/host-platform'`. Line 49: `const osUsers = platform.listAgentUserNames()` (drop the `isDarwin() ? … : new Set()`). Line 93: replace `r.home ?? (isDarwin() ? '(missing)' : '(non-darwin)')` with `r.home ?? '(missing)'`.

- [ ] **Step 5: `cleanup-orphans.ts` — keep the command, no macOS gate**

Change import (line 5) to `import { getHostPlatform } from '../../lib/host-platform'`. Delete the `if (!isDarwin()) { throw … 'macOS-only' }` block (lines 41–43). `getHostPlatform().listOrphanAgentUsers()` already returns `[]` on Linux (userdel is clean), so the command falls straight through to its existing `consola.success('No agent tombstones found …')`. Reword that message to be Linux-honest, e.g. `No agent tombstones — userdel is clean on Linux.`

- [ ] **Step 6: Typecheck + run the affected command tests**

Run: `pnpm --filter @openape/apes typecheck && pnpm --filter @openape/apes exec vitest run test/agents-destroy.test.ts test/agents-list.test.ts`
Expected: typecheck clean. Update `agents-destroy.test.ts` / `agents-list.test.ts` mocks if they relied on `isDarwin`/macos-user (point them at the `host-platform` mock with `isLinux: () => true`). Get both green.

- [ ] **Step 7: Commit**

```bash
git add packages/apes/src/commands/run.ts packages/apes/src/commands/agents/allow.ts \
  packages/apes/src/commands/agents/destroy.ts packages/apes/src/commands/agents/list.ts \
  packages/apes/src/commands/agents/cleanup-orphans.ts \
  packages/apes/test/agents-destroy.test.ts packages/apes/test/agents-list.test.ts
git commit -m "refactor(apes): resolve isDarwin branches to the linux path"
```

---

### Task 5: Delete the macOS-native modules + slim the host-platform factory

Now nothing references the macOS impls. Remove them and make `getHostPlatform()` Linux-only.

**Files:**
- Delete: `packages/apes/src/lib/macos-user.ts`, `lib/macos-host.ts`, `lib/launchd-reconcile.ts`, `lib/troop-bootstrap.ts`
- Delete: `packages/apes/src/lib/host-platform/darwin.ts`, `darwin-exec.ts`, `darwin-nest.ts`
- Delete: `packages/apes/test/troop-bootstrap.test.ts`
- Modify: `packages/apes/src/lib/host-platform/index.ts` (drop darwin import + branch; keep `isDarwin`/`isLinux` helpers? — see Step 2)
- Modify: `packages/apes/src/lib/llm-bridge.ts` (remove launchd plist exports)

- [ ] **Step 1: Confirm nothing imports the doomed modules**

Run:
```bash
cd packages/apes && grep -rn "macos-user\|macos-host\|launchd-reconcile\|troop-bootstrap\|host-platform/darwin" src test | grep -v '\.test\.ts:.*//'
```
Expected: zero hits in `src/` (Tasks 1–4 removed them all). Any straggler must be cleaned before deleting. The `darwin.ts` file imports macos-user/macos-host — that's fine, it's being deleted too.

- [ ] **Step 2: Slim `host-platform/index.ts`**

Remove `import { darwinHostPlatform } from './darwin'`. Update the factory:
```ts
export function getHostPlatform(): HostPlatform {
  if (testOverride) return testOverride
  if (isLinux()) return linuxHostPlatform
  throw new Error(`unsupported host platform: ${process.platform} — OpenApe nests are Linux-only`)
}
```
Keep `isLinux()`. Keep `isDarwin()` ONLY if something outside `packages/apes/src` still imports it; check with `grep -rn "isDarwin" .. --include=*.ts | grep -v node_modules`. If nothing does, delete `isDarwin()` too. Update the file's top comment (currently says "Currently macOS-only; the Linux impl lands in Milestone B") to describe the Linux-only reality.

- [ ] **Step 3: Remove launchd exports from `llm-bridge.ts`**

Delete `bridgePlistLabel`, `bridgePlistPath`, `buildBridgePlist`, `buildBridgeStartScript` (macOS launchd). Keep `resolveBridgeConfig`, `buildBridgeEnvFile`, `captureHostBinDirs` only if still imported anywhere (grep `captureHostBinDirs` / `buildBridgeEnvFile` across `src`); delete any that are now unused. Update `test/agents-llm-bridge.test.ts` to drop assertions on the removed exports.

- [ ] **Step 4: Delete the files**

```bash
cd packages/apes
git rm src/lib/macos-user.ts src/lib/macos-host.ts src/lib/launchd-reconcile.ts \
  src/lib/troop-bootstrap.ts src/lib/host-platform/darwin.ts \
  src/lib/host-platform/darwin-exec.ts src/lib/host-platform/darwin-nest.ts \
  test/troop-bootstrap.test.ts
```

- [ ] **Step 5: Typecheck + full test run**

Run: `pnpm --filter @openape/apes typecheck && pnpm --filter @openape/apes test`
Expected: typecheck clean; all tests green. Fix any remaining import of a deleted symbol (e.g. a stale `silent-password` import in `destroy.ts` from Task 4 Step 3 — if `silent-password.ts` is now unused, `git rm` it and its test).

- [ ] **Step 6: Lint**

Run: `pnpm --filter @openape/apes lint`
Expected: clean. Fix any unused-import / no-unused-var findings the deletions surfaced.

- [ ] **Step 7: Commit**

```bash
git add -A packages/apes
git commit -m "chore(apes): delete macOS-native agent path (linux-only)"
```

---

### Task 6: Linux-spawn integration test — the gap-closer

The M2 miss was: no test exercised "spawn on Linux end-to-end". Add a test that runs the real `buildSpawnSetupScript` output through assertions proving the script would create a Linux user and write the identity files — the unit-level proof that complements the (owner-run) E2E.

**Files:**
- Create: `packages/apes/test/agents-spawn-linux.test.ts`

- [ ] **Step 1: Write the test**

`packages/apes/test/agents-spawn-linux.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildSpawnSetupScript } from '../src/lib/agent-bootstrap.js'

// End-to-end at the script level: the bytes that `runPrivilegedBash`
// will execute on the nest. No mocks — this is the artifact that runs.
describe('linux spawn script (integration)', () => {
  const script = buildSpawnSetupScript({
    name: 'agent-x',
    homeDir: '/var/openape/homes/agent-x',
    shellPath: '/bin/bash',
    privateKeyPem: '-----BEGIN OPENSSH PRIVATE KEY-----\nKEY\n-----END OPENSSH PRIVATE KEY-----\n',
    publicKeySshLine: 'ssh-ed25519 AAAAC3Nz agent-x',
    x25519PrivateKey: 'x25519priv',
    x25519PublicKey: 'x25519pub',
    authJson: '{"idp":"https://id.openape.ai","email":"agent-x@id.openape.ai"}\n',
    claudeSettingsJson: '{"hooks":{"PreToolUse":[]}}',
    hookScriptSource: '#!/bin/bash\nexec true\n',
    claudeOauthToken: 'sk-ant-oat01-deadbeef',
  })

  it('is a bash script with strict mode', () => {
    expect(script.startsWith('#!/bin/bash\nset -euo pipefail')).toBe(true)
  })

  it('creates the parent homes dir then the user', () => {
    expect(script).toContain('mkdir -p /var/openape/homes')
    expect(script.indexOf('mkdir -p /var/openape/homes'))
      .toBeLessThan(script.indexOf('useradd --create-home'))
  })

  it('uses no macOS primitives', () => {
    for (const bad of ['dscl', 'launchctl', 'sysadminctl', 'NFSHomeDirectory', 'IsHidden', 'Library/Application Support', 'staff']) {
      expect(script).not.toContain(bad)
    }
  })

  it('writes all four identity artifacts under the agent home', () => {
    expect(script).toContain('"$HOME_DIR/.ssh/id_ed25519"')
    expect(script).toContain('"$HOME_DIR/.ssh/id_ed25519.pub"')
    expect(script).toContain('"$HOME_DIR/.config/apes/auth.json"')
    expect(script).toContain('"$HOME_DIR/.config/openape/agent-x25519.key"')
  })

  it('installs the claude token env + hook when supplied', () => {
    expect(script).toContain('claude-token.env')
    expect(script).toContain('CLAUDE_CODE_OAUTH_TOKEN=')
    expect(script).toContain('.claude/hooks/bash-via-ape-shell.sh')
  })

  it('locks the private key and auth.json to 600 and chowns to the agent', () => {
    expect(script).toContain('chmod 600 "$HOME_DIR/.ssh/id_ed25519"')
    expect(script).toContain('chmod 600 "$HOME_DIR/.config/apes/auth.json"')
    expect(script).toContain('chown -R "$NAME:" "$HOME_DIR"')
  })

  it('ends with the OK report line', () => {
    expect(script).toContain('echo "OK $NAME (linux user) uid=$NEW_UID home=$HOME_DIR"')
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @openape/apes exec vitest run test/agents-spawn-linux.test.ts`
Expected: PASS (7 tests). If "staff" or any macOS token appears, the Task 2 script still has a macOS remnant — fix it in `agent-bootstrap.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/apes/test/agents-spawn-linux.test.ts
git commit -m "test(apes): integration coverage for the linux spawn script"
```

---

### Task 7: Final gate — lint, typecheck, full suite, PR

**Files:** none (verification + PR).

- [ ] **Step 1: Whole-package gate**

Run: `pnpm --filter @openape/apes lint && pnpm --filter @openape/apes typecheck && pnpm --filter @openape/apes test`
Expected: all three clean/green.

- [ ] **Step 2: Repo-wide guard against dangling references**

Run:
```bash
grep -rn "agents spawn.*macOS\|macos-user\|troop-bootstrap\|buildDestroyTeardownScript\|isShellRegistered" packages/apes/src
```
Expected: zero hits. Any hit is a missed cleanup.

- [ ] **Step 3: Sanity-build the nest (consumes the spawn path indirectly)**

Run: `pnpm turbo run build --filter=@openape/nest`
Expected: builds clean (the nest's `Pm2Supervisor` is unchanged; this confirms no cross-package break).

- [ ] **Step 4: Push the branch and open a PR (do NOT merge)**

```bash
git push -u origin feat/linux-only-spawn
gh pr create --title "feat(apes): linux-only agent spawn" \
  --body "$(cat <<'EOF'
Replaces the macOS-native `apes agents spawn` path with a Linux `useradd`
path and removes the dead macOS modules. Closes the M2 gap where spawn was
still `isDarwin()`-gated and failed on the Docker nest.

## What changed
- `buildSpawnSetupScript` emits a `useradd`/`getent`/`install`/`chown`
  script instead of `dscl`; no launchd plists (the nest's pm2 supervisor
  forwards bridge env and supervises the agent process).
- `isDarwin()` guard removed from spawn; 16 isDarwin branches resolved to
  the Linux path across run/allow/destroy/list/cleanup-orphans.
- Deleted: macos-user, macos-host, launchd-reconcile, troop-bootstrap,
  host-platform/darwin*, macOS launchd exports in llm-bridge.
- New unit + integration tests cover the Linux spawn script (the M2 gap).

## Not in this PR (owner action)
- E2E on the real Linux Docker nest: Troop "Anlegen" → spawn-intent →
  nest `apes agents spawn` → useradd user → pm2 supervises ape-agent.
- Migrating the `mbp-home` nest from macOS-native to a Docker nest.
EOF
)"
```

- [ ] **Step 5: Report PR URL + the owner-gated E2E checklist**

Print the PR URL and remind: the branch is gate-verified (lint+typecheck+tests) but the production proof — spawning an agent end-to-end on the real Linux nest — is the owner's action because the agent cannot trigger a prod spawn. Do NOT merge automatically.

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-04-linux-only-spawn-design.md`):
- "remove isDarwin guard" → Task 3 Step 4. ✅
- "useradd via runPrivilegedBash" → Task 2 (script) + Task 3 Step 6 (wiring) + existing `runPrivilegedBashOnLinux`. ✅
- "no launchd plists" → Task 2 Step 3 (drop bridge/troop blocks) + Task 3 Step 6 (drop plist construction). ✅
- "whichBinary / isShellRegistered replace-or-drop" → Task 1 (move whichBinary) + Task 3 Step 4 (drop isShellRegistered / /etc/shells; useradd -s sets the shell). ✅
- "rip out macos-user, launchd-reconcile, macos-host, troop-bootstrap launchd builders, host-platform/darwin*" → Task 5. ✅
- "resolve 16 isDarwin branches in spawn/destroy/allow/list/cleanup-orphans + run/enroll/auth-login" → Task 3 + Task 4. **Note:** `enroll.ts` and `auth/login.ts` were named in the spec but the `grep -rln isDarwin` shows no current hits there (only run/allow/destroy/list/cleanup-orphans/spawn + the two lib files). Task 5 Step 1's repo-wide grep catches any straggler; if `enroll.ts`/`auth/login.ts` do contain an isDarwin after all, resolve them the same way (Linux path only) under Task 4.
- "host-platform collapses to Linux" → Task 5 Step 2. ✅
- "cleanup-orphans: Linux-equivalent or remove" → Task 4 Step 5 (kept as clean no-op; `listOrphanAgentUsers` already returns `[]`). ✅
- "tests close the gap (linux user-create script, registry write, host-platform linux path)" → Task 2 + Task 6; host-platform linux path already covered by `host-platform-linux.test.ts`. ✅
- "regression: nest/pm2 tests stay green" → Task 7 Step 3 builds the nest; its supervisor is untouched. ✅
- "E2E on real nest = owner action" → Task 7 Step 5. ✅

**Placeholder scan:** No TBD/TODO; every code step shows the code; every run step shows the command + expected output. ✅

**Type consistency:** `SpawnSetupScriptInput` (Task 2) drops `macOSUsername`/`bridge`/`troop`; `spawn.ts` (Task 3 Step 6) passes exactly the remaining fields; the spawn test (Task 3 Step 1) asserts the dropped fields are absent. `whichBinary` signature unchanged across the move. `getHostPlatform()`/`readAgentUser`/`agentUsername`/`listAgentUserNames`/`runPrivilegedBash` all match the `HostPlatform` interface in `host-platform/index.ts`. ✅
