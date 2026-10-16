import { spawn } from 'node:child_process'
import { join } from 'node:path'

let release: () => Promise<void> = async () => {}
export async function releaseProfileLease(): Promise<void> { await release() }

export async function acquireProfileLease(root: string, helper: string): Promise<void> {
  const child = spawn(helper, [join(root, '.runtime.lock')], { stdio: ['pipe', 'pipe', 'pipe'] })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Profile lease helper timed out')) }, 5000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.stdout.once('data', (data) => {
      clearTimeout(timer)
      if (data.toString() !== 'locked\n') { child.kill(); reject(new Error('Invalid profile lease reply')); return }
      resolve()
    })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(code === 3 ? 'The database is locked by another Pods runtime' : 'Cannot acquire the Pods profile lease')) })
  })
  // The worker keeps the pipe open through shutdown, including child-process
  // cleanup. The kernel releases the lock on a crash without deleting a lockfile.
  child.stdin.on('error', (error) => { console.error('Profile lease lost', error); process.exit(1) })
  let releasing = false
  child.on('exit', () => { if (!releasing) { console.error('Profile lease lost'); process.exit(1) } })
  release = async () => {
    releasing = true
    await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.stdin.end() })
  }
}
