import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { immutable, read, save } from './files'
import { invokeJSON, StageFailure } from './invoke'
import type { Tools } from './invoke'

interface ApprovalState extends Record<string, unknown> {
  status: string
  jobDigest: string
  reference: string
  expiresAt: string
}
const terminalStates = ['denied', 'revoked', 'expired', 'withdrawn', 'used']

export async function approval(tools: Tools, input: {
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
  await immutable(input.jobFile, input.job)
  const prior = await read<ApprovalState>(input.output)
  if (prior && (prior.status === 'approved' || terminalStates.includes(prior.status))) return prior
  const identity = await invokeJSON<{ digest: string }>(tools, input.application, ['digest', '--job', input.jobFile])
  if (!/^[a-f0-9]{64}$/.test(identity.digest) || (input.expectedDigest && input.expectedDigest !== identity.digest)) {
    throw new StageFailure('failed', 'approval/digest', 'Published plan and canonical job digest differ', true)
  }
  const reference = `${input.referencePrefix}${identity.digest}`
  const expiresAt = prior?.expiresAt ?? new Date(Date.now() + 48 * 3600000).toISOString()
  if (prior && (prior.jobDigest !== identity.digest || prior.reference !== reference)) throw new Error('Pending approval identity changed')
  const store = async (status: string, extra: Record<string, unknown> = {}) => {
    const record: ApprovalState = { ...input.metadata, job: input.job, jobDigest: identity.digest, reference, expiresAt, status, ...extra }
    await save(input.output, record)
    return record
  }
  const receipts = join(input.root, 'receipts')
  await mkdir(receipts, { recursive: true, mode: 0o700 })
  const check = async () => {
    const receipt = await read(join(receipts, identity.digest, 'approval.json'))
    if (receipt && (receipt.jobDigest !== identity.digest || receipt.reference !== reference || receipt.expiresAt !== expiresAt)) {
      throw new StageFailure('failed', 'approval/receipt', 'Conflicting approval receipt', true)
    }
    return receipt
  }
  if (!prior) await store('pending')
  if (await check()) return store(Date.parse(expiresAt) > Date.now() ? 'approved' : 'expired')
  if (Date.parse(expiresAt) <= Date.now()) {
    try { await tools.withdraw({ reference, reason: 'Approval window expired.' }) }
    catch (error) { throw new StageFailure('unknown', 'approval/withdraw', String(error)) }
    return store('expired')
  }
  let reply
  try {
    reply = await tools.invoke({
      application: input.application,
      argv: ['approve', '--job', input.jobFile,    '--receipts', receipts, '--expected-digest', identity.digest, '--reference', reference, '--expires-at', expiresAt],
      reference,
      approvalWaitMs: 0,
      summary: input.summary(identity.digest, expiresAt),
    })
  }
  catch (error) { throw new StageFailure('unknown', 'approval/invoke', String(error)) }
  if (await check()) return store(Date.parse(expiresAt) > Date.now() ? 'approved' : 'expired')
  if (reply.pending) return store('pending', reply.pending)
  if (reply.refusal && terminalStates.includes(reply.refusal.state)) return store(reply.refusal.state, { reason: reply.refusal.reason })
  throw new StageFailure('unknown', 'approval/receipt', 'Authorized receipt not observed; existing request retained')
}
