import { join } from 'node:path'
import { read, save, hash } from './files'
import { digest } from '../codex/records'
import { redact, StageFailure } from './invoke'
import type { Tools } from './invoke'

export async function supersede(tools: Tools, input: { output: string, jobFile: string, executionRoot: string, metadata: Record<string, unknown> }) {
  const prior = await read(input.output)
  if (prior?.terminal || (prior && ['denied', 'revoked', 'expired', 'withdrawn', 'used'].includes(String(prior.status)))) return
  const persist = async (extra: Record<string, unknown>) => {
    const record = { ...input.metadata, ...prior, ...extra }
    await save(input.output, { ...record, outputDigest: hash(record) })
  }
  try {
    const request = await read<{ reference: string, digest: string, expiresAt: string }>(`${input.jobFile}.request.json`)
    const job = await read<{ key: string }>(input.jobFile)
    const observe = async () => {
      if (!job) return false
      const folder = join(input.executionRoot, digest(job.key))
      const intent = await read(join(folder, 'intent.json'))
      if (!intent) return false
      const expectedDigest = request?.digest ?? prior?.jobDigest
      const authority = intent.startApproval as { reference?: string, deadline?: string } | undefined
      if ((expectedDigest && intent.digest !== expectedDigest) || (request &&
        (authority?.reference !== request.reference || authority?.deadline !== request.expiresAt))) {
        throw new StageFailure('failed', 'approval/intent', 'Superseded intent does not match the approved job and reference', true)
      }
      const failure = await read(join(folder, 'failure.json'))
      if (failure?.phase === 'approval') throw new StageFailure('failed', 'approval/start', String(failure.cause), true)
      await persist({ status: 'approved', superseded: true })
      return true
    }
    if (await observe()) return
    const reference = request?.reference ?? prior?.reference
    if (typeof reference !== 'string') return
    const outcome = await tools.withdraw({ reference, reason: 'A different task revision is current; this start is no longer requested.' }) as { outcome?: string, state?: string } | undefined
    if (await observe()) return
    if (outcome?.state === 'used' || !outcome?.outcome) {
      throw new StageFailure('unknown', 'approval/withdraw', 'Withdrawal did not establish that no start is in flight; reconcile the original intent')
    }
    await persist({ reference, status: 'withdrawn' })
  }
  catch (error) {
    const failure = error instanceof StageFailure ? error : new StageFailure('unknown', 'approval/withdraw', String(error))
    await persist({ status: failure.status, phase: failure.phase, terminal: failure.terminal, summary: redact(failure.message), links: prior?.links ?? [] })
  }
}
