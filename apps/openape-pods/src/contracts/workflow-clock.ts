import { Cron } from 'croner'
import type { WorkflowSchedule } from './workflows'
import { nextDue } from './clock'

export function nextWorkflowDue(spec: WorkflowSchedule, previous: number | null, now: number): number | null {
  if (spec.kind === 'once') return previous === null ? spec.at : null
  if (spec.kind === 'cron') return new Cron(spec.expression, { timezone: spec.timezone, legacyMode: true }).nextRun(new Date(now))?.getTime() ?? null
  return nextDue(spec, previous, now)
}
