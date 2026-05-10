import { Buffer } from 'node:buffer'
import { createPrivateKey, sign } from 'node:crypto'
import { exchangeWithDelegation } from '@openape/cli-auth'
import { loadAuth } from '../config'
import { apiFetch, getAgentAuthenticateEndpoint, getAgentChallengeEndpoint } from '../http'

export const AGENT_NAME_REGEX = /^[a-z][a-z0-9-]{0,23}$/
export const SSH_ED25519_PREFIX = 'ssh-ed25519 '
export const SSH_ED25519_REGEX = /^ssh-ed25519 [A-Za-z0-9+/=]+(\s.*)?$/

const ENROLL_AUDIENCE = 'enroll-agent'

export interface RegisterAgentResponse {
  email: string
  name: string
  owner: string
  approver: string
  status: string
}

/**
 * Enrol an agent at the IdP. When the local caller is itself an
 * agent (e.g. the local Nest enrolling a child agent), we look for
 * a delegation grant from the agent's owner authorising us to act
 * for them, and exchange both tokens for a delegated access token
 * (RFC 8693). The /api/enroll endpoint then sees `sub=owner` and
 * `act={sub:caller}` and attributes ownership correctly without
 * needing a server-side transitive-ownership heuristic.
 *
 * Falls back to the direct call (caller-as-requester) when no
 * delegation is available — the IdP's transitive-ownership lookup
 * still covers that path until M3 retires it.
 */
export async function registerAgentAtIdp(input: {
  name: string
  publicKey: string
  idp?: string
}): Promise<RegisterAgentResponse> {
  const delegated = await tryDelegatedEnrollToken(input.idp)
  return await apiFetch<RegisterAgentResponse>('/api/enroll', {
    method: 'POST',
    body: { name: input.name, publicKey: input.publicKey },
    idp: input.idp,
    ...(delegated ? { headers: { Authorization: `Bearer ${delegated}` } } : {}),
  })
}

/**
 * If the caller is an agent and the owner has previously approved a
 * delegation grant (audience `enroll-agent`), exchange the agent's
 * access token + the delegation grant id for a delegated access
 * token whose `sub` is the owner.
 *
 * Lookup strategy: list active grants where requester = owner_email,
 * find the first delegation grant where delegate = us and audience is
 * `enroll-agent` or `*`. Returns null on any failure (no delegation
 * found, network error, etc.) so the caller falls back to the
 * direct-enroll path — token-exchange is an optimisation while the
 * IdP's transitive-ownership lookup still covers the gap.
 */
async function tryDelegatedEnrollToken(idp?: string): Promise<string | null> {
  try {
    const auth = loadAuth()
    if (!auth?.access_token) return null
    // Only agents need delegation. Humans always enrol on their own
    // behalf (sub=owner already).
    const claims = decodeJwtClaims(auth.access_token)
    if (claims?.act !== 'agent') return null
    const ownerEmail = (auth as { owner_email?: unknown }).owner_email
    if (typeof ownerEmail !== 'string' || !ownerEmail) return null
    const myEmail = auth.email
    if (typeof myEmail !== 'string' || !myEmail) return null

    const idpUrl = idp ?? auth.idp
    if (!idpUrl) return null

    const grantId = await findEnrollDelegationGrantId(idpUrl, ownerEmail, myEmail)
    if (!grantId) {
      // Visible signal during the rollout window so we can tell when
      // a Nest is still falling back to /api/enroll's transitive-
      // ownership heuristic (and therefore why removing that
      // heuristic would break it). Stays at debug volume so it
      // doesn't pollute the spawn flow's stdout.
      console.warn(`[agent-bootstrap] no enroll-agent delegation from ${ownerEmail} to ${myEmail} — falling back to direct enroll`)
      return null
    }

    const result = await exchangeWithDelegation({
      idp: idpUrl,
      actorToken: auth.access_token,
      audience: ENROLL_AUDIENCE,
      delegationGrantId: grantId,
    })
    console.log(`[agent-bootstrap] using delegated token from grant ${grantId} (sub=${ownerEmail}, act=${myEmail})`)
    return result.access_token
  }
  catch (err) {
    console.warn(`[agent-bootstrap] delegated-enroll exchange failed: ${err instanceof Error ? err.message : String(err)} — falling back to direct enroll`)
    return null
  }
}

