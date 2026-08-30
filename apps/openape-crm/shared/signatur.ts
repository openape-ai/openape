import type { Phase } from './pipelines'
import { setzeStufe } from './pipelines'

export function signaturPlan(deal: { phase: Phase, stufe: string }) {
  return {
    contractStatus: 'aktiv' as const,
    threadSource: 'automatisch' as const,
    threadStatus: 'neu' as const,
    stufe: deal.phase === 'deal' ? setzeStufe(deal, 'gewonnen') : null,
  }
}
