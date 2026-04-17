import { mkdir, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * A single successful generic-fallback execution entry.
 * Denied, timeout, and cancelled grants are NOT logged here — they are
 * captured by the IdP's server-side audit trail.
 */
export interface GenericCallLogEntry {
  /** ISO 8601 timestamp of execution completion */
  ts: string
  /** CLI id as requested by the user (e.g. "kubectl") */
  cli: string
  /** Full argv as executed, including the executable */
  argv: string[]
  /** SHA-256 of the argv — matches the `argv:hash` selector in resource_chain */
  argv_hash: string
  /** Grant that authorized this execution */
  grant_id: string
  /** Process exit code */
  exit_code: number
  /** Wall-clock duration from grant-approval to process exit, milliseconds */
  duration_ms: number
}

/**
 * Default audit log location. Lives under `~/.config/apes/` for consistency
 * with the rest of apes' client state (`config.toml`, `auth.json`, …).
 */
export function defaultGenericLogPath(): string {
  return join(homedir(), '.config', 'apes', 'generic-calls.log')
}

/**
 * Append a single generic-call entry to the audit log in JSONL format.
 * Creates the containing directory if needed.
 *
 * @param entry     The call record to append
 * @param logPath   Optional override (usually from `config.generic.audit_log`)
 */
export async function appendGenericCallLog(
  entry: GenericCallLogEntry,
  logPath?: string,
): Promise<void> {
  const path = logPath ?? defaultGenericLogPath()
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf-8')
}
