import consola from 'consola'
import { apiFetch, getGrantsEndpoint } from './http'

/**
 * Why-pending diagnostics (#1109): the grant detail endpoint explains which
 * auto-approve mechanism did NOT fire, and why. For the consuming
 * Agenten ist der wichtigste Fall die Substitution: ein Kommando mit `$( )`,
 * loops or heredocs is treated fail-closed and can NEVER be auto-approved by
 * retrying — without this hint the loop grinds card after card (finding
 * 2026-07-30: 27 pending cards in one day, all the same cause).
 */
export interface PendingDiagnostic {
  source: string
  reason: string
  summary: string
  detail?: {
    mode?: string
    unmatchedSegments?: string[]
    substitutionSegments?: string[]
  }
}

export async function fetchPendingDiagnostics(idp: string, grantId: string): Promise<PendingDiagnostic[]> {
  try {
    const grant = await apiFetch<{ pending_diagnostics?: PendingDiagnostic[] }>(
      `${getGrantsEndpoint(idp)}/${grantId}`,
    )
    return grant.pending_diagnostics ?? []
  }
  catch (err) {
    // Enrichment, not the core path: the pending block is correct without the
    // diagnosis too. Still make it visible rather than swallowing it.
    consola.debug(`Could not fetch pending diagnostics for ${grantId}: ${(err as Error).message}`)
    return []
  }
}

export function formatPendingDiagnostics(diags: PendingDiagnostic[]): string[] {
  if (diags.length === 0) return []
  const lines: string[] = ['', '  Why this is pending:']
  let hasSubstitution = false
  for (const d of diags) {
    lines.push(`    [${d.source}] ${d.summary}`)
    if (d.detail?.substitutionSegments?.length) hasSubstitution = true
  }
  if (hasSubstitution) {
    lines.push('')
    lines.push('    ⚠ This command contains $( ) substitution, a loop or a heredoc.')
    lines.push('      Such commands are NEVER auto-approved — retrying or rephrasing')
    lines.push('      the same construct cannot help. Split the work into simple')
    lines.push('      single commands (one tool invocation each) or use a wrapper')
    lines.push('      your role provides.')
  }
  return lines
}
