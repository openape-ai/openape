import { parseArgs } from 'node:util'

export class UsageError extends Error {}
export interface CliArguments {
  command: 'list' | 'run' | 'create' | 'edit' | 'agent-backends'
  id?: string
  profile?: string
  name?: string
  tags?: string[]
  lifecycle?: 'active' | 'paused' | 'archived'
  script?: string
  json: boolean
}

export const cliHelp = `ape-pods — local Pod development

  ape-pods list [--json]
  ape-pods run <id> [--json]
  ape-pods create [--name NAME] [--tags a,b] [--script pod-script.mjs]
  ape-pods edit [<id>] [--name NAME] [--tags a,b] [--lifecycle STATE] [--script pod-script.mjs]
  ape-pods agent-backends [status|reload|disable] [--json]

Options: --profile PATH, --json, --help
An empty --tags value clears tags. create/edit prompt only in a terminal.
Uses the real selected desktop profile by default. Close the desktop first.
run waits for completion; Ctrl+C cancels. No schedules or sibling Pods start.
Existing identity, grants and private workspace files apply.
Additional assigned script secrets are not supported in this version.
`

export function cliArguments(argv: string[]): CliArguments {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        profile: { type: 'string' },
        name: { type: 'string' },
        tags: { type: 'string' },
        lifecycle: { type: 'string' },
        script: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    })
  }
  catch (error) { throw new UsageError((error as Error).message) }
  const [command, id, ...extra] = parsed.positionals
  if (!['list', 'run', 'create', 'edit', 'agent-backends'].includes(command ?? '') || extra.length) throw new UsageError('Expected list, run <id>, create, edit <id> or agent-backends; see --help')
  if (command === 'agent-backends' && id && !['status', 'reload', 'disable'].includes(id)) throw new UsageError('agent-backends accepts status, reload or disable')
  if ((command === 'list' || command === 'create') && id) throw new UsageError(`${command} does not accept an ID`)
  if (command === 'run' && !id) throw new UsageError('run requires a Pod ID')
  const { values } = parsed
  if (command === 'list' || command === 'run' || command === 'agent-backends') {
    if (['name', 'tags', 'lifecycle', 'script'].some(key => values[key] !== undefined)) throw new UsageError(`${command} does not accept edit options`)
  }
  if (command === 'create' && values.lifecycle !== undefined) throw new UsageError('create always creates a paused Pod')
  if (values.lifecycle !== undefined && !['active', 'paused', 'archived'].includes(String(values.lifecycle))) throw new UsageError('lifecycle must be active, paused or archived')
  if (values.profile === '' || values.script === '' || values.name === '') throw new UsageError('profile, script and name must not be empty')
  return { command: command as CliArguments['command'], ...(id ? { id } : {}), profile: values.profile as string | undefined, name: values.name as string | undefined, tags: values.tags === undefined ? undefined : String(values.tags).split(',').map(tag => tag.trim()).filter(Boolean), lifecycle: values.lifecycle as CliArguments['lifecycle'], script: values.script as string | undefined, json: values.json === true }
}
