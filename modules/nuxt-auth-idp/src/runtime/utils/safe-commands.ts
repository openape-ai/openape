/**
 * Client-safe mirror of the safe-commands defaults and predicate from
 * `@openape/grants`. The canonical implementation lives there, but
 * importing `@openape/grants` from a Vue page pulls in server-only
 * modules (node:crypto via the resolver), which breaks the browser
 * bundle. This file duplicates the data intentionally — keep it in
 * sync with `packages/grants/src/safe-commands.ts`.
 */

export interface SafeCommandDefinition {
  cli_id: string
  action: 'exec' | 'read'
  display: string
  description: string
}

export const SAFE_COMMAND_DEFAULTS: readonly SafeCommandDefinition[] = [
  { cli_id: 'ls', action: 'read', display: 'List directory contents', description: 'Read-only directory listing' },
  { cli_id: 'cat', action: 'read', display: 'Print file contents', description: 'Read-only file read' },
  { cli_id: 'head', action: 'read', display: 'Show top of file', description: 'Read-only partial file read' },
  { cli_id: 'tail', action: 'read', display: 'Show bottom of file', description: 'Read-only partial file read' },
  { cli_id: 'wc', action: 'read', display: 'Count lines/words/bytes', description: 'Read-only counter' },
  { cli_id: 'file', action: 'read', display: 'Detect file type', description: 'Read-only metadata inspection' },
  { cli_id: 'stat', action: 'read', display: 'File metadata', description: 'Read-only metadata' },
  { cli_id: 'which', action: 'read', display: 'Locate executable', description: 'Read-only PATH lookup' },
  { cli_id: 'echo', action: 'exec', display: 'Echo arguments', description: 'Pure output, no side effects' },
  { cli_id: 'date', action: 'read', display: 'Show date/time', description: 'Read-only clock' },
  { cli_id: 'whoami', action: 'read', display: 'Current user identity', description: 'Read-only identity' },
  { cli_id: 'pwd', action: 'read', display: 'Working directory', description: 'Read-only directory info' },
  { cli_id: 'find', action: 'read', display: 'Search filesystem', description: 'Read-only filesystem search' },
  { cli_id: 'grep', action: 'read', display: 'Search file contents', description: 'Read-only text search' },
] as const

export const SAFE_COMMAND_REASON_DEFAULT = 'safe-command:default'
export const SAFE_COMMAND_REASON_CUSTOM = 'safe-command:custom'

export function isSafeCommandGrant(grant: { request?: unknown }): boolean {
  const r = grant.request as { reason?: unknown } | undefined
  const reason = r?.reason
  return reason === SAFE_COMMAND_REASON_DEFAULT || reason === SAFE_COMMAND_REASON_CUSTOM
}
