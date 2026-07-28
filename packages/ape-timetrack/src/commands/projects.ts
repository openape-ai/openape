import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { resolveCompanyId, setActiveProjectId } from '../config.ts'
import { info, printJson, printLine } from '../output.ts'

const list = defineCommand({
  meta: { name: 'list', description: 'List projects in a company you can see.' },
  args: {
    company: { type: 'string', description: 'Company ULID (or use default).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const company = resolveCompanyId(args.company, args.endpoint)
    const rows = await apiCall<Array<{ id: string, name: string, role: string | null }>>(
      'GET', '/api/projects', { endpoint: args.endpoint, query: { company } },
    )
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No visible projects in this company.'); return }
    for (const p of rows) printLine(`${p.id}  ${p.name}  (${p.role ?? 'via company'})`)
  },
})

const create = defineCommand({
  meta: { name: 'new', description: 'Create a project under a company (company owner only).' },
  args: {
    name: { type: 'string', description: 'Project name.', required: true },
    company: { type: 'string', description: 'Company ULID (or use default).' },
    description: { type: 'string', description: 'Optional description.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const company = resolveCompanyId(args.company, args.endpoint)
    const body: Record<string, unknown> = { company_id: company, name: args.name }
    if (args.description) body.description = args.description
    const p = await apiCall<{ id: string, name: string }>(
      'POST', '/api/projects', { endpoint: args.endpoint, body },
    )
    if (args.json) { printJson(p); return }
    printLine(`${p.id}  ${p.name}  (manager)`)
  },
})

const use = defineCommand({
  meta: { name: 'use', description: 'Set the default project for subsequent commands.' },
  args: {
    id: { type: 'positional', required: true, description: 'Project ULID.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    setActiveProjectId(args.id, args.endpoint)
    info(`Default project set to ${args.id}`)
  },
})

const invite = defineCommand({
  meta: { name: 'invite', description: 'Create a shareable project invite (company owner or project manager).' },
  args: {
    id: { type: 'positional', required: true, description: 'Project ULID.' },
    role: { type: 'string', description: 'manager|member (default member).' },
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
      'POST', `/api/projects/${args.id}/invite`, { endpoint: args.endpoint, body },
    )
    if (args.json) { printJson(r); return }
    printLine(r.url)
    info(`role=${r.role}  expires_at=${r.expires_at}`)
  },
})

export const projectsCommand = defineCommand({
  meta: { name: 'projects', description: 'Manage projects. Bare `projects` lists them (needs default company).' },
  subCommands: { list, new: create, use, invite },
  args: {
    company: { type: 'string', description: 'Company ULID (or use default).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args, rawArgs }) {
    if (rawArgs.some(a => ['list', 'new', 'use', 'invite'].includes(a))) return
    const company = resolveCompanyId(args.company, args.endpoint)
    const rows = await apiCall<Array<{ id: string, name: string, role: string | null }>>(
      'GET', '/api/projects', { endpoint: args.endpoint, query: { company } },
    )
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No visible projects in this company.'); return }
    for (const p of rows) printLine(`${p.id}  ${p.name}  (${p.role ?? 'via company'})`)
  },
})
