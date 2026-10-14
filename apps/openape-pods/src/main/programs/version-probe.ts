import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { ProgramDefinition } from '../../contracts/programs'
import { launchSandbox } from '../../worker/runtime/sandbox'
import { programLaunch } from './runtime'

/** Runs an executable with the adapter's version arguments; null when it exits unsuccessfully, times out or prints too much. */
export type VersionProbe = (definition: ProgramDefinition, command: string[]) => Promise<string | null>

export const probeTimeoutMs = 10000
export const probeOutputLimit = 64 * 1024

/**
 * Variables that make interpreters, loaders or shells run additional code. A version probe never passes them,
 * whatever the program's runtime descriptor sets.
 */
const codeInjecting = /^(?:DYLD_|LD_|NODE_|PYTHON|PERL|RUBY|GEM_|BUNDLE_|JAVA_TOOL_OPTIONS$|_JAVA_OPTIONS$|JDK_JAVA_OPTIONS$|CLASSPATH$|BASH_ENV$|ENV$|ZDOTDIR$|PROMPT_COMMAND$|SHELLOPTS$|PS4$|IFS$|LUA_|TCL|GCONV_PATH$|MALLOC_|ELECTRON_|GIT_|AZURE_CONFIG_DIR$)/

/** The program's environment without code-injecting variables, with a fixed locale and system PATH. */
export function probeEnvironment(environment: Record<string, string>): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(environment).filter(([key]) => !codeInjecting.test(key)))
  return { ...kept, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }
}

const broadFolders = ['/', '/usr', '/Users', '/Library', '/Applications', '/opt', '/opt/homebrew', '/usr/local', homedir()]

/**
 * The installation folder of an executable, readable during the probe: a CLI reads its own configuration and data
 * there (git its system gitconfig below `usr/share`). It is the folder above `bin` outside the owner's home, otherwise
 * the executable's folder, and never a system, home or package-manager root.
 */
export function installation(executable: string): string[] {
  const folder = dirname(executable)
  const prefix = basename(folder) === 'bin' && !folder.startsWith(`${homedir()}/`) ? dirname(folder) : folder
  return broadFolders.includes(prefix) ? [] : [prefix]
}

/**
 * Probes the version inside the Pods native sandbox at the isolated level, whatever the Pod's level: a fresh temporary
 * folder is the working directory and HOME, the program reaches no network, no owner files and no Pod folders, and
 * only its executable, entry files and runtime directories are readable. The output is capped and the run times out.
 */
export function sandboxVersionProbe(helper: string, scratch: string, launch: typeof launchSandbox = launchSandbox): VersionProbe {
  return async (definition, command) => {
    await mkdir(scratch, { recursive: true, mode: 0o700 })
    const directory = await mkdtemp(join(scratch, 'probe-'))
    try {
      const program = programLaunch(definition)
      const runtimeDirectories = [...new Set([...program.runtimeDirectories, ...installation(program.executable)])]
      const domain = await launch(helper, directory, { executable: program.executable, workspace: directory, readFiles: definition.entryFiles.map(file => file.path), runtimeDirectories, networkPorts: [] }, [...program.prefix, ...command], probeEnvironment(program.environment))
      const chunks: Buffer[] = []
      let size = 0
      let refused = false
      const collect = (bytes: Buffer) => {
        size += bytes.length
        if (size > probeOutputLimit) { refused = true; domain.cancel(); return }
        chunks.push(bytes)
      }
      domain.stdout.on('data', collect)
      domain.stderr.on('data', collect)
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(resolve, probeTimeoutMs, 'timeout') })
      const outcome = await Promise.race([domain.completed, timeout])
      clearTimeout(timer)
      if (outcome === 'timeout') { domain.cancel(); await domain.completed; return null }
      return outcome === 0 && !refused ? Buffer.concat(chunks).toString('utf8') : null
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  }
}
