import { podDirectories } from '../../runtime/environment'
import type { ConsoleView } from '../../contracts/programs'
import { parseCommandLine } from '../../contracts/programs'
import type { ResourceState } from '../../contracts/resources'

export async function podWorkspace(root: string, podId: string): Promise<string> {
  return (await podDirectories(root, podId)).workspace
}

/**
 * Resolves a terminal line to an assigned application and its exact arguments. Whether the command needs a new
 * approval is decided by the IdP when it starts (issue 1473): a pending approval is shown in the terminal session.
 */
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
  if (!argv.length) return { ...result, output: `Enter ${name} with its arguments, for example ${name} --help.` }
  return { ...result, command: { type: 'start', podId, applicationId: resource.id, epoch: state.epoch, argv } }
}
