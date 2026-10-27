import { readFile, realpath, mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { Job } from './contract'
import { assertPrivateDirectory, digest } from './records'
import { normalizeJob } from './handoff'

const querySchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  file: z.enum(['job.json', 'job-v2.json']).default('job.json'),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

const policySchema = z.object({
  schema: z.literal('openape.codex-queue-policy/1'),
  cwd: z.string().startsWith('/'),
  model: z.string().min(1),
  sandbox: z.enum(['read-only', 'danger-full-access']),
  approvalPolicy: z.literal('never'),
  keyPrefix: z.string().min(1),
  keySuffix: z.string(),
  promptPrefix: z.string().min(1),
  file: z.enum(['job.json', 'job-v2.json']),
  maxAgeSeconds: z.number().int().min(60).max(604800),
}).strict()

export async function checkQueuePolicy(job: Job, id: string, file: string, path: string, expectedDigest: string) {
  if (!isAbsolute(path) || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('Advance requires a pinned absolute policy')
  const bytes = await readFile(path)
  if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest) throw new Error('Queue policy changed; renew the exact queue authorization')
  const policy = policySchema.parse(JSON.parse(bytes.toString('utf8')))
  if (job.cwd !== await realpath(policy.cwd) || job.model !== policy.model || job.sandbox !== policy.sandbox
    || job.approvalPolicy !== policy.approvalPolicy || job.maxAgeSeconds !== policy.maxAgeSeconds
    || job.key !== `${policy.keyPrefix}${id}${policy.keySuffix}` || file !== policy.file || !job.prompt.startsWith(policy.promptPrefix)) {
    throw new Error('Queued job differs from the owner-authorized execution policy')
  }
  const data: unknown = JSON.parse(job.prompt.slice(policy.promptPrefix.length))
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Queue policy input must be JSON evidence')
}

export async function queueJob(jobsRoot: string, receiptsRoot: string, queryFile: string, createReceipts: boolean) {
  if (![jobsRoot, receiptsRoot, queryFile].every(isAbsolute)) throw new Error('Queue paths must be absolute')
  await assertPrivateDirectory(jobsRoot)
  await assertPrivateDirectory(receiptsRoot)
  const query = querySchema.parse(JSON.parse(await readFile(queryFile, 'utf8')))
  const jobs = await realpath(jobsRoot); const receipts = await realpath(receiptsRoot)
  const jobDirectory = join(jobs, query.id); const receiptDirectory = join(receipts, query.id)
  await assertPrivateDirectory(jobDirectory)
  if (await realpath(jobDirectory) !== jobDirectory) throw new Error('Job directory escapes queue')
  const jobFile = join(jobDirectory, query.file)
  if (await realpath(jobFile) !== jobFile) throw new Error('Job file is linked outside its queue identity')
  const job = await normalizeJob(JSON.parse(await readFile(jobFile, 'utf8')))
  if (digest(job) !== query.digest) throw new Error('Queue job differs from the requested canonical digest')
  if (createReceipts) {
    await mkdir(receiptDirectory, { mode: 0o700, recursive: true })
    await assertPrivateDirectory(receiptDirectory)
    await mkdir(join(receiptDirectory, 'receipts'), { mode: 0o700, recursive: true })
  }
  await assertPrivateDirectory(receiptDirectory)
  await assertPrivateDirectory(join(receiptDirectory, 'receipts'))
  return { job, id: query.id, file: query.file, root: join(receiptDirectory, 'receipts') }
}
