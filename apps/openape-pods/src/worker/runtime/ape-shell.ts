import { createHash, randomUUID } from 'node:crypto'
import { realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OpenApeMachineExecutionRequest, OpenApeOwnerScriptAuthority, OpenApeProgramExecutionRequest } from '@openape/core'
import { sandboxPolicy, superviseProcess } from './sandbox'
import type { ProcessDomain, RuntimePolicy } from './sandbox'
import { programInvocation } from '../../runtime/program-invocation'

export interface ApeShellRuntime { executable: string, cli: string, environment: Record<string, string> }
export interface MachineLaunch {
  runtime: ApeShellRuntime
  operationId: string
  targetHost: string
  executableHash: string
  files: { path: string, sha256: string }[]
  grantType?: 'once' | 'always'
  summary?: OpenApeProgramExecutionRequest['summary']
  batch?: OpenApeProgramExecutionRequest['batch']
  reference?: string
  waitMs?: number
  forwardChannel?: boolean
  mode?: 'owner-script'
  authority?: OpenApeOwnerScriptAuthority
}

/** Builds resource constraints and forwards the target; only ape-shell may authorize and start it. */
export async function launchApeShell(helper: string, privateDirectory: string, policy: RuntimePolicy, argv: string[], environment: Record<string, string>, launch: MachineLaunch, register?: (path: string, ownerPid: number) => void | Promise<void>, terminal = false) {
  const ownerAuthority = launch.mode === 'owner-script' ? launch.authority : undefined
  if (launch.mode === 'owner-script' ? !ownerAuthority : !launch.runtime.environment.APES_AUTH_FILE) throw new Error('ape-shell requires its explicit execution authority')
  const executable = await realpath(policy.executable)
  const workspace = await realpath(policy.workspace)
  if (workspace !== policy.workspace) throw new Error('Program workspace changed before launch')
  const call = await programInvocation(executable, launch.executableHash, argv, launch.files, workspace, environment)
  const profile = join(privateDirectory, `policy-${randomUUID()}.sb`)
  const content = sandboxPolicy({ ...policy, executable, workspace }) + (terminal ? '\n(allow file-ioctl (regex #"^/dev/ttys[0-9]+$"))\n' : '')
  await writeFile(profile, content, { flag: 'wx', mode: 0o400 })
  const execution = {
    version: 1,
    operationId: launch.operationId,
    executable: { path: executable, sha256: launch.executableHash },
    argv: call.argv,
    ...(call.files?.length ? { files: call.files } : {}),
    cwd: workspace,
    environment: { ...(terminal ? { TERM: 'xterm-256color' } : {}), ...environment },
    targetHost: launch.targetHost,
    sandbox: { path: profile, sha256: createHash('sha256').update(content).digest('hex') },
    forwardChannel: launch.forwardChannel ?? false,
  }
  const request: OpenApeMachineExecutionRequest = ownerAuthority
    ? { ...execution, version: 1, mode: 'owner-script', authority: ownerAuthority }
    : { ...execution, version: 1, grantType: launch.grantType ?? 'always', ...(launch.summary ? { summary: launch.summary } : {}), ...(launch.batch ? { batch: launch.batch } : {}), ...(launch.reference !== undefined ? { reference: launch.reference } : {}), waitMs: launch.waitMs ?? 300000 }
  const frame = `${JSON.stringify(request)}\n`
  if (Buffer.byteLength(frame) > 1024 * 1024) { await rm(profile, { force: true }); throw new Error('Execution context exceeds its size bound') }
  // Environment values travel only over the private channel, never through a persisted request or shell text.
  let domain: ProcessDomain | undefined
  try {
    domain = await superviseProcess(helper, launch.runtime.executable, [launch.runtime.cli, launch.mode === 'owner-script' ? '--run-script' : '-c', '--request-fd', '6'], workspace, { ...launch.runtime.environment, ELECTRON_RUN_AS_NODE: '1', APES_SHELL_MODE: '1' }, privateDirectory, register, terminal, true)
    domain.authority!.on('error', () => domain!.cancel())
    await new Promise<void>((resolve, reject) => domain!.authority!.write(frame, error => error ? reject(error) : resolve()))
    const completed = (async () => {
      try { return await domain!.completed }
      finally { await rm(profile, { force: true }) }
    })()
    return { ...domain, completed }
  }
  catch (error) { domain?.cancel(); await domain?.completed; await rm(profile, { force: true }); throw error }
}
