// nest is a blind relay for capability secrets. troop pushes a
// `secret-update` frame carrying an opaque sealed blob (M2c); nest
// drops it verbatim into the agent's own home as the agent user and
// never opens it. `secret-revoke` removes it. The agent runtime (M2e)
// watches the dir, opens the blob with its X25519 private key, and
// writes its .env. See plans.openape.ai 01KRTAE8 (M2d).

export const SECRETS_REL_DIR = '.config/openape/secrets.d'

// troop already enforces this (validateEnvName); re-checked here so a
// malformed env can never reach the shell script below.
const ENV_RE = /^[A-Z][A-Z0-9_]*$/

/**
 * Derive the local agent slug from a DDISA agent email
 * (`<name>-<hash>+<owner-local>+<owner-domain>@<idp>`). Same convention
 * the config-update path uses.
 */
export function agentNameFromEmail(email: string): string | null {
  const local = email.split('+')[0]
  if (!local) return null
  const dash = local.lastIndexOf('-')
  return dash > 0 ? local.slice(0, dash) : local
}

export type RelayPlan
  = | { ok: true, script: string }
    | { ok: false, reason: string }

/**
 * Shell script (run via `apes run --as <agent> -- sh -c <script>`) that
 * writes the blob from stdin into the agent's secrets dir with mode 600.
 * The env name is strictly validated so it is safe to interpolate into
 * the path; the blob never touches argv (stdin only — not in the
 * process list, and nest never parses it).
 */
export function planSecretWrite(env: string): RelayPlan {
  if (!ENV_RE.test(env)) return { ok: false, reason: `invalid env name: ${env}` }
  const path = `"$HOME/${SECRETS_REL_DIR}/${env}.blob"`
  return {
    ok: true,
    script: `mkdir -p "$HOME/${SECRETS_REL_DIR}" && chmod 700 "$HOME/${SECRETS_REL_DIR}" && umask 077 && cat > ${path}`,
  }
}

export function planSecretRevoke(env: string): RelayPlan {
  if (!ENV_RE.test(env)) return { ok: false, reason: `invalid env name: ${env}` }
  return { ok: true, script: `rm -f "$HOME/${SECRETS_REL_DIR}/${env}.blob"` }
}
