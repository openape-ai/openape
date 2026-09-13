import { spawn, execFile  } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { promisify } from 'node:util'
import { launchSandbox } from '../src/worker/runtime/sandbox'
import type { ProcessDomain } from '../src/worker/runtime/sandbox'

const execute = promisify(execFile)
const roots: string[] = []; const domains: ProcessDomain[] = []
const helper = resolve('dist/native/pods-helper')
afterEach(async () => { for (const domain of domains.splice(0)) { domain.cancel(); await domain.completed } for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() { const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-domains-'))); roots.push(root); return root }
async function inspect(path: string) { return JSON.parse((await execute(helper, ['inspect-domain', path], { env: { PATH: '/usr/bin:/bin' } })).stdout) as { quiescent: boolean, reason: string } }
describe('durable native process identity', () => {
  it('records a live domain and confirms cleanup before reporting it reusable', async () => {
    const root = await fixture(); const script = join(root, 'wait.mjs'); await writeFile(script, 'setInterval(() => {}, 1000)')
    const domain = await launchSandbox(helper, root, { executable: process.execPath, workspace: root, readFiles: [script], runtimeDirectories: [] }, [script]); domains.push(domain)
    const pid = await domain.processId
    const record = (await readFile(domain.recordPath, 'utf8')).trim().split(' ')
    expect(Number(record[4])).toBe(pid); expect(Number(record[5])).toBeGreaterThan(0)
    expect(await inspect(domain.recordPath)).toMatchObject({ quiescent: false })
    domain.cancel(); await domain.completed
    expect(await inspect(domain.recordPath)).toEqual({ quiescent: true, reason: 'confirmed-closed' })
  })
  it('does not release an executable when the owning lease is already closed', async () => {
    const root = await fixture(); const record = join(root, 'domain.record'); const marker = join(root, 'must-not-exist')
    const child = spawn(helper, ['supervise-record', record, '/usr/bin/touch', marker], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'pipe', 'ignore', 'ignore'] })
    const code = await new Promise<number | null>((resolveExit, reject) => { child.once('exit', resolveExit); child.once('error', reject) })
    expect(code).toBe(125); await expect(access(marker)).rejects.toThrow()
    expect(await inspect(record)).toMatchObject({ quiescent: true })
  })
  it('does not treat a reused PID as the old process and never signals it', async () => {
    const root = await fixture(); const record = join(root, 'old.record')
    await writeFile(record, `PODS_DOMAIN_V1 ${process.pid} 1 1 0 0 0 0\n`, { mode: 0o600 })
    expect(await inspect(record)).toEqual({ quiescent: true, reason: 'previous-processes-gone' })
    expect(() => process.kill(process.pid, 0)).not.toThrow()
    expect(await inspect(join(root, 'missing.record'))).toEqual({ quiescent: false, reason: 'registration-missing' })
  })
})
