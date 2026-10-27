import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { immutable, jsonAnswer, save } from './files'
import { invokeJSON, StageFailure } from './invoke'
import type { Tools } from './invoke'

interface Terminal {
  state: string
  phase?: string
  reason?: string
  threadId?: string
  turnId?: string
  result?: { text: string, sha256: string }
}
export async function handoff(tools: Tools, input: {
  application: string,
  jobFile: string,
  job: unknown,
  receipts: string,
  expectedDigest?: string,
  approvalRoot?: string,
}) {
  await immutable(input.jobFile, input.job)
  await mkdir(input.receipts, { recursive: true, mode: 0o700 })
  const args = ['--job', input.jobFile, '--receipts', input.receipts,    ...(input.expectedDigest ? ['--expected-digest', input.expectedDigest] : [])]
  const start = await invokeJSON<Terminal>(tools, input.application, ['dispatch', ...args,    ...(input.approvalRoot ? ['--approval-root', input.approvalRoot] : [])])
  if (['inProgress', 'dispatching'].includes(start.state)) return { state: 'running' as const, terminal: start }
  if (start.state !== 'completed') throw new StageFailure(start.state, start.phase ?? 'dispatch', start.reason ?? start.state)
  const terminal = await invokeJSON<Terminal>(tools, input.application, ['status', ...args, '--result'])
  return result(terminal)
}

export async function queued(tools: Tools, input: {
  application: string,
  jobs: string,
  receipts: string,
  query: string,
  id: string,
  digest: string,
  file?: string,
  advance?: boolean,
  policy?: string,
  policyDigest?: string,
}) {
  await save(input.query, { id: input.id, digest: input.digest, file: input.file ?? 'job.json' })
  const terminal = await invokeJSON<Terminal>(tools, input.application, [input.advance ? 'advance' : 'lookup', '--jobs', input.jobs, '--receipts', input.receipts, '--query', input.query, ...(input.policy ? ['--policy', input.policy, '--policy-digest', input.policyDigest ?? ''] : [])])
  return result(terminal)
}

function result(terminal: Terminal) {
  if (['inProgress', 'dispatching'].includes(terminal.state)) return { state: 'running' as const, terminal }
  if (terminal.state !== 'completed' || !terminal.result?.text || !terminal.result.sha256) {
    throw new StageFailure('unknown', terminal.phase ?? 'result', terminal.reason ?? 'Complete final answer absent')
  }
  let answer: unknown
  try { answer = jsonAnswer(terminal.result.text) }
  catch { throw new StageFailure('unknown', 'result/parse', `Completed turn returned non-JSON; inspect thread ${terminal.threadId}, result ${terminal.result.sha256}`, true) }
  if (answer && typeof answer === 'object' && 'status' in answer && answer.status !== 'completed') {
    const detail = answer as Record<string, unknown>
    throw new StageFailure(String(detail.status), String(detail.phase ?? detail.operation ?? 'result'),      String(detail.cause ?? detail.reason ?? detail.summary ?? 'Model reported failure without a cause'), true)
  }
  return { state: 'completed' as const, terminal, answer }
}

export function jobPaths(root: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid workflow identity')
  return { jobFile: join(root, id, 'job.json'), receipts: join(root, id, 'receipts'), output: join(root, `${id}.json`) }
}
