import { describe, expect, it } from 'vitest'
import { formatPendingDiagnostics } from '../src/pending-diagnostics'

describe('formatPendingDiagnostics', () => {
  it('keine Diagnosen → keine Zeilen (kein leerer Block)', () => {
    expect(formatPendingDiagnostics([])).toEqual([])
  })

  it('listet jede Diagnose mit Quelle und Summary', () => {
    const lines = formatPendingDiagnostics([
      { source: 'yolo', reason: 'segments-not-allowed', summary: 'No allow pattern covers: curl …' },
      { source: 'standing-grant', reason: 'no-covering-rule', summary: 'No standing rule covers o365.' },
    ])
    expect(lines.join('\n')).toContain('[yolo] No allow pattern covers: curl …')
    expect(lines.join('\n')).toContain('[standing-grant] No standing rule covers o365.')
    expect(lines.join('\n')).not.toContain('NEVER auto-approved')
  })

  it('Substitution löst die NIE-auto-approved-Warnung mit Handlungsanweisung aus', () => {
    const lines = formatPendingDiagnostics([
      {
        source: 'yolo',
        reason: 'segments-not-allowed',
        summary: 'No allow pattern covers this command: curl …',
        detail: { mode: 'deny-list', substitutionSegments: ['curl $(curl …)'] },
      },
    ])
    const text = lines.join('\n')
    expect(text).toContain('NEVER auto-approved')
    expect(text).toContain('Split the work into simple')
  })
})
