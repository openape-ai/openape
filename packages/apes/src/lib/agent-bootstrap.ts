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
    // Canonical /api/auth/challenge expects `id` (M3). The legacy
    // /api/agent/challenge field was `agent_id`; discovery now resolves
    // the canonical endpoint, so the payload must use `id` to match.
    body: JSON.stringify({ id: input.agentEmail }),
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
    // Canonical /api/auth/authenticate expects `id` (same M3 rename).
    body: JSON.stringify({ id: input.agentEmail, challenge, signature }),
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
  /** Absolute home dir, under /var/lib/openape/homes/<name>. */
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

const SH_HEREDOC_DELIMITER = 'APES_HEREDOC_END'

function shHeredoc(content: string): string {
  if (content.includes(SH_HEREDOC_DELIMITER)) {
    throw new Error(`Refusing to emit heredoc: content contains ${SH_HEREDOC_DELIMITER}`)
  }
  return `<< '${SH_HEREDOC_DELIMITER}'\n${content}\n${SH_HEREDOC_DELIMITER}`
}

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

# Agent homes live under /var/lib/openape/homes/ (the persisted
# openape-homes volume) — out of /home/ where real operator accounts
# live. useradd --create-home makes the leaf dir but not missing
# parents; the volume mount provides the parent, but pre-create it
# anyway so a bare-metal/non-volume run still works.
mkdir -p /var/lib/openape/homes
chmod 755 /var/lib/openape/homes

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
