import { loadAdapter, resolveCommand } from '@openape/apes'
import { AuthorityError } from '../../contracts/infrastructure'
import { assertGateOperation } from '../../contracts/mail-archive-port'
import type { PodResource } from '../../contracts/resources'
import { programRequest } from '../../main/programs/invoke'
import { readActions } from '../../main/programs/session'
import { EffectLedger } from '../recovery/effects'
import { canonicalJson } from '../../contracts/canonical-json'
import type { ApprovedInvocation } from '../../contracts/programs'
import { approvalEffectKey } from '../data/approvals'
import type { Approvals, ApprovalService } from '../data/approvals'
import type { PodDatabase } from '../storage/database'

/** Whether a tool call runs an application command whose adapter action is not a read. */
export async function programWrite(resources: PodResource[], podId: string, capabilities: string[], body: unknown): Promise<boolean> {
  if (!body || typeof body !== 'object' || !('applicationId' in body || 'application' in body)) return false
  const { assignment, argv } = programRequest(resources, podId, capabilities, body)
  const resolved = await resolveCommand(loadAdapter(assignment.cliId, assignment.adapterPath), [assignment.cliId, ...argv])
  // Refused before anything is recorded or sent: a mail move only runs through the archive port.
  assertGateOperation(resolved.detail.action)
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

/**
 * The adapter's description of one command a script asks approval for. The command must match an adapter operation;
 * a mail move stays with the archive service and a generic execution is never approved by object.
 */
export async function describeProgram(resources: PodResource[], podId: string, capabilities: string[], command: { application: string, argv: unknown }): Promise<string> {
  const { assignment, argv } = programRequest(resources, podId, capabilities, command)
  const resolved = await resolveCommand(loadAdapter(assignment.cliId, assignment.adapterPath), [assignment.cliId, ...argv])
  assertGateOperation(resolved.detail.action)
  if (resolved.detail.operation_id === '_generic.exec') throw new Error('An approved command must match an operation of the application adapter')
  return resolved.detail.display
}

/**
 * Runs one exact command with its program approval instead of a continuing grant (issue 1468). The approval must be
 * of this Pod and name exactly this command; it is consumed at the IdP before anything starts, and the command then
 * runs once as an effect keyed by the approval, so neither a second call nor a retry runs it again.
 */
export async function invokeApproved(store: PodDatabase, approvals: Approvals, service: ApprovalService, scope: { podId: string, runId: string }, request: ApprovedInvocation, execute: (command: { application: string, argv: string[] }) => Promise<unknown>, assertCurrent: () => void, signal: AbortSignal): Promise<unknown> {
  const approval = approvals.get(scope.podId, request.approval)
  const command = { application: request.application, argv: request.argv }
  if (approval.action !== 'program.run') throw new Error('The approval does not name a program command')
  if (canonicalJson(approval.payload) !== canonicalJson(command)) throw new Error('The approval covers a different command; request an approval for this exact command')
  await approvals.consume(scope.podId, approval.id, service, signal)
  assertCurrent()
  return executeProgramEffect(new EffectLedger(store), scope.podId, scope.runId, approvalEffectKey(approval.id), command, () => execute(command))
}
