import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { resolveEndpoint } from '../client.ts'
import { fmtTime, info, printJson, printLine } from '../output.ts'

interface RunListItem {
  id: string
  slug: string
  url: string
  title: string
  project: string | null
  status: 'passed' | 'failed' | 'skipped'
  passed: number
  failed: number
  skipped: number
  created_by: string
  created_by_act: 'human' | 'agent'
  created_at: number
}

const STATUS_GLYPH = { passed: '✓', failed: '✗', skipped: '–' } as const

/**
 * List your runs, newest first.
 *
 * EXAMPLE
 *   $ ape-testruns list
 *   ✗ 01JX…  Login flow E2E        2 passed 1 failed   2026-06-12 14:02  https://testrun.openape.ai/r/8fK2…
 */
export const listCommand = defineCommand({
  meta: { name: 'list', description: 'List your uploaded test runs (newest first).' },
  args: {
    limit: { type: 'string', description: 'Max rows (default 50, max 200).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override testrun endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    const runs = await apiCall<RunListItem[]>('GET', '/api/runs', {
      endpoint,
      query: args.limit ? { limit: args.limit } : undefined,
    })
    if (args.json) {
      printJson(runs)
      return
    }
    if (runs.length === 0) {
      info('No runs yet. Upload one: ape-testruns upload ./out')
      return
    }
    for (const run of runs) {
      const counts = `${run.passed} passed ${run.failed} failed${run.skipped ? ` ${run.skipped} skipped` : ''}`
      printLine(`${STATUS_GLYPH[run.status]} ${run.id}  ${run.title.padEnd(36).slice(0, 36)}  ${counts.padEnd(24)}  ${fmtTime(run.created_at)}  ${run.url}`)
    }
  },
})

/**
 * Show one run as JSON (manifest + uploaded assets + share URL).
 */
export const showCommand = defineCommand({
  meta: { name: 'show', description: 'Show one run (JSON: manifest, assets, share URL).' },
  args: {
    id: { type: 'positional', required: true, description: 'Run ULID.' },
    endpoint: { type: 'string', description: 'Override testrun endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    printJson(await apiCall('GET', `/api/runs/${args.id}`, { endpoint }))
  },
})

/**
 * Delete a run — the share link stops working immediately.
 */
export const rmCommand = defineCommand({
  meta: { name: 'rm', description: 'Delete a run (the share link stops working).' },
  args: {
    id: { type: 'positional', required: true, description: 'Run ULID.' },
    endpoint: { type: 'string', description: 'Override testrun endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    await apiCall('DELETE', `/api/runs/${args.id}`, { endpoint })
    info(`Run ${args.id} deleted.`)
  },
})