interface GrantListEntry {
  id: string
  type?: string
  status?: string
  expires_at?: number
  request: {
    audience?: string
    delegate?: string
    delegator?: string
    grant_type?: string
  }
}

async function findEnrollDelegationGrantId(
  idp: string,
  delegator: string,
  delegate: string,
): Promise<string | null> {
  const url = `${idp.replace(/\/$/, '')}/api/grants?status=approved&limit=200&requester=${encodeURIComponent(delegator)}`
  // Anonymous request: the IdP allows listing one's own approved
  // grants without auth in some configurations; if it requires auth
  // and rejects, we return null and fall back. Acceptable because
  // the delegation lookup is optional.
  const res = await apiFetch<{ data: GrantListEntry[] }>(url)
  const now = Math.floor(Date.now() / 1000)
  for (const g of res.data ?? []) {
    if (g.type !== 'delegation') continue
    if (g.status !== 'approved') continue
    if (g.request.delegate !== delegate) continue
    const aud = g.request.audience
    if (aud !== '*' && aud !== ENROLL_AUDIENCE) continue
    if (g.expires_at && g.expires_at <= now) continue
    return g.id
  }
  return null
}

function decodeJwtClaims(token: string): { act?: unknown } | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const padded = part + '='.repeat((4 - part.length % 4) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as { act?: unknown }
  }
  catch {
    return null
  }
}

export interface IssuedAgentToken {
  token: string
  expiresIn: number
}

/**
 * Single-shot challenge/authenticate using a privately held PEM key.
 * Used by `spawn` after registering the agent: we already know the keypair
 * works (we just generated it), so we skip the polling loop in `enroll.ts`.
 */
export async function issueAgentToken(input: {
  idp: string
  agentEmail: string
  privateKeyPem: string
}): Promise<IssuedAgentToken> {
  const privateKey = createPrivateKey(input.privateKeyPem)

  const challengeUrl = await getAgentChallengeEndpoint(input.idp)
  const challengeResp = await fetch(challengeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: input.agentEmail }),
  })
  if (!challengeResp.ok) {
    const text = await challengeResp.text().catch(() => '')
    throw new Error(`Challenge failed (${challengeResp.status}): ${text}`)
  }
  const { challenge } = await challengeResp.json() as { challenge: string }

  const signature = sign(null, Buffer.from(challenge), privateKey).toString('base64')

  const authenticateUrl = await getAgentAuthenticateEndpoint(input.idp)
  const authResp = await fetch(authenticateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: input.agentEmail, challenge, signature }),
  })
  if (!authResp.ok) {
    const text = await authResp.text().catch(() => '')
    throw new Error(`Authenticate failed (${authResp.status}): ${text}`)
  }
  const result = await authResp.json() as { token: string, expires_in: number }
  return { token: result.token, expiresIn: result.expires_in || 3600 }
}

export interface SpawnSetupScriptInput {
  name: string
  homeDir: string
  shellPath: string
  privateKeyPem: string
  publicKeySshLine: string
  authJson: string
  claudeSettingsJson: string | null
  hookScriptSource: string | null
  /**
   * Long-lived Claude Code OAuth token (`sk-ant-oat01-…`) obtained via
   * `claude setup-token`. When provided, gets written to a chmod 600 env
   * file under the agent's HOME and sourced from .zshenv + .profile so
   * `claude -p "…"` works immediately without interactive auth.
   * `null` means the agent has no Claude credential — `claude` will
   * prompt for auth on first run inside that user.
   */
  claudeOauthToken: string | null
  /**
   * If set, also installs the ape-agent runtime for this agent:
   * drops a launchd plist + start script + .env with the LLM proxy master
   * key. The runtime expects `@openape/ape-agent` to already be installed
   * globally on the host. `null` skips the bridge entirely (current default).
   */
  bridge: SpawnBridgeFiles | null
  /**
   * Troop sync launchd plist. Always set for spawn-via-troop; passed
   * as null only by tests that exercise the legacy path. Drops the
   * plist into ~/Library/LaunchAgents/ and bootstraps it.
   */
  troop: SpawnTroopFiles | null
}

