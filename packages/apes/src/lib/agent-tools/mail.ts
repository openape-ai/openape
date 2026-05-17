import { execFileSync } from 'node:child_process'
import type { ToolDefinition } from './index'

// Shell out to o365-cli for read-only mail access. Same auth model
// as ape-tasks: the agent's macOS user has o365-cli installed +
// authenticated, agent runs as that user.

function o365(args: string[]): string {
  try {
    return execFileSync('o365-cli', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  }
  catch (err) {
    const e = err as { stderr?: Buffer | string, code?: string, message?: string }
    if (e.code === 'ENOENT') {
      throw new Error('o365-cli is not installed on this agent host')
    }
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf8')
    throw new Error(`o365-cli failed: ${stderr ?? e.message ?? err}`)
  }
}

export const mailTools: ToolDefinition[] = [
  {
    name: 'mail.list',
    description: 'List recent inbox messages via o365-cli. Optional `unread_only` and `limit`.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        unread_only: { type: 'boolean', default: false },
      },
      required: [],
    },
    execute: async (args: unknown) => {
      const a = (args as { limit?: number, unread_only?: boolean }) ?? {}
      const argv = ['mail', 'list', '--json', '--limit', String(a.limit ?? 20)]
      if (a.unread_only) argv.push('--unread')
      const out = o365(argv)
      try { return JSON.parse(out) }
      catch { return { raw: out } }
    },
  },
  {
    name: 'mail.search',
    description: 'Search the inbox via o365-cli using a free-form query string.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['q'],
    },
    execute: async (args: unknown) => {
      const a = args as { q: string, limit?: number }
      if (typeof a.q !== 'string' || a.q.length === 0) throw new Error('q is required')
      const argv = ['mail', 'search', a.q, '--json', '--limit', String(a.limit ?? 20)]
      const out = o365(argv)
      try { return JSON.parse(out) }
      catch { return { raw: out } }
    },
  },
]
