import consola from 'consola'
import { apiFetch, getGrantsEndpoint } from './http'

/**
 * Why-pending-Diagnosen (#1109): der Grant-Detail-Endpoint erklärt, welcher
 * Auto-Approve-Mechanismus warum NICHT gegriffen hat. Für den konsumierenden
 * Agenten ist der wichtigste Fall die Substitution: ein Kommando mit `$( )`,
 * Loops oder Heredocs wird fail-closed behandelt und kann durch Retries NIE
 * auto-approved werden — ohne diesen Hinweis grindet der Loop Karte um Karte
 * (Befund 30.07.: 27 pending Karten an einem Tag, alle dieselbe Ursache).
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
    // Enrichment, nicht Kernpfad: der Pending-Block ist auch ohne Diagnose
    // korrekt. Trotzdem sichtbar machen statt still schlucken.
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
