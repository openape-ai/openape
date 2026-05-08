import { Buffer } from 'node:buffer'
import { createPrivateKey, sign } from 'node:crypto'
import { apiFetch, getAgentAuthenticateEndpoint, getAgentChallengeEndpoint } from '../http'

export const AGENT_NAME_REGEX = /^[a-z][a-z0-9-]{0,23}$/
export const SSH_ED25519_PREFIX = 'ssh-ed25519 '
export const SSH_ED25519_REGEX = /^ssh-ed25519 [A-Za-z0-9+/=]+(\s.*)?$/

export interface RegisterAgentResponse {
  email: string
  name: string
  owner: string
  approver: string
  status: string
}

export async function registerAgentAtIdp(input: {
  name: string
  publicKey: string
  idp?: string
}): Promise<RegisterAgentResponse> {
  return await apiFetch<RegisterAgentResponse>('/api/enroll', {
    method: 'POST',
    body: { name: input.name, publicKey: input.publicKey },
    idp: input.idp,
  })
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
   * If set, also installs the openape-chat-bridge daemon for this agent:
   * drops a launchd plist + start script + .env with the LLM proxy master
   * key. The bridge auto-installs `@openape/chat-bridge` via bun on first
   * boot. `null` skips the bridge entirely (current default).
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

NAME=${shQuote(name)}
HOME_DIR=${shQuote(homeDir)}
SHELL_PATH=${shQuote(shellPath)}

if dscl . -read "/Users/$NAME" >/dev/null 2>&1; then
  echo "User $NAME already exists; refusing to overwrite." >&2
  exit 1
fi

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
  // Plist lives in /Library/LaunchDaemons (system-wide), agent-owned files
  // live in $HOME. Daemons need root-owned plists; the start.sh + .env are
  // chowned to the agent below by the existing chown -R block.
  //
  // M6 dropped the `~/.pi/agent/.env` write — chat-bridge gets its
  // LiteLLM env from the start.sh that M8 will rewrite to spawn
  // `apes agents serve --rpc` instead of pi.
  return `
mkdir -p "$HOME_DIR/Library/Application Support/openape/bridge" "$HOME_DIR/Library/Logs"
cat > "$HOME_DIR/Library/Application Support/openape/bridge/.env" ${shHeredoc(bridge.envFile)}
cat > "$HOME_DIR/Library/Application Support/openape/bridge/start.sh" ${shHeredoc(bridge.startScript)}
chmod 755 "$HOME_DIR/Library/Application Support/openape/bridge/start.sh"
chmod 600 "$HOME_DIR/Library/Application Support/openape/bridge/.env"

# System-wide LaunchDaemon — root-owned, mode 644 (launchd refuses
# group/world-writable plists). UserName in the plist makes launchd run
# the binary as the agent, not root.
cat > ${shQuote(bridge.plistPath)} ${shHeredoc(bridge.plistContent)}
chown root:wheel ${shQuote(bridge.plistPath)}
chmod 644 ${shQuote(bridge.plistPath)}
`
}

function buildBridgeBootstrapBlock(bridge: SpawnBridgeFiles | null, name: string): string {
  if (!bridge) return ''
  // Install the bridge stack ONCE here, as the agent user, while the human
  // is already waiting for the spawn grant. With M6 the dependency tree
  // dropped pi-coding-agent — chat-bridge spawns `apes agents serve --rpc`
  // (M8) so the apes binary is the only runtime peer it needs.
  //
  // Then bootstrap the launchd job.
  //
  // The literal agent name is interpolated at TS-template time (not via
  // the bash $NAME var) because the inner `su -c '...'` runs in a fresh
  // shell that doesn't inherit setup.sh's NAME — `set -u` would crash on
  // the first $NAME reference inside the single-quoted block.
  return `
echo "==> Installing bridge stack as ${name} via bun (one-time)…"
su - ${shQuote(name)} -c '
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.bun/install/global/bin"
bun add -g @openape/chat-bridge @openape/apes
'

# Bootstrap into the system domain. Spawn already runs as root via
# \`apes run --as root\`, so we have permission. Stale label is bootouted
# first to make re-spawn idempotent.
launchctl bootout "system/${bridge.plistLabel}" 2>/dev/null || true
launchctl bootstrap system ${shQuote(bridge.plistPath)} || \\
  echo "warn: bridge bootstrap into system domain failed; check ${bridge.plistPath}"
`
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
function buildTroopBlock(troop: SpawnTroopFiles | null): string {
  if (!troop) return ''
  return `
mkdir -p "$HOME_DIR/Library/LaunchAgents" "$HOME_DIR/Library/Logs" "$HOME_DIR/.openape/agent/tasks"
cat > ${shQuote(troop.plistPath)} ${shHeredoc(troop.plistContent)}
chmod 644 ${shQuote(troop.plistPath)}
`
}

function buildTroopBootstrapBlock(troop: SpawnTroopFiles | null, name: string): string {
  if (!troop) return ''
  // Hidden service-accounts (IsHidden=1) never log in, so their `gui/<uid>`
  // launchd domain doesn't exist on a freshly-spawned user — `launchctl
  // bootstrap gui/<uid>` would fail with "Domain does not support specified
  // action". `launchctl asuser <uid>` (run as root) bootstraps launchd for
  // that uid first, then the inner bootstrap runs in the now-existing
  // domain. Agent name is interpolated at TS template time so the warn
  // message survives `set -u` in the inner shell.
  return `
# Bootstrap the troop sync launchd into the agent's user domain so it
# starts firing every 5 minutes. RunAtLoad in the plist also kicks off
# an immediate first sync so the agent registers + appears in the troop
# SP within seconds of spawn finishing.
echo "==> Installing troop sync launchd as ${name}…"
NAME_UID="$(id -u ${shQuote(name)})"
launchctl asuser "$NAME_UID" launchctl bootout "gui/$NAME_UID/${troop.plistLabel}" 2>/dev/null || true
launchctl asuser "$NAME_UID" launchctl bootstrap "gui/$NAME_UID" ${shQuote(troop.plistPath)} || \\
  echo "warn: troop sync bootstrap failed; run \\\`apes agents sync\\\` manually as ${name} to register at troop.openape.ai"
`
}

export interface DestroyTeardownScriptInput {
  name: string
  homeDir: string
  adminUser: string
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
