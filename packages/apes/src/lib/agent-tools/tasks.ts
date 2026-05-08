import { execFileSync } from 'node:child_process'
import type { ToolDefinition } from './index'

// Shell out to the user's `ape-tasks` CLI. The agent's macOS user
// has its own ~/.config/apes/auth.json, so the CLI talks to
// tasks.openape.ai as the agent's owner via the agent JWT (which
// carries the owner-domain). For v1 we don't require a separate
// agent identity for tasks — the tasks CLI authenticates with the
// same auth.json the runtime uses.

function ape(args: string[]): string {
  try {
    return execFileSync('ape-tasks', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  }
  catch (err) {
    const e = err as { stderr?: Buffer | string, message?: string }
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf8')
    throw new Error(`ape-tasks failed: ${stderr ?? e.message ?? err}`)
  }
}

export const tasksTools: ToolDefinition[] = [
  {
    name: 'tasks.list',
    description: 'List the owner\'s open ape-tasks (the user\'s personal task list at tasks.openape.ai).',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'doing', 'done', 'archived'] },
        team_id: { type: 'string' },
      },
      required: [],
    },
    execute: async (args: unknown) => {
      const a = (args as { status?: string, team_id?: string }) ?? {}
      const argv = ['list', '--json']
      if (a.status) argv.push('--status', a.status)
      if (a.team_id) argv.push('--team', a.team_id)
      const out = ape(argv)
      try { return JSON.parse(out) }
      catch { return { raw: out } }
    },
  },
  {
    name: 'tasks.create',
    description: 'Create a new ape-task on the owner\'s task list at tasks.openape.ai.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'med', 'high'] },
        due_at: { type: 'string', description: 'ISO date or +Nh/+Nd shorthand.' },
      },
      required: ['title'],
    },
    execute: async (args: unknown) => {
      const a = args as { title: string, notes?: string, priority?: string, due_at?: string }
      const argv = ['new', '--title', a.title, '--json']
      if (a.notes) argv.push('--notes', a.notes)
      if (a.priority) argv.push('--priority', a.priority)
      if (a.due_at) argv.push('--due', a.due_at)
      const out = ape(argv)
      try { return JSON.parse(out) }
      catch { return { raw: out } }
    },
  },
]
