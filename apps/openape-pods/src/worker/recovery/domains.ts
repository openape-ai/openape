import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { join, sep } from 'node:path'
import type { PodDatabase } from '../storage/database'

const execute = promisify(execFile)
function ownerGone(pid: number): boolean {
  try { process.kill(pid, 0); return false }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error }
}
export async function confirmDomainsStopped(store: PodDatabase, runId: string, helper: string): Promise<void> {
  const domains = store.db.prepare('SELECT * FROM execution_domains WHERE run_id=?').all(runId)
  const deadline = Date.now() + 10000
  for (const domain of domains) {
    const path = domain.path as string
    if (!path.startsWith(join(store.root, 'runs', runId) + sep)) throw new Error('Execution domain belongs to another run')
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
