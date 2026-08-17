import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { resolveWorkspaceId } from '../config.ts'
import { info, printJson, printLine } from '../output.ts'

interface Deal {
  id: string
  title: string
  value_cents: number
  stage: string
  contact_name: string | null
  org_name: string | null
}

const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost']

function formatDeal(d: Deal): string {
  const who = [d.contact_name, d.org_name].filter(Boolean).join(', ')
  const euro = (d.value_cents / 100).toFixed(0)
  return `${d.id}  ${d.stage.padEnd(9)} ${euro.padStart(8)} €  ${d.title}${who ? `  (${who})` : ''}`
}

const list = defineCommand({
  meta: { name: 'list', description: 'List deals, optionally filtered by stage.' },
  args: {
    workspace: { type: 'string', description: 'Workspace ULID (default: the one set via `workspaces use`).' },
    stage: { type: 'string', description: `Only this stage (${STAGES.join('|')}).` },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const rows = await apiCall<Deal[]>('GET', '/api/deals', {
      endpoint: args.endpoint,
      query: { workspace_id: resolveWorkspaceId(args.workspace) },
    })
    const filtered = args.stage ? rows.filter(d => d.stage === args.stage) : rows
    if (args.json) { printJson(filtered); return }
    if (filtered.length === 0) { info('No deals. Create one: ape-crm deals new --title "..."'); return }
    for (const d of filtered) printLine(formatDeal(d))
  },
})

const create = defineCommand({
  meta: { name: 'new', description: 'Create a deal.' },
  args: {
    title: { type: 'string', description: 'Deal title.', required: true },
    value: { type: 'string', description: 'Value in EUR (default 0).' },
    stage: { type: 'string', description: `Stage (default lead): ${STAGES.join('|')}.` },
    contact: { type: 'string', description: 'Contact ULID.' },
    org: { type: 'string', description: 'Organization ULID.' },
    workspace: { type: 'string', description: 'Workspace ULID.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const d = await apiCall<Deal>('POST', '/api/deals', {
      endpoint: args.endpoint,
      body: {
        workspace_id: resolveWorkspaceId(args.workspace),
        title: args.title,
        value_cents: Math.round(Number(args.value ?? 0) * 100),
        stage: args.stage ?? 'lead',
        contact_id: args.contact ?? null,
        org_id: args.org ?? null,
      },
    })
    if (args.json) { printJson(d); return }
    printLine(`${d.id}  ${d.stage}  ${d.title}`)
  },
})

const move = defineCommand({
  meta: { name: 'move', description: 'Move a deal to another stage.' },
  args: {
    id: { type: 'positional', required: true, description: 'Deal ULID.' },
    stage: { type: 'positional', required: true, description: STAGES.join('|') },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const d = await apiCall<Deal>('PATCH', `/api/deals/${args.id}`, {
      endpoint: args.endpoint,
      body: { stage: args.stage },
    })
    if (args.json) { printJson(d); return }
    printLine(`${args.id} → ${args.stage}`)
  },
})

const rm = defineCommand({
  meta: { name: 'rm', description: 'Delete a deal and its notes.' },
  args: {
    id: { type: 'positional', required: true, description: 'Deal ULID.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    await apiCall('DELETE', `/api/deals/${args.id}`, { endpoint: args.endpoint })
    info(`deleted ${args.id}`)
  },
})

export const dealsCommand = defineCommand({
  meta: { name: 'deals', description: 'Deals in the pipeline. Bare `deals` lists them.' },
  subCommands: { list, new: create, move, rm },
  args: {
    workspace: { type: 'string', description: 'Workspace ULID.' },
    stage: { type: 'string', description: 'Filter by stage.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args, rawArgs }) {
    if (rawArgs.some(a => ['list', 'new', 'move', 'rm'].includes(a))) return
    const rows = await apiCall<Deal[]>('GET', '/api/deals', {
      endpoint: args.endpoint,
      query: { workspace_id: resolveWorkspaceId(args.workspace) },
    })
    const filtered = args.stage ? rows.filter(d => d.stage === args.stage) : rows
    if (args.json) { printJson(filtered); return }
    if (filtered.length === 0) { info('No deals. Create one: ape-crm deals new --title "..."'); return }
    for (const d of filtered) printLine(formatDeal(d))
  },
})
