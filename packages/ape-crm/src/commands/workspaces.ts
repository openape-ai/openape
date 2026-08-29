import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { setActiveWorkspaceId } from '../config.ts'
import { info, printJson, printLine } from '../output.ts'

interface Workspace { id: string, name: string, role: string }

const list = defineCommand({
  meta: { name: 'list', description: 'List workspaces you are a member of.' },
  args: {
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const rows = await apiCall<Workspace[]>('GET', '/api/workspaces', { endpoint: args.endpoint })
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No workspaces. Create one: ape-crm workspaces new --name "..."'); return }
    for (const w of rows) printLine(`${w.id}  ${w.name}  (${w.role})`)
  },
})

const create = defineCommand({
  meta: { name: 'new', description: 'Create a workspace (you become owner).' },
  args: {
    name: { type: 'string', description: 'Workspace name.', required: true },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const w = await apiCall<Workspace>('POST', '/api/workspaces', {
      endpoint: args.endpoint,
      body: { name: args.name },
    })
    setActiveWorkspaceId(w.id)
    if (args.json) { printJson(w); return }
    printLine(`${w.id}  ${w.name}  (owner)`)
    info('Set as your default workspace.')
  },
})

const use = defineCommand({
  meta: { name: 'use', description: 'Set the default workspace for subsequent commands.' },
  args: { id: { type: 'positional', required: true, description: 'Workspace ULID.' } },
  run({ args }) {
    setActiveWorkspaceId(args.id)
    info(`Default workspace set to ${args.id}`)
  },
})

const invite = defineCommand({
  meta: { name: 'invite', description: 'Create a shareable invite link (manager or owner).' },
  args: {
    id: { type: 'positional', required: true, description: 'Workspace ULID.' },
    role: { type: 'string', description: 'manager|member (default member).' },
    'max-uses': { type: 'string', description: 'Max uses (default 5).' },
    days: { type: 'string', description: 'Valid for N days (default 7).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const body: Record<string, unknown> = { role: args.role ?? 'member' }
    if (args['max-uses']) body.max_uses = Number(args['max-uses'])
    if (args.days) body.days = Number(args.days)
    const r = await apiCall<{ url: string, role: string, expires_at: number }>(
      'POST',
      `/api/workspaces/${args.id}/invites`,
      { endpoint: args.endpoint, body },
    )
    if (args.json) { printJson(r); return }
    printLine(r.url)
    info(`role=${r.role}  expires_at=${r.expires_at}`)
  },
})

export const workspacesCommand = defineCommand({
  meta: { name: 'workspaces', description: 'Manage workspaces. Bare `workspaces` lists them.' },
  subCommands: { list, new: create, use, invite },
  args: {
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args, rawArgs }) {
    // citty calls the parent command when no subcommand matches. Default = list.
    if (rawArgs.some(a => ['list', 'new', 'use', 'invite'].includes(a))) return
    const rows = await apiCall<Workspace[]>('GET', '/api/workspaces', { endpoint: args.endpoint })
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No workspaces. Create one: ape-crm workspaces new --name "..."'); return }
    for (const w of rows) printLine(`${w.id}  ${w.name}  (${w.role})`)
  },
})
