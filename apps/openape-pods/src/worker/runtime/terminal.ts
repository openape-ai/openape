import { randomUUID } from 'node:crypto'
import { realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sandboxPolicy, superviseProcess } from './sandbox'
import type { RuntimePolicy } from './sandbox'

export async function launchTerminal(helper: string, privateDirectory: string, policy: RuntimePolicy, args: string[], environment: Record<string, string>, register?: (path: string, ownerPid: number) => void | Promise<void>) {
  if (process.platform !== 'darwin') throw new Error('Native pod execution requires macOS')
  const canonical = { ...policy, executable: await realpath(policy.executable), workspace: await realpath(policy.workspace) }
  const profile = join(privateDirectory, `terminal-${randomUUID()}.sb`)
  await writeFile(profile, `${sandboxPolicy(canonical)}\n(allow file-ioctl (regex #"^/dev/ttys[0-9]+$"))\n`, { flag: 'wx', mode: 0o600 })
  const domain = await superviseProcess(helper, '/usr/bin/sandbox-exec', ['-f', profile, canonical.executable, ...args], canonical.workspace, { TERM: 'xterm-256color', ...environment }, privateDirectory, register, true)
  const control = domain.guardian.stdio.at(5)
  if (!control || !('write' in control)) { domain.cancel(); await domain.completed; throw new Error('Terminal control channel is unavailable') }
  control.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') console.error('Terminal resize failed', error.message) })
  return { ...domain, resize(columns: number, rows: number) {
    if (!Number.isInteger(columns) || columns < 20 || columns > 500 || !Number.isInteger(rows) || rows < 5 || rows > 300) throw new Error('Invalid terminal dimensions')
    if (control.destroyed || control.writableEnded) throw new Error('Terminal is closed')
    const bytes = Buffer.alloc(4); bytes.writeUInt16LE(columns, 0); bytes.writeUInt16LE(rows, 2); control.write(bytes)
  } }
}
