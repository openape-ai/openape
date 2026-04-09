import { basename } from 'node:path'
import consola from 'consola'
import { parse as shellParse } from 'shell-quote'
import { loadAdapter, tryLoadAdapter } from './adapters.js'
import { installAdapter } from './installer.js'
import { fetchRegistry, findAdapter } from './registry.js'
import { appendAuditLog } from './audit.js'
import type { LoadedAdapter } from './types.js'

/** A parsed shell command string with the executable and its argv extracted. */
export interface ParsedShellCommand {
  /** The program to run (first token, e.g. "rm") */
  executable: string
  /** Remaining tokens after the executable (e.g. ["-f", "/tmp/foo.txt"]) */
  argv: string[]
  /**
   * true if the command contains compound operators (&&, ||, ;, |),
   * subshells ($(...)), or backticks. These cannot be safely handled
   * by the adapter mode and must fall back to the generic shell grant flow.
   */
  isCompound: boolean
  /** The original command string for display/logging */
  raw: string
}

const COMPOUND_OPERATORS = new Set(['&&', '||', ';', '|', '&', '>', '>>', '<'])

type ShellQuoteToken = string | { op: string } | { comment: string } | { pattern: string }

/**
 * Parse a shell command string like `rm /tmp/foo.txt` or `git commit -m "hello"` into
 * its executable and argv. Uses `shell-quote` to handle quoting correctly.
 *
 * Returns null for empty/whitespace-only input.
 */
export function parseShellCommand(raw: string): ParsedShellCommand | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  let tokens: ShellQuoteToken[]
  try {
    tokens = shellParse(trimmed) as ShellQuoteToken[]
  }
  catch {
    return null
  }

  // Detect compound operators and subshells
  const hasShellExpansion = /\$\(|`/.test(trimmed)
  const hasOperatorToken = tokens.some(t => typeof t === 'object' && t !== null && 'op' in t && COMPOUND_OPERATORS.has(t.op))
  const isCompound = hasShellExpansion || hasOperatorToken

  // Extract leading string tokens up to the first operator object
  const stringTokens: string[] = []
  for (const t of tokens) {
    if (typeof t === 'string') {
      stringTokens.push(t)
    }
    else {
      break
    }
  }

  if (stringTokens.length === 0) return null

  return {
    executable: stringTokens[0]!,
    argv: stringTokens.slice(1),
    isCompound,
    raw: trimmed,
  }
}

/**
 * Extract the command string from an `apes run --shell -- bash -c "…"` argv.
 * Returns null if the argv does not follow that shape.
 */
export function extractShellCommandString(command: string[]): string | null {
  if (command.length < 3) return null
  if (command[0] !== 'bash' && command[0] !== 'sh') return null
  if (command[1] !== '-c') return null
  // Everything after `-c` is the quoted command string
  return command.slice(2).join(' ')
}

/**
 * Load an adapter for the given CLI id. If the adapter is not installed locally,
 * try to fetch it from the shapes registry and auto-install it.
 *
 * Returns null when no adapter exists in either location, or when any step fails.
 * Failures are logged but never thrown — callers should fall back to the generic flow.
 */
export async function loadOrInstallAdapter(cliId: string): Promise<LoadedAdapter | null> {
  // Absolute or relative paths like `/usr/local/bin/o365-cli` must be reduced
  // to the binary name before any lookup — neither the local file scan nor the
  // registry knows how to match a path.
  const lookupId = basename(cliId)

  // 1. Try local
  const local = tryLoadAdapter(lookupId)
  if (local) return local

  // 2. Remote registry lookup + auto-install.
  // findAdapter matches both `id` and `executable`, so a bare binary name
  // like `o365-cli` resolves to a registry entry whose id is `o365`.
  try {
    const index = await fetchRegistry()
    const entry = findAdapter(index, lookupId)
    if (!entry) return null

    consola.info(`Installing shapes adapter for ${entry.id} from registry...`)
    await installAdapter(entry, { local: false })
    appendAuditLog({
      action: 'adapter-auto-install',
      cli_id: entry.id,
      digest: entry.digest,
      source: 'ape-shell',
    })

    // Adapters are installed under their registry `id` — always reload by id
    // even if the caller passed the executable name.
    return tryLoadAdapter(entry.id)
  }
  catch (err) {
    consola.debug(`ape-shell adapter auto-install failed for ${lookupId}:`, err)
    return null
  }
}

// Re-export loadAdapter so callers can import everything from one module
export { loadAdapter }
