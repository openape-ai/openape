import type { SealedBox } from '@openape/core'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { openString } from '@openape/core'

// Agent-side of the capability broker. troop seals a secret to this
// agent's X25519 pubkey (M2a/M2c); nest drops the opaque blob into
// ~/.config/openape/secrets.d/<ENV>.blob (M2d). Here the agent — the
// ONLY place plaintext exists — opens it with its private key and
// injects it into process.env so its tools (bash etc.) see it. Revoke
// = blob removed → the env var is dropped on the next materialize.
// See plans.openape.ai 01KRTAE8 (M2e).

const CONFIG_DIR = join(homedir(), '.config', 'openape')
export const SECRETS_DIR = join(CONFIG_DIR, 'secrets.d')
export const X25519_KEY_PATH = join(CONFIG_DIR, 'agent-x25519.key')
// Public half written alongside the private key at spawn (agent-bootstrap).
// Reported to troop on sync so the capability broker can seal secrets to it.
export const X25519_PUBKEY_PATH = `${X25519_KEY_PATH}.pub`

function envNameFromFile(file: string): string | null {
  if (!file.endsWith('.blob')) return null
  const env = file.slice(0, -'.blob'.length)
  return /^[A-Z][A-Z0-9_]*$/.test(env) ? env : null
}

export function readAgentEncryptionKey(keyPath = X25519_KEY_PATH): string | null {
  if (!existsSync(keyPath)) return null
  const k = readFileSync(keyPath, 'utf8').trim()
  return k.length > 0 ? k : null
}

export function readAgentEncryptionPublicKey(pubPath = X25519_PUBKEY_PATH): string | null {
  if (!existsSync(pubPath)) return null
  const k = readFileSync(pubPath, 'utf8').trim()
  return k.length > 0 ? k : null
}

export interface MaterializeOptions {
  dir?: string
  keyPath?: string
  /** Target env map (defaults to process.env). Injected in tests. */
  env?: NodeJS.ProcessEnv
  /** Env names applied by a previous materialize, to drop on revoke. */
  previouslyApplied?: Iterable<string>
  log?: (line: string) => void
}

export interface MaterializeResult {
  applied: string[]
  failed: string[]
}

/**
 * Open every sealed blob in the secrets dir and set the corresponding
 * env var. Any env that was applied before but whose blob is now gone
 * (revoke) is deleted. Best-effort per blob — a corrupt/foreign blob
 * is logged and skipped, never throws.
 */
export function materializeSecrets(opts: MaterializeOptions = {}): MaterializeResult {
  const dir = opts.dir ?? SECRETS_DIR
  const env = opts.env ?? process.env
  const log = opts.log ?? (() => {})
  const applied: string[] = []
  const failed: string[] = []

  const key = readAgentEncryptionKey(opts.keyPath)
  const files = key && existsSync(dir) ? readdirSync(dir) : []

  for (const file of files) {
    const name = envNameFromFile(file)
    if (!name) continue
    try {
      const box = JSON.parse(readFileSync(join(dir, file), 'utf8')) as SealedBox & { materializeTo?: unknown }
      const plaintext = openString(box, key!)
      const target = typeof box.materializeTo === 'string' ? box.materializeTo : null
      if (target) {
        // Seed-once: write only on first seed or a newer blob (re-verify).
        // Never clobber a file litellm refreshed in place (file > blob mtime).
        const blobMtime = statSync(join(dir, file)).mtimeMs
        if (!existsSync(target) || statSync(target).mtimeMs < blobMtime) {
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, plaintext, { mode: 0o600 })
        }
      }
      else {
        env[name] = plaintext
      }
      applied.push(name)
    }
    catch (e) {
      failed.push(file)
      log(`secrets: failed to open ${file}: ${(e as Error).message}`)
    }
  }

  // Revoke: env names we set last time but that have no blob now.
  const live = new Set(applied)
  for (const prev of opts.previouslyApplied ?? []) {
    if (!live.has(prev)) {
      delete env[prev]
      log(`secrets: revoked ${prev}`)
    }
  }

  return { applied, failed }
}

/**
 * Materialize once, then fs.watch the secrets dir and re-materialize
 * on any change (rotate/revoke take effect live — the user's M2 v1
 * choice). Returns a stop function. Safe to call when the dir doesn't
 * exist yet (watch attaches once it appears on the next agent start).
 */
export function startSecretsWatcher(opts: MaterializeOptions = {}): () => void {
  const dir = opts.dir ?? SECRETS_DIR
  const log = opts.log ?? (() => {})
  let appliedNames = new Set<string>()

  const run = () => {
    const r = materializeSecrets({ ...opts, previouslyApplied: appliedNames })
    appliedNames = new Set(r.applied)
  }

  run()
  if (!existsSync(dir)) return () => {}

  let timer: NodeJS.Timeout | null = null
  const watcher = watch(dir, () => {
    // Debounce — a single rotate is several fs events (create, write).
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, 150)
  })
  watcher.on('error', err => log(`secrets: watcher error: ${err.message}`))

  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}
