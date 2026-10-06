import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { resolveWorkspaceId } from '../config.ts'
import { info, printJson, printLine } from '../output.ts'

interface Stage { key: string, name: string, outcome: 'open' | 'won' | 'lost', position: number }

/**
 * Stages are configurable per workspace — without this command a user would
 * not know the keys that `deals move` expects.
 */
export const stagesCommand = defineCommand({
  meta: { name: 'stages', description: 'List the pipeline stages of a workspace.' },
  args: {
    workspace: { type: 'string', description: 'Workspace ULID (default: the one set via `workspaces use`).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const rows = await apiCall<Stage[]>('GET', '/api/stages', {
      endpoint: args.endpoint,
      query: { workspace_id: resolveWorkspaceId(args.workspace) },
    })
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No stages in this workspace.'); return }
    for (const s of rows) printLine(`${s.key.padEnd(16)} ${s.name.padEnd(24)} ${s.outcome}`)
  },
})
