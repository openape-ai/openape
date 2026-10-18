import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { basename, join, resolve, sep } from 'node:path'
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
export async function confirmDomainsStopped(store: PodDatabase, runId: string, helper: string, requireRegistration = false): Promise<void> {
  const domains = store.db.prepare('SELECT * FROM execution_domains WHERE run_id=?').all(runId)
  await inspectDomainRecords(domains, join(store.root, 'runs', runId), helper, requireRegistration)
}
export async function inspectDomainRecords(domains: Record<string, unknown>[], root: string, helper: string, requireRegistration = false): Promise<void> {
  if (requireRegistration && !domains.length) throw new Error('Owner-script recovery requires recorded execution domains')
  const deadline = Date.now() + 10000
  for (const domain of domains) {
    const path = domain.path as string
    if (!path.startsWith(root + sep)) throw new Error('Execution domain belongs to another run')
    if (requireRegistration && (resolve(path) !== path || !/^domain-[a-f0-9-]{36}\.record$/.test(basename(path)) || domain.run_id !== basename(root) || !Number.isSafeInteger(domain.owner_pid) || Number(domain.owner_pid) < 2)) throw new Error('Owner-script execution domain evidence is invalid')
    for (;;) {
      const { stdout } = await execute(helper, ['inspect-domain', path], { env: { PATH: '/usr/bin:/bin' }, timeout: 3000, maxBuffer: 1024 })
      const result = JSON.parse(stdout) as { quiescent?: boolean, reason?: string }
      if (result.quiescent === true) break
      if (requireRegistration) throw new Error('Owner-script execution domain is still present or unverified')
      if (result.reason === 'registration-missing' && ownerGone(domain.owner_pid as number)) break
      if (Date.now() >= deadline) throw new Error('Previous execution is still present or unverified; retry inspection after it stops')
      await delay(100)
    }
  }
}
