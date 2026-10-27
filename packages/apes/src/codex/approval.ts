import { join } from 'node:path'
import { z } from 'zod'
import type { Job } from './contract'
import { assertPrivateDirectory, digest, publishRecord, readRecord } from './records'

const receiptSchema = z.object({
  schema: z.literal('openape.codex-approval/1'),
  jobDigest: z.string().regex(/^[a-f0-9]{64}$/),
  jobKey: z.string().min(1),
  reference: z.string().min(1).max(512).regex(/^[\w.:-]+$/),
  expiresAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
}).strict()

export async function recordApproval(root: string, job: Job, reference: string, expiresAt: string) {
  const receipt = receiptSchema.parse({ schema: 'openape.codex-approval/1', jobDigest: digest(job), jobKey: job.key, reference, expiresAt, recordedAt: new Date().toISOString() })
  await assertPrivateDirectory(root)
  const folder = join(root, receipt.jobDigest)
  if (!await readRecord(folder, 'approval')) {
    if (Date.parse(receipt.expiresAt) <= Date.now()) throw new Error('Approval expired; no new receipt was published')
    await publishRecord(folder, 'approval', receipt)
  }
  const existing = receiptSchema.parse(await readRecord(folder, 'approval'))
  if (existing.jobDigest !== receipt.jobDigest || existing.jobKey !== receipt.jobKey || existing.reference !== reference || existing.expiresAt !== expiresAt) {
    throw new Error('Approval receipt conflict; existing authority was not replaced')
  }
  return existing
}

export async function requireApproval(root: string, job: Job) {
  await assertPrivateDirectory(root)
  const folder = join(root, digest(job))
  await assertPrivateDirectory(folder)
  const raw = await readRecord(folder, 'approval')
  if (!raw) throw new Error('No approval receipt for this job digest')
  const receipt = receiptSchema.parse(raw)
  if (receipt.jobDigest !== digest(job) || receipt.jobKey !== job.key) throw new Error('Approval receipt does not match the exact job')
  if (Date.parse(receipt.expiresAt) <= Date.now()) throw new Error('Approval expired; dispatch is blocked')
  return receipt
}
