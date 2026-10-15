import { randomUUID } from 'node:crypto'
import { realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sandboxPolicy, superviseProcess } from '../../src/worker/runtime/sandbox'
import type { ProcessDomain, RuntimePolicy } from '../../src/worker/runtime/sandbox'

/** Test-only primitive for sandbox/guardian probes. Production targets use ape-shell. */
export async function launchSandbox(helper: string, directory: string, policy: RuntimePolicy, args: string[], environment: Record<string, string> = {}, register?: (path: string, pid: number) => void | Promise<void>): Promise<ProcessDomain> {
  const profile = join(directory, `probe-${randomUUID()}.sb`)
  const canonical = { ...policy, executable: await realpath(policy.executable), workspace: await realpath(policy.workspace) }
  await writeFile(profile, sandboxPolicy(canonical), { flag: 'wx', mode: 0o600 })
  return superviseProcess(helper, '/usr/bin/sandbox-exec', ['-f', profile, canonical.executable, ...args], canonical.workspace, environment, directory, register)
}
