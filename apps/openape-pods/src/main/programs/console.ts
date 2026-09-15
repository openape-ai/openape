import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { ConsoleView, ProgramAssignment } from '../../contracts/programs'
import { parseCommandLine } from '../../contracts/programs'
import type { ResourceState } from '../../contracts/resources'
import { verifyExecutable } from '../../worker/runtime/sandbox'

export async function podWorkspace(root: string, podId: string): Promise<string> {
  if (!/^[a-f0-9-]{36}$/.test(podId)) throw new Error('Invalid pod workspace identity')
  let directory = await realpath(root)
  for (const part of ['pods', podId, 'workspace']) {
    directory = join(directory, part)
    try { await mkdir(directory, { mode: 0o700 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const info = await lstat(directory)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Pod workspace cannot contain symbolic directory links')
  }
  return directory
}

export async function prepareConsole(root: string, podId: string, state: ResourceState, line: string): Promise<ConsoleView> {
  const workspace = await podWorkspace(root, podId)
  const result: ConsoleView = { workspace, output: '', command: null, needsGrant: false, permission: null }
  const applications = state.resources.filter(item => item.podId === podId && item.kind === 'tool' && item.state === 'ready' && item.configuration.type === 'program')
  if (!line.trim() || line.trim() === 'help') return { ...result, output: applications.map(item => String(item.configuration.cliId)).join('\n') }
  const [name, ...argv] = parseCommandLine(line)
  if (name === 'pwd' && !argv.length) return { ...result, output: workspace }
  const candidates = applications.filter(item => item.configuration.cliId === name)
  if (candidates.length > 1) throw new Error('Application command is ambiguous; remove the duplicate assignment in Permissions')
  const resource = candidates[0]
  if (!resource) throw new Error('Command is not assigned to this pod. Enter help to list available applications.')
  const assignment = resource.configuration as unknown as ProgramAssignment
  await verifyExecutable(assignment.adapterPath, assignment.adapterHash)
  const adapter = loadAdapter(assignment.cliId, assignment.adapterPath)
  if (!argv.length || (argv.length === 1 && ['--help', '-h'].includes(argv[0]!))) {
    return { ...result, output: adapter.adapter.operations.map(operation => [name, ...operation.command, ...(operation.required_options ?? []).flatMap(option => [`--${option.replace(/^--/, '')}`, `<${option.replace(/^--/, '')}>`])].join(' ')).join('\n') }
  }
  const resolved = await resolveCommand(adapter, [assignment.cliId, ...argv])
  return { ...result, command: { type: 'start', podId, applicationId: resource.id, epoch: state.epoch, argv }, needsGrant: !assignment.grants.some(grant => grant.permission === resolved.permission), permission: resolved.permission }
}
