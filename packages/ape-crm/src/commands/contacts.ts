import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { resolveWorkspaceId } from '../config.ts'
import { info, printJson, printLine } from '../output.ts'

interface Contact { id: string, name: string, email: string | null, org_name: string | null }
interface Organization { id: string, name: string, domain: string | null }

const list = defineCommand({
  meta: { name: 'list', description: 'List contacts.' },
  args: {
    workspace: { type: 'string', description: 'Workspace ULID.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const rows = await apiCall<Contact[]>('GET', '/api/contacts', {
      endpoint: args.endpoint,
      query: { workspace_id: resolveWorkspaceId(args.workspace) },
    })
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No contacts. Create one: ape-crm contacts new --name "..."'); return }
    for (const c of rows) printLine(`${c.id}  ${c.name}${c.org_name ? `  (${c.org_name})` : ''}  ${c.email ?? ''}`)
  },
})

const create = defineCommand({
  meta: { name: 'new', description: 'Create a contact.' },
  args: {
    name: { type: 'string', description: 'Contact name.', required: true },
    email: { type: 'string', description: 'Email address.' },
    phone: { type: 'string', description: 'Phone number.' },
    org: { type: 'string', description: 'Organization ULID.' },
    workspace: { type: 'string', description: 'Workspace ULID.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const c = await apiCall<Contact>('POST', '/api/contacts', {
      endpoint: args.endpoint,
      body: {
        workspace_id: resolveWorkspaceId(args.workspace),
        name: args.name,
        email: args.email,
        phone: args.phone,
        org_id: args.org ?? null,
      },
    })
    if (args.json) { printJson(c); return }
    printLine(`${c.id}  ${c.name}`)
  },
})

const orgs = defineCommand({
  meta: { name: 'orgs', description: 'List organizations; --name creates one.' },
  args: {
    name: { type: 'string', description: 'Create an organization with this name.' },
    domain: { type: 'string', description: 'Domain of the new organization.' },
    workspace: { type: 'string', description: 'Workspace ULID.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const workspaceId = resolveWorkspaceId(args.workspace)
    if (args.name) {
      const o = await apiCall<Organization>('POST', '/api/organizations', {
        endpoint: args.endpoint,
        body: { workspace_id: workspaceId, name: args.name, domain: args.domain },
      })
      if (args.json) { printJson(o); return }
      printLine(`${o.id}  ${o.name}`)
      return
    }

    const rows = await apiCall<Organization[]>('GET', '/api/organizations', {
      endpoint: args.endpoint,
      query: { workspace_id: workspaceId },
    })
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No organizations. Create one: ape-crm contacts orgs --name "..."'); return }
    for (const o of rows) printLine(`${o.id}  ${o.name}  ${o.domain ?? ''}`)
  },
})

export const contactsCommand = defineCommand({
  meta: { name: 'contacts', description: 'People and companies. Bare `contacts` lists people.' },
  subCommands: { list, new: create, orgs },
  args: {
    workspace: { type: 'string', description: 'Workspace ULID.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args, rawArgs }) {
    if (rawArgs.some(a => ['list', 'new', 'orgs'].includes(a))) return
    const rows = await apiCall<Contact[]>('GET', '/api/contacts', {
      endpoint: args.endpoint,
      query: { workspace_id: resolveWorkspaceId(args.workspace) },
    })
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No contacts. Create one: ape-crm contacts new --name "..."'); return }
    for (const c of rows) printLine(`${c.id}  ${c.name}${c.org_name ? `  (${c.org_name})` : ''}  ${c.email ?? ''}`)
  },
})
