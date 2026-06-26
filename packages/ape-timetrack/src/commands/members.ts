import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { printJson, printLine } from '../output.ts'

/**
 * Show role membership for a company or a project.
 *   ape-timetrack members --company <id>
 *   ape-timetrack members --project <id>
 */
export const membersCommand = defineCommand({
  meta: { name: 'members', description: 'List members + roles of a company or project.' },
  args: {
    company: { type: 'string', description: 'Company ULID.' },
    project: { type: 'string', description: 'Project ULID.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const query: Record<string, string> = {}
    if (args.company) query.company = args.company
    if (args.project) query.project = args.project
    const r = await apiCall<{ scope: string, members: Array<{ user_email: string, role: string }> }>(
      'GET', '/api/members', { endpoint: args.endpoint, query },
    )
    if (args.json) { printJson(r); return }
    printLine(`${r.scope} members:`)
    for (const m of r.members) printLine(`  ${m.user_email}  ${m.role}`)
  },
})
