import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { resolveWorkspaceId } from '../config.ts'
import { info, printJson, printLine } from '../output.ts'

interface Deal {
  id: string
  title: string
  value_cents: number
  phase: string
  stufe: string
  contact_name: string | null
  org_name: string | null
}

function formatDeal(d: Deal): string {
  const who = [d.contact_name, d.org_name].filter(Boolean).join(', ')
  const euro = (d.value_cents / 100).toFixed(0)
  return `${d.id}  ${d.phase.padEnd(5)} ${d.stufe.padEnd(16)} ${euro.padStart(8)} €  ${d.title}${who ? `  (${who})` : ''}`
}

const list = defineCommand({
  meta: { name: 'list', description: 'List deals, optionally filtered by phase or stufe.' },
  args: {
    workspace: { type: 'string', description: 'Workspace ULID (default: the one set via `workspaces use`).' },
    phase: { type: 'string', description: 'lead | deal | kunde' },
    stufe: { type: 'string', description: 'Only this stufe key — see `ape-crm stages`.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const rows = await apiCall<Deal[]>('GET', '/api/deals', {
      endpoint: args.endpoint,
      query: { workspace_id: resolveWorkspaceId(args.workspace) },
    })
    const filtered = rows.filter(d => (!args.phase || d.phase === args.phase) && (!args.stufe || d.stufe === args.stufe))
    if (args.json) { printJson(filtered); return }
    if (filtered.length === 0) { info('No deals. Create one: ape-crm deals new --title "..."'); return }
    for (const d of filtered) printLine(formatDeal(d))
  },
})

const create = defineCommand({
  meta: { name: 'new', description: 'Create a deal (Vorgang). Default phase is lead / kalt.' },
  args: {
    title: { type: 'string', description: 'Deal title.', required: true },
    value: { type: 'string', description: 'Value in EUR (default 0).' },
    phase: { type: 'string', description: 'lead | deal | kunde (default lead).' },
    stufe: { type: 'string', description: 'Stufe key — see `ape-crm stages`.' },
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
        phase: args.phase,
        stufe: args.stufe,
        contact_id: args.contact ?? null,
        org_id: args.org ?? null,
      },
    })
    if (args.json) { printJson(d); return }
    printLine(`${d.id}  ${d.phase}  ${d.stufe}  ${d.title}`)
  },
})

const move = defineCommand({
  meta: { name: 'move', description: 'Move a deal to another stufe (endmarkers may change phase).' },
  args: {
    id: { type: 'positional', required: true, description: 'Deal ULID.' },
    stufe: { type: 'positional', required: true, description: 'Stufe key — see `ape-crm stages`.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const d = await apiCall<Deal>('PATCH', `/api/deals/${args.id}`, {
      endpoint: args.endpoint,
      body: { stufe: args.stufe },
    })
    if (args.json) { printJson(d); return }
    printLine(`${args.id} → ${d.phase}/${d.stufe}`)
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
    phase: { type: 'string', description: 'Filter by phase.' },
    stufe: { type: 'string', description: 'Filter by stufe.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args, rawArgs }) {
    if (rawArgs.some(a => ['list', 'new', 'move', 'rm'].includes(a))) return
    const rows = await apiCall<Deal[]>('GET', '/api/deals', {
      endpoint: args.endpoint,
      query: { workspace_id: resolveWorkspaceId(args.workspace) },
    })
    const filtered = rows.filter(d => (!args.phase || d.phase === args.phase) && (!args.stufe || d.stufe === args.stufe))
    if (args.json) { printJson(filtered); return }
    if (filtered.length === 0) { info('No deals. Create one: ape-crm deals new --title "..."'); return }
    for (const d of filtered) printLine(formatDeal(d))
  },
})
