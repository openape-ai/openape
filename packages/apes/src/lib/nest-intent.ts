// Client-side intent-channel — replaces the HTTP fetch flow with a
// directory drop. The Nest is a long-running CLIENT in Phase D
// (#sim-arch); it polls `~/intents/<uuid>.json` for control commands
// and writes `<uuid>.response` back. We write the intent + poll for
// the response.
//
// The `~/intents/` path resolves against the Nest's HOME (the service
// user's home dir, e.g. `/var/openape/nest/intents/`). Since the dir
// is mode 770 group=_openape_nest, only Patrick (in that group) and
// the Nest itself can drop intents — same trust model the localhost
// HTTP+DDISA layer used to enforce, just at filesystem level.

import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CliError } from '../errors'

const POLL_INTERVAL_MS = 200
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000 // 5 min — covers the slowest spawn

/** Resolve the Nest's intent dir. */
export function resolveIntentDir(): string {
  // Override knob for test setups + non-default Nest installs.
  if (process.env.OPENAPE_NEST_INTENT_DIR) return process.env.OPENAPE_NEST_INTENT_DIR
  // Default: the post-migrate-to-service-user layout.
  if (existsSync('/var/openape/nest/intents')) return '/var/openape/nest/intents'
  // Fallback: the pre-migration user-domain Nest, with HOME = ~/.openape/nest.
  return join(homedir(), '.openape', 'nest', 'intents')
}

interface IntentResponse<T> {
  ok: true
  result: T
}
interface IntentError {
  ok: false
  error: string
}

/** Drop an intent file, poll for the response file, return the parsed result. */
export async function dispatchIntent<T>(
  intent: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const id = randomUUID()
  const dir = resolveIntentDir()
  if (!existsSync(dir)) {
    throw new CliError(`Nest intent dir does not exist: ${dir}\n  Is the nest daemon running? Try \`ps aux | grep openape-nest\`.`)
  }
  const intentPath = join(dir, `${id}.json`)
  const responsePath = join(dir, `${id}.response`)

  // Atomic write: tmp + rename keeps the Nest from picking up a
  // half-written intent.
  const tmpPath = `${intentPath}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify({ id, ...intent })}\n`, { mode: 0o660 })
  try {
    // Use rename within same filesystem to be atomic
    const fs = await import('node:fs')
    fs.renameSync(tmpPath, intentPath)
  }
  catch (err) {
    try { unlinkSync(tmpPath) }
    catch { /* gone */ }
    throw err
  }

  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  while (Date.now() < deadline) {
    if (existsSync(responsePath)) {
      // Wait one more poll-tick to ensure the rename completed (the
      // Nest writes .response.tmp then renames; if we read mid-rename
      // we may get an empty file).
      let raw: string
      try {
        // Settle: if statSync's mtime is from THIS turn, give it 50ms
        const st = statSync(responsePath)
        if (Date.now() - st.mtimeMs < 50) {
          await sleep(50)
        }
        raw = readFileSync(responsePath, 'utf8')
      }
      catch {
        await sleep(POLL_INTERVAL_MS)
        continue
      }
      try { unlinkSync(responsePath) }
      catch { /* gone */ }
      let parsed: IntentResponse<T> | IntentError
      try { parsed = JSON.parse(raw) as IntentResponse<T> | IntentError }
      catch (err) {
        throw new CliError(`malformed nest response: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (!parsed.ok) {
        throw new CliError(`nest: ${parsed.error}`)
      }
      return parsed.result
    }
    await sleep(POLL_INTERVAL_MS)
  }

  // Timeout — clean up our intent file so the Nest doesn't run a
  // stale request later.
  try { unlinkSync(intentPath) }
  catch { /* gone — Nest may have already picked it up */ }
  throw new CliError(`nest intent timeout (${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s) — Nest daemon may not be running or is stuck.`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Best-effort: ensure the intent dir is writable by us. Mainly for
 *  better error messages on first invocation. */
export function ensureIntentDirAccessible(): void {
  const dir = resolveIntentDir()
  try { mkdirSync(dir, { recursive: true }) }
  catch { /* may exist with different ownership; readdir below catches the real issue */ }
}
