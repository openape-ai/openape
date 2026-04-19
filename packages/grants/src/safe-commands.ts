import type { StandingGrantRequest } from './standing-grants.js'

/**
 * A single curated safe-command default — a low-risk CLI that is pre-authorized
 * for freshly enrolled agents so common read-only work does not block on
 * manual approval.
 */
export interface SafeCommandDefinition {
  cli_id: string
  action: 'exec' | 'read'
  display: string
  description: string
}

/**
 * The canonical default set seeded on agent enrollment. Conservative by design:
 * read-only tools + `echo`. Write-capable commands (`touch`, `mkdir`, `cp`, `mv`)
 * are intentionally excluded and must be added explicitly as custom safe commands.
 */
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

export interface BuildSafeCommandRequestParams {
  cliId: string
  action: 'exec' | 'read'
  owner: string
  delegate: string
  custom?: boolean
}

/**
 * Build the canonical `StandingGrantRequest` shape for a safe command.
 * Stable across default and custom entries — the only difference is the
 * `reason` marker, which later drives UI grouping and audit badges.
 */
export function buildSafeCommandRequest(params: BuildSafeCommandRequestParams): StandingGrantRequest {
  return {
    type: 'standing',
    owner: params.owner,
    delegate: params.delegate,
    audience: 'shapes',
    target_host: '*',
    cli_id: params.cliId,
    resource_chain_template: [],
    action: params.action,
    max_risk: 'low',
    grant_type: 'always',
    reason: params.custom ? SAFE_COMMAND_REASON_CUSTOM : SAFE_COMMAND_REASON_DEFAULT,
  }
}

/**
 * Narrow predicate: does this grant's stored `request.reason` indicate it
 * was created via the safe-commands path (default or user-added custom)?
 */
export function isSafeCommandGrant(grant: { request?: unknown }): boolean {
  const r = grant.request as { reason?: unknown } | undefined
  const reason = r?.reason
  return reason === SAFE_COMMAND_REASON_DEFAULT || reason === SAFE_COMMAND_REASON_CUSTOM
}

/**
 * Stricter variant: only the canonical default set (excludes user-added customs).
 */
export function isDefaultSafeCommandGrant(grant: { request?: unknown }): boolean {
  const r = grant.request as { reason?: unknown } | undefined
  return r?.reason === SAFE_COMMAND_REASON_DEFAULT
}
