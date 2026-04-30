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
${claudeBlock}
chown -R "$NAME:staff" "$HOME_DIR"
chmod 700 "$HOME_DIR/.ssh"
chmod 700 "$HOME_DIR/.config"
chmod 600 "$HOME_DIR/.ssh/id_ed25519"
chmod 644 "$HOME_DIR/.ssh/id_ed25519.pub"
chmod 600 "$HOME_DIR/.config/apes/auth.json"

echo "OK $NAME uid=$NEXT_UID home=$HOME_DIR"
`
}

export interface DestroyTeardownScriptInput {
  name: string
  homeDir: string
}

export function buildDestroyTeardownScript(input: DestroyTeardownScriptInput): string {
  const { name, homeDir } = input
  return `#!/bin/bash
# Best-effort teardown. set -u catches typos; we deliberately do NOT use -e
# because pkill / launchctl are allowed to fail when the user has no live
# sessions, and dscl -delete is allowed to fail when the user is already gone.
set -u

NAME=${shQuote(name)}
HOME_DIR=${shQuote(homeDir)}

UID_OF=$(dscl . -read "/Users/$NAME" UniqueID 2>/dev/null | awk '/UniqueID:/ {print $2}')

if [ -n "$UID_OF" ]; then
  launchctl bootout "user/$UID_OF" 2>/dev/null || true
  pkill -9 -u "$UID_OF" 2>/dev/null || true
fi

if [ -d "$HOME_DIR" ] && [ "$HOME_DIR" != "/" ] && [ "$HOME_DIR" != "" ]; then
  rm -rf "$HOME_DIR"
fi

dscl . -delete "/Users/$NAME" 2>/dev/null || true

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
}

export function buildAgentAuthJson(input: AuthJsonInput): string {
  return `${JSON.stringify({
    idp: input.idp,
    access_token: input.accessToken,
    email: input.email,
    expires_at: input.expiresAt,
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
