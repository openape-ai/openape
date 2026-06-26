import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { resolveEndpoint } from '../client.ts'
import { fmtTime, info, printJson, printLine } from '../output.ts'

interface PrListItem {
  id: string
  title: string
  author: string | null
  branch: string | null
  status: 'pending' | 'reviewed'
  files: number
  additions: number
  deletions: number
  created_at: number
}

interface ReviewPoll {
  state: 'pending' | 'reviewed'
  verdict?: 'approve' | 'request-changes' | 'comment'
  body?: string | null
  comments?: Array<{ path: string, line: number, side: string, body: string, image_path: string | null }>
}

const STATUS_GLYPH = { pending: '○', reviewed: '●' } as const

/** List pull requests, newest first. */
export const listCommand = defineCommand({
  meta: { name: 'list', description: 'List pull requests (newest first).' },
  args: {
    status: { type: 'string', description: 'Filter: pending | reviewed.' },
    limit: { type: 'string', description: 'Max rows (default 50, max 200).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override pr endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    const query: Record<string, string> = {}
    if (args.limit) query.limit = args.limit
    if (args.status) query.status = args.status
    const prs = await apiCall<PrListItem[]>('GET', '/api/prs', { endpoint, query })
    if (args.json) return printJson(prs)
    if (prs.length === 0) return info('No pull requests. Upload one: ape-pr upload ./out')
    for (const pr of prs) {
      printLine(`${STATUS_GLYPH[pr.status]} ${pr.id}  ${pr.title.padEnd(40).slice(0, 40)}  +${pr.additions}/-${pr.deletions}`.padEnd(72) + `  ${fmtTime(pr.created_at)}`)
    }
  },
})

/**
 * Poll a PR's review verdict. Exit 0 once reviewed, exit 3 while still pending
 * (so an agent can loop), or use --wait to block until a verdict lands.
 */
export const statusCommand = defineCommand({
  meta: { name: 'status', description: 'Show/poll a PR review verdict (exit 0 reviewed, 3 pending).' },
  args: {
    handle: { type: 'positional', required: true, description: 'PR slug (from upload) or id.' },
    wait: { type: 'boolean', description: 'Block, polling until a verdict lands.' },
    interval: { type: 'string', description: 'Poll interval seconds with --wait (default 15).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override pr endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    const intervalMs = Math.max(2, Number(args.interval) || 15) * 1000

    const poll = () => apiCall<ReviewPoll>('GET', `/api/prs/${args.handle}/review`, { endpoint })
    let review = await poll()
    while (args.wait && review.state !== 'reviewed') {
      info(`pending — polling again in ${intervalMs / 1000}s…`)
      await new Promise(r => setTimeout(r, intervalMs))
      review = await poll()
    }

    if (args.json) {
      printJson(review)
    }
    else if (review.state === 'reviewed') {
      printLine(`verdict: ${review.verdict}`)
      if (review.body) printLine(review.body)
      for (const c of review.comments ?? []) printLine(`  ${c.path}:${c.line} (${c.side}) — ${c.body}`)
    }
    else {
      printLine('pending')
    }
    process.exit(review.state === 'reviewed' ? 0 : 3)
  },
})

/** Delete a PR (uploader only) — the review link stops working. */
export const rmCommand = defineCommand({
  meta: { name: 'rm', description: 'Delete a PR (the review link stops working).' },
  args: {
    id: { type: 'positional', required: true, description: 'PR id.' },
    endpoint: { type: 'string', description: 'Override pr endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    await apiCall('DELETE', `/api/prs/${args.id}`, { endpoint })
    info(`PR ${args.id} deleted.`)
  },
})
