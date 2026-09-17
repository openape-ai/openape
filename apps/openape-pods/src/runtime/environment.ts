import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function quoteShell(value: string): string {
  if (value.includes('\0')) throw new Error('Shell arguments cannot contain NUL')
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

export async function podDirectory(parent: string, name: string): Promise<string> {
  const path = join(parent, name)
  try { await mkdir(path, { mode: 0o700 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pod environment cannot contain symbolic directory links')
  return path
}

export interface ShellRuntime { executable: string, cli: string, client: string }
export interface PodEnvironment { podId: string, home: string, workspace: string, bin: string, environment: Record<string, string> }
export async function podDirectories(root: string, podId: string): Promise<{ home: string, workspace: string }> {
  if (!/^[a-f0-9-]{36}$/.test(podId)) throw new Error('Invalid pod environment identity')
  const canonical = await realpath(root)
  const pods = await podDirectory(canonical, 'pods'); const pod = await podDirectory(pods, podId)
  return { home: await podDirectory(pod, 'home'), workspace: await podDirectory(pod, 'workspace') }
}
export async function podEnvironment(root: string, podId: string, runtime: ShellRuntime): Promise<PodEnvironment> {
  const { home, workspace } = await podDirectories(root, podId)
  const canonical = await realpath(root)
  const temporary = await podDirectory(home, 'tmp')
  const launchers = await podDirectory(canonical, 'shell-launchers'); const scoped = await podDirectory(launchers, podId); const bin = await podDirectory(scoped, 'bin')
  const shell = join(bin, 'ape-shell')
  await writeFile(shell, `#!/bin/sh\nexec /usr/bin/env ELECTRON_RUN_AS_NODE=1 APES_SHELL_MODE=1 ${quoteShell(runtime.executable)} ${quoteShell(runtime.cli)} "$@"\n`, { mode: 0o700 })
  await writeFile(join(bin, 'node'), `#!/bin/sh\nexec /usr/bin/env ELECTRON_RUN_AS_NODE=1 ${quoteShell(runtime.executable)} "$@"\n`, { mode: 0o700 })
  await writeFile(join(bin, 'apes'), `#!/bin/sh\nunset APES_SHELL_MODE APES_SHELL_WRAPPER\nexec /usr/bin/env ELECTRON_RUN_AS_NODE=1 ${quoteShell(runtime.executable)} ${quoteShell(runtime.cli)} "$@"\n`, { mode: 0o700 })
  return { podId, home, workspace, bin, environment: { HOME: home, TMPDIR: temporary, PATH: `${bin}:/usr/bin:/bin`, SHELL: shell, APES_TARGET_HOST: `pods:${podId}`, APES_SHELL_CLEAN_START: '1', APES_IGNORE_USER_CONFIG: '1', APE_WAIT: '1', PODS_POD_ID: podId, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' } }
}
