import { loadAdapter, resolveCommand } from '@openape/apes'
import { AuthorityError } from '../../contracts/infrastructure'
import type { PodResource } from '../../contracts/resources'
import { programRequest } from '../../main/programs/invoke'
import { readActions } from '../../main/programs/session'
import type { EffectLedger } from '../recovery/effects'

/** Whether a tool call runs an application command whose adapter action is not a read. */
export async function programWrite(resources: PodResource[], podId: string, capabilities: string[], body: unknown): Promise<boolean> {
  if (!body || typeof body !== 'object' || !('applicationId' in body || 'application' in body)) return false
  const { assignment, argv } = programRequest(resources, podId, capabilities, body)
  const resolved = await resolveCommand(loadAdapter(assignment.cliId, assignment.adapterPath), [assignment.cliId, ...argv])
  return !readActions.includes(resolved.detail.action)
}

/**
 * Records an application write in the effect ledger like an HTTP effect. Programs have no idempotency key, so the
 * run that wrote is never replayed automatically, and an interrupted or failed write stays unknown until the owner
 * reconciles it. A call refused by its grant started no process, so its intent is dropped.
 */
export async function executeProgramEffect(ledger: EffectLedger, podId: string, runId: string, key: string, body: unknown, send: () => Promise<unknown>): Promise<unknown> {
  const intent = ledger.begin(podId, runId, key, 'program.call', body)
  if (!intent.execute) return intent.result
  let reply: unknown
  try { reply = await send() }
  catch (error) {
    ledger.markUnknown(podId, key)
    if (error instanceof AuthorityError) ledger.reconcile(podId, key, { applied: false })
    throw error
  }
  if ((reply as { exitCode?: unknown } | null)?.exitCode === 0) ledger.complete(podId, key, { exitCode: 0 })
  else ledger.markUnknown(podId, key)
  return reply
}
