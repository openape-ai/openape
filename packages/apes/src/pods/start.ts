import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeJob } from '../codex/handoff'
import { digest } from '../codex/records'
import { immutable, read, save, hash } from './files'
import { StageFailure } from './invoke'
import type { Tools } from './invoke'

export async function jobIdentity(value: unknown) {
  const job = await normalizeJob(value)
  return { job, digest: digest(job) }
}

export async function requestStart(tools: Tools, input: {
  application: string,
  root: string,
  output: string,
  jobFile: string,
  job: unknown,
  expectedDigest?: string,
  referencePrefix: string,
  metadata: Record<string, unknown>,
  summary: (digest: string, expiresAt: string) => { title: string, description: string, link: string },
}) {
  const id = input.metadata.workflowId
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || input.jobFile !== join(input.root, id, 'job.json')) throw new StageFailure('failed', 'approval/input', 'Invalid workflow job path', true)
  await immutable(input.jobFile, input.job)
  const prior = await read(input.output)
  if (prior && ['approved', 'denied', 'revoked', 'expired', 'withdrawn', 'used'].includes(String(prior.status))) return prior
  const identity = await jobIdentity(input.job)
  if (input.expectedDigest && input.expectedDigest !== identity.digest) throw new StageFailure('failed', 'approval/digest', 'Published plan and job digest differ', true)
  const requestFile = `${input.jobFile}.request.json`
  const savedRequest = await read<{ digest: string, reference: string, expiresAt: string }>(requestFile)
  const request = savedRequest ?? { digest: identity.digest, reference: `${input.referencePrefix}${identity.digest}`, expiresAt: new Date(Date.now() + 48 * 3600000).toISOString() }
  if (request.digest !== identity.digest || request.reference !== `${input.referencePrefix}${identity.digest}`) throw new StageFailure('failed', 'approval/request', 'Immutable start request changed', true)
  await immutable(requestFile, request)
  const receipts = join(input.root, String(input.metadata.workflowId), 'receipts')
  await mkdir(receipts, { recursive: true, mode: 0o700 })
  const store = async (status: string, extra: Record<string, unknown> = {}) => {
    const record = {
      ...input.metadata,
      job: input.job,
      jobDigest: identity.digest,
      reference: request.reference,
      expiresAt: request.expiresAt,
      authorization: 'exact-start',
      status,
      terminal: ['denied', 'revoked', 'expired', 'withdrawn', 'used'].includes(status),
      links: input.metadata.links ?? [],
      summary: status === 'expired' ? 'Approval expired before a job was started; a new owner decision is required.' : input.metadata.summary,
      ...extra,
    }
    const result = { ...record, outputDigest: hash(record) }
    await save(input.output, result)
    return result
  }
  const observe = async () => {
    const folder = join(receipts, digest(identity.job.key))
    const intent = await read(`${folder}/intent.json`)
    if (!intent) return false
    const authority = intent.startApproval as { reference?: string, deadline?: string } | undefined
    if (intent.digest !== identity.digest || authority?.reference !== request.reference || authority?.deadline !== request.expiresAt) throw new StageFailure('failed', 'approval/intent', 'Start intent does not match the exact referenced approval', true)
    const failure = await read(`${folder}/failure.json`)
    if (failure?.phase === 'approval') throw new StageFailure('failed', 'approval/start', String(failure.cause), true)
    return true
  }
  const intent = await observe()
  if (intent) {
    return store('approved')
  }
  if (Date.parse(request.expiresAt) <= Date.now()) {
    try { await tools.withdraw({ reference: request.reference, reason: 'Start approval window expired.' }) }
    catch (error) { throw new StageFailure('unknown', 'approval/withdraw', String(error)) }
    return store('expired')
  }
  await store('pending')
  let reply
  try {
    reply = await tools.invoke({
      application: input.application,
      argv: ['dispatch', '--job', input.jobFile, '--receipts', receipts, '--expected-digest', identity.digest, '--deadline', request.expiresAt, '--reference', request.reference],
      reference: request.reference,
      approvalWaitMs: 0,
      summary: input.summary(identity.digest, request.expiresAt),
    })
  }
  catch (error) { throw new StageFailure('unknown', 'approval/start', String(error)) }
  const observed = await observe()
  if (observed) return store('approved')
  if (reply.pending) return store('pending', reply.pending)
  if (reply.refusal && ['denied', 'revoked', 'expired', 'withdrawn'].includes(reply.refusal.state)) return store(reply.refusal.state)
  throw new StageFailure('unknown', 'approval/start', 'Start outcome not observed; retain the same request and reconcile its intent', reply.refusal?.state === 'used')
}