export interface SpawnBridgeFiles {
  /** Plist label, e.g. `eco.hofmann.apes.bridge.<agent>` (must be unique). */
  plistLabel: string
  /** Absolute path of the plist file (under /Library/LaunchDaemons/). */
  plistPath: string
  /** XML plist content (full file). */
  plistContent: string
  /** start.sh content (idempotent installer + exec). */
  startScript: string
  /** .env content (`LITELLM_BASE_URL` + `LITELLM_API_KEY`). */
  envFile: string
}

const SH_HEREDOC_DELIMITER = 'APES_HEREDOC_END'

function shHeredoc(content: string): string {
  if (content.includes(SH_HEREDOC_DELIMITER)) {
    throw new Error(`Refusing to emit heredoc: content contains ${SH_HEREDOC_DELIMITER}`)
  }
  return `<< '${SH_HEREDOC_DELIMITER}'\n${content}\n${SH_HEREDOC_DELIMITER}`
}

export function buildSpawnSetupScript(input: SpawnSetupScriptInput): string {
  const { name, homeDir, shellPath } = input

  // Trailing newline on PEM keeps OpenSSL happy. JSON files we write as-is.
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

  // Claude Code OAuth token: write to a chmod 600 env file under
  // ~/.config/openape/, source it from both .zshenv (zsh always loads,
  // including non-interactive) and .profile (bash login shells, what
  // `escapes` ends up exec'ing through). Keeping the actual token in
  // one place means rotation = edit one file, no shell-rc grep needed.
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

# escapes-spawned scripts inherit a minimal PATH that doesn't include
# /usr/sbin — which is where chown / dscl / pwpolicy live. Force a
# wide PATH so the privileged setup commands resolve without absolute
# paths everywhere.
export PATH="/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin:/usr/local/bin"

NAME=${shQuote(name)}
HOME_DIR=${shQuote(homeDir)}
SHELL_PATH=${shQuote(shellPath)}

if dscl . -read "/Users/$NAME" >/dev/null 2>&1; then
  echo "User $NAME already exists; refusing to overwrite." >&2
  exit 1
fi

# Phase G: agent home dirs live under /var/openape/homes/, not
# /Users/. Pre-create the parent and chmod it world-traversable
# so per-agent dirs can be reached by their respective uids.
mkdir -p /var/openape/homes
chmod 755 /var/openape/homes

# Pick the next free UID in the [200, 500) hidden service-account range.
# Starts the running max at 199 so an empty range yields 200 after the
# floor check; otherwise NEXT_UID = max(existing in-range UIDs) + 1.
NEXT_UID=199
for uid in $(dscl . -list /Users UniqueID | awk '$2 >= 200 && $2 < 500 {print $2}'); do
  if [ "$uid" -ge "$NEXT_UID" ]; then
    NEXT_UID=$((uid + 1))
  fi
done
if [ "$NEXT_UID" -lt 200 ]; then
  NEXT_UID=200
fi
if [ "$NEXT_UID" -ge 500 ]; then
  echo "No free UID in [200, 500) — refusing to clobber a real user." >&2
  exit 1
fi

dscl . -create "/Users/$NAME"
dscl . -create "/Users/$NAME" UserShell "$SHELL_PATH"
dscl . -create "/Users/$NAME" RealName "OpenApe Agent $NAME"
dscl . -create "/Users/$NAME" UniqueID "$NEXT_UID"
dscl . -create "/Users/$NAME" PrimaryGroupID 20
dscl . -create "/Users/$NAME" NFSHomeDirectory "$HOME_DIR"
dscl . -create "/Users/$NAME" IsHidden 1

mkdir -p "$HOME_DIR/.ssh" "$HOME_DIR/.config/apes"

cat > "$HOME_DIR/.ssh/id_ed25519" ${shHeredoc(privatePemForHeredoc.trimEnd())}
cat > "$HOME_DIR/.ssh/id_ed25519.pub" ${shHeredoc(`${input.publicKeySshLine}`)}
cat > "$HOME_DIR/.config/apes/auth.json" ${shHeredoc(input.authJson)}
${claudeBlock}${claudeTokenBlock}${buildBridgeBlock(input.bridge)}${buildTroopBlock(input.troop)}
chown -R "$NAME:staff" "$HOME_DIR"
chmod 700 "$HOME_DIR/.ssh"
chmod 700 "$HOME_DIR/.config"
chmod 600 "$HOME_DIR/.ssh/id_ed25519"
chmod 644 "$HOME_DIR/.ssh/id_ed25519.pub"
chmod 600 "$HOME_DIR/.config/apes/auth.json"
if [ -f "$HOME_DIR/.config/openape/claude-token.env" ]; then
  chmod 700 "$HOME_DIR/.config/openape"
  chmod 600 "$HOME_DIR/.config/openape/claude-token.env"
fi

echo "OK $NAME uid=$NEXT_UID home=$HOME_DIR"
${buildBridgeBootstrapBlock(input.bridge, name)}${buildTroopBootstrapBlock(input.troop, name)}`
}

function buildBridgeBlock(bridge: SpawnBridgeFiles | null): string {
  if (!bridge) return ''
  // Phase B (#sim-arch): no per-agent system-domain bridge plist
  // anymore. The Nest's in-process supervisor owns bridge lifecycle
  // (`apps/openape-nest/src/lib/supervisor.ts`). We still drop the
  // bridge .env into the agent home so the bridge's
  // resolveBridgeConfig finds it at runtime — same path the
  // supervisor's child process uses. start.sh is no longer needed
  // (the supervisor invokes ape-agent directly via
  // \`apes run --as <agent>\`), and the system-domain plist is no
  // longer written.
  return `
mkdir -p "$HOME_DIR/Library/Application Support/openape/bridge" "$HOME_DIR/Library/Logs"
cat > "$HOME_DIR/Library/Application Support/openape/bridge/.env" ${shHeredoc(bridge.envFile)}
chmod 600 "$HOME_DIR/Library/Application Support/openape/bridge/.env"
`
}

function buildBridgeBootstrapBlock(_bridge: SpawnBridgeFiles | null, _name: string): string {
  // Phase B: no launchd plist to bootstrap — Nest supervisor takes
  // over at the next /agents POST handler reconcile. Caller (the
  // Nest's POST /agents handler) calls supervisor.reconcile(...)
  // after the spawn succeeds.
  return ''
}

export interface SpawnTroopFiles {
  /** Plist label, e.g. `openape.troop.sync.<agent>`. */
  plistLabel: string
  /** Absolute path under $HOME/Library/LaunchAgents/. */
  plistPath: string
  /** Full plist XML content. */
  plistContent: string
}

/**
 * Troop sync launchd plist — installed for every spawned agent.
 * Drops `~/Library/LaunchAgents/openape.troop.sync.<agent>.plist`,
 * bootstraps it into the agent's user-domain (gui/<uid>), then runs
 * `apes agents sync` once eagerly so the agent appears at the troop
 * SP within seconds rather than waiting a full sync interval.
 */
function buildTroopBlock(_troop: SpawnTroopFiles | null): string {
  // Phase C (#sim-arch): no per-agent troop-sync plist anymore. The
  // Nest's centralised TroopSync loop walks the registry every 5 min
  // and runs `apes agents sync` for each agent (see
  // apps/openape-nest/src/lib/troop-sync.ts). We still create the
  // agent-side dirs that `apes agents sync` writes to.
  return `
mkdir -p "$HOME_DIR/Library/Logs" "$HOME_DIR/.openape/agent/tasks"
`
}

function buildTroopBootstrapBlock(_troop: SpawnTroopFiles | null, _name: string): string {
  // Phase C: no system-domain plist to bootstrap. The Nest's
  // centralised troop-sync loop will pick the new agent up at the
  // next tick (≤5 min after spawn).
  return ''
}

export interface DestroyTeardownScriptInput {
  name: string
  homeDir: string
  adminUser: string
}

/**
 * Phase G teardown — for agents whose home is under /var/openape/homes/.
 * Skips sysadminctl + admin-password because:
 *   1. The home dir is on /var/, not FDA-protected → root can rm.
 *   2. We accept leaving the dscl user record as a tombstone
 *      (hidden, IsHidden=1, no home, no processes) — opendirectoryd
 *      refuses dscl . -delete from escapes' setuid-root context
 *      without admin auth, but the tombstone is harmless.
 * Result: fully scriptable destroy without an interactive admin
 * password prompt.
 */
export function buildPhaseGTeardownScript(input: { name: string, homeDir: string }): string {
  const { name, homeDir } = input
  return `#!/bin/bash
set -u

NAME=${shQuote(name)}
HOME_DIR=${shQuote(homeDir)}

UID_OF=$(dscl . -read "/Users/$NAME" UniqueID 2>/dev/null | awk '/UniqueID:/ {print $2}')

if [ -n "$UID_OF" ]; then
  launchctl bootout "user/$UID_OF" 2>/dev/null || true
  pkill -9 -u "$UID_OF" 2>/dev/null || true
fi

# Per-agent ecosystem files written by the Nest's pm2-supervisor.
rm -rf "/var/openape/agents/$NAME"

# Home dir lives under /var/openape/homes/ — no FDA wall, root can
# remove directly.
if [ -d "$HOME_DIR" ] && [ "$HOME_DIR" != "/" ] && [ "$HOME_DIR" != "" ]; then
  rm -rf "$HOME_DIR"
fi

# dscl record stays as a tombstone. Operators run
# \`sudo sysadminctl -deleteUser $NAME\` to fully clean up if desired.
echo "OK Phase-G teardown done for $NAME (dscl record kept as tombstone)"
`
}

export function buildDestroyTeardownScript(input: DestroyTeardownScriptInput): string {
  const { name, homeDir, adminUser } = input
  return `#!/bin/bash
# Best-effort teardown. set -u catches typos; we deliberately do NOT use -e
# because pkill / launchctl are allowed to fail when the user has no live
# sessions.
set -u

NAME=${shQuote(name)}
HOME_DIR=${shQuote(homeDir)}
ADMIN_USER=${shQuote(adminUser)}

# Read the admin password from stdin (line 1). The caller pipes it in.
# We never accept it as an argv element so it can't show up in process
# listings or escapes' audit log.
read -r ADMIN_PASSWORD
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "ERROR: no admin password on stdin (expected one line)." >&2
  exit 2
fi

UID_OF=$(dscl . -read "/Users/$NAME" UniqueID 2>/dev/null | awk '/UniqueID:/ {print $2}')

if [ -n "$UID_OF" ]; then
  launchctl bootout "user/$UID_OF" 2>/dev/null || true
  pkill -9 -u "$UID_OF" 2>/dev/null || true
fi

# Per-agent system LaunchDaemon written by spawn --bridge. Bootout +
# delete must come BEFORE we delete the user, otherwise launchd keeps a
# zombie reference. No-op if the plist isn't there.
BRIDGE_LABEL="eco.hofmann.apes.bridge.$NAME"
BRIDGE_PLIST="/Library/LaunchDaemons/$BRIDGE_LABEL.plist"
if [ -f "$BRIDGE_PLIST" ]; then
  launchctl bootout "system/$BRIDGE_LABEL" 2>/dev/null || true
  rm -f "$BRIDGE_PLIST"
fi

if [ -d "$HOME_DIR" ] && [ "$HOME_DIR" != "/" ] && [ "$HOME_DIR" != "" ]; then
  rm -rf "$HOME_DIR"
fi

# \`escapes\` is a plain setuid binary — opendirectoryd sees no audit/PAM
# session attached (AUDIT_SESSION_ID=unset) and rejects DirectoryService
# writes from this context: a bare \`sysadminctl -deleteUser\` or
# \`dscl . -delete\` hangs ~5 minutes and exits with eUndefinedError -14987
# at DSRecord.m:563. Passing explicit -adminUser/-adminPassword bypasses
# opendirectoryd's implicit "is current session admin?" check and
# authenticates against DirectoryService directly — the delete then
# completes in ~1 second.
if ! command -v sysadminctl >/dev/null 2>&1; then
  echo "ERROR: sysadminctl not available; cannot delete user record." >&2
  exit 1
fi

sysadminctl \\
  -deleteUser "$NAME" \\
  -adminUser "$ADMIN_USER" \\
  -adminPassword "$ADMIN_PASSWORD"
SYSAD_EC=$?
unset ADMIN_PASSWORD

if [ $SYSAD_EC -ne 0 ]; then
  echo "ERROR: sysadminctl -deleteUser failed (exit=$SYSAD_EC)." >&2
  echo "       Common causes: wrong admin password, admin user '$ADMIN_USER'" >&2
  echo "       not in admin group, or target user '$NAME' is the last secure" >&2
  echo "       token holder (run \\\`sysadminctl -secureTokenStatus $NAME\\\`)." >&2
  exit 1
fi

# Verify the record is actually gone.
if dscl . -read "/Users/$NAME" >/dev/null 2>&1; then
  echo "ERROR: user record /Users/$NAME still exists after teardown" >&2
  exit 1
fi

echo "OK destroyed $NAME"
`
}

/**
 * Quote a string for safe use as a single bash argument.
 * Wraps in single quotes and escapes embedded single quotes.
 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export interface AuthJsonInput {
  idp: string
  accessToken: string
  email: string
  expiresAt: number
  /**
   * Absolute path to the agent's Ed25519 private key on its own home
   * directory. Lets `@openape/cli-auth` refresh the access token in
   * process via challenge-response — see #259. Spawn writes the key
   * to `${homeDir}/.ssh/id_ed25519` so the path is deterministic.
   */
  keyPath: string
  /**
   * Email of the human owner who spawned this agent. Persisted so the
   * bridge daemon can (a) send the initial contact request to the right
   * person and (b) seed its allowlist with the only peer it should
   * trust by default. Other peers go through `apes agents allow`.
   */
  ownerEmail: string
}

export function buildAgentAuthJson(input: AuthJsonInput): string {
  return `${JSON.stringify({
    idp: input.idp,
    access_token: input.accessToken,
    email: input.email,
    expires_at: input.expiresAt,
    key_path: input.keyPath,
    owner_email: input.ownerEmail,
  }, null, 2)}\n`
}

export const CLAUDE_SETTINGS_JSON: string = `${JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          { type: 'command', command: '$HOME/.claude/hooks/bash-via-ape-shell.sh' },
        ],
      },
    ],
  },
}, null, 2)}\n`

/**
 * Inlined source of `packages/apes/scripts/bash-via-ape-shell.sh`.
 * Kept identical to the .sh file via the bundled-hook-source.test.ts
 * drift check; resolving the file at runtime is unreliable across
 * dev/built/installed layouts, so we embed once at build time.
 */
export const BASH_VIA_APE_SHELL_HOOK_SOURCE = `#!/bin/bash
# PreToolUse hook for the Bash tool: rewrite the tool input so the
# original command runs via \`ape-shell -c <cmd>\`. That re-routes every
# Bash invocation through the apes grant flow, so the agent cannot
# execute shell commands without an approved grant.
exec python3 -c '
import json, shlex, sys
data = json.load(sys.stdin)
cmd = data["tool_input"]["command"]
wrapped = "ape-shell -c " + shlex.quote(cmd)
out = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "updatedToolInput": {"command": wrapped}}}
print(json.dumps(out))
'
`
