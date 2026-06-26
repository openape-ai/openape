import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { setActiveCompanyId } from '../config.ts'
import { info, printJson, printLine } from '../output.ts'

const list = defineCommand({
  meta: { name: 'list', description: 'List companies you can see.' },
  args: {
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const rows = await apiCall<Array<{ id: string, name: string, role: string | null }>>(
      'GET', '/api/companies', { endpoint: args.endpoint },
    )
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No companies. Create one: ape-timetrack companies new --name "..."'); return }
    for (const c of rows) printLine(`${c.id}  ${c.name}  (${c.role ?? 'via project'})`)
  },
})

const create = defineCommand({
  meta: { name: 'new', description: 'Create a company (you become owner).' },
  args: {
    name: { type: 'string', description: 'Company name.', required: true },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const c = await apiCall<{ id: string, name: string }>(
      'POST', '/api/companies', { endpoint: args.endpoint, body: { name: args.name } },
    )
    if (args.json) { printJson(c); return }
    printLine(`${c.id}  ${c.name}  (owner)`)
  },
})

const use = defineCommand({
  meta: { name: 'use', description: 'Set the default company for subsequent commands.' },
  args: {
    id: { type: 'positional', required: true, description: 'Company ULID.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    setActiveCompanyId(args.id, args.endpoint)
    info(`Default company set to ${args.id}`)
  },
})

const invite = defineCommand({
  meta: { name: 'invite', description: 'Create a shareable company invite (owner only).' },
  args: {
    id: { type: 'positional', required: true, description: 'Company ULID.' },
    role: { type: 'string', description: 'owner|manager|member (default member).' },
    'max-uses': { type: 'string', description: 'Max uses (default 5).' },
    'expires-in': { type: 'string', description: 'e.g. 7d, 24h (default 7d).' },
    note: { type: 'string', description: 'Optional note.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const body: Record<string, unknown> = { role: args.role ?? 'member' }
    if (args['max-uses']) body.max_uses = Number(args['max-uses'])
    if (args['expires-in']) body.expires_in = args['expires-in']
    if (args.note) body.note = args.note
    const r = await apiCall<{ url: string, role: string, expires_at: number }>(
      'POST', `/api/companies/${args.id}/invite`, { endpoint: args.endpoint, body },
    )
    if (args.json) { printJson(r); return }
    printLine(r.url)
    info(`role=${r.role}  expires_at=${r.expires_at}`)
  },
})

export const companiesCommand = defineCommand({
  meta: { name: 'companies', description: 'Manage companies. Bare `companies` lists them.' },
  subCommands: { list, new: create, use, invite },
  args: {
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args, rawArgs }) {
    // citty runs the parent when no subcommand matched. Default = list.
    if (rawArgs.some(a => ['list', 'new', 'use', 'invite'].includes(a))) return
    const rows = await apiCall<Array<{ id: string, name: string, role: string | null }>>(
      'GET', '/api/companies', { endpoint: args.endpoint },
    )
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No companies. Create one: ape-timetrack companies new --name "..."'); return }
    for (const c of rows) printLine(`${c.id}  ${c.name}  (${c.role ?? 'via project'})`)
  },
})
