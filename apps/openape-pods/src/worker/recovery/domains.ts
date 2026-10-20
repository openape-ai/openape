import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { join, sep } from 'node:path'
import type { PodDatabase } from '../storage/database'

const execute = promisify(execFile)
export function ownerGone(pid: number): boolean {
  try { process.kill(pid, 0); return false }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false
    throw error
  }
}
export async function confirmDomainsStopped(store: PodDatabase, runId: string, helper: string): Promise<void> {
  const proxyCleanup = store.db.prepare("SELECT json_extract(data,'$.hostPid') AS host_pid FROM run_events WHERE run_id=? AND type='agent-cleanup' AND json_extract(data,'$.state')='unconfirmed'").all(runId)
  for (const event of proxyCleanup) {
    // PID reuse deliberately keeps the lease fenced rather than assuming termination.
    if (!Number.isSafeInteger(event.host_pid) || Number(event.host_pid) <= 1 || !ownerGone(Number(event.host_pid))) throw new Error('Proxy request cleanup is unconfirmed; restart the idle runtime after its previous host has stopped')
  }
  const domains = store.db.prepare('SELECT * FROM execution_domains WHERE run_id=?').all(runId)
  await inspectDomainRecords(domains, join(store.root, 'runs', runId), helper)
}
export async function inspectDomainRecords(domains: Record<string, unknown>[], root: string, helper: string): Promise<void> {
  const deadline = Date.now() + 10000
  for (const domain of domains) {
    const path = domain.path as string
    if (!path.startsWith(root + sep)) throw new Error('Execution domain belongs to another run')
    for (;;) {
      const { stdout } = await execute(helper, ['inspect-domain', path], { env: { PATH: '/usr/bin:/bin' }, timeout: 3000, maxBuffer: 1024 })
      const result = JSON.parse(stdout) as { quiescent?: boolean, reason?: string }
      if (result.quiescent === true) break
      if (result.reason === 'registration-missing' && ownerGone(domain.owner_pid as number)) break
      if (Date.now() >= deadline) throw new Error('Previous execution is still present or unverified; retry inspection after it stops')
      await delay(100)
    }
  }
}
