import type { Phase } from '#shared/pipelines'
import { isPhase, setzeStufe, stufe } from '#shared/pipelines'
import { createProblemError } from './problem'

export function applyStufePatch(
  deal: { phase: Phase, stufe: string },
  stufeId: string,
  now = Date.now(),
): { fields: { phase: Phase, stufe: string, closedAt: number | null }, log?: { title: string, body: string } } {
  const result = setzeStufe(deal, stufeId)
  const landed = stufe(result.phase, result.stufe)
  const fields = {
    phase: result.phase,
    stufe: result.stufe,
    closedAt: landed?.endstufe ? now : null,
  }
  if (result.konvertiert && result.logTitle && result.logText) {
    return { fields, log: { title: result.logTitle, body: result.logText } }
  }
  return { fields }
}

export function parsePhase(value: unknown): Phase {
  if (isPhase(value)) return value
  throw createProblemError({ status: 400, title: 'unknown phase' })
}

export function parseStufe(phase: Phase, value: unknown): string {
  if (typeof value === 'string' && stufe(phase, value)) return value
  throw createProblemError({ status: 400, title: 'unknown stufe' })
}
