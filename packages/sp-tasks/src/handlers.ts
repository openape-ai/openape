import type { H3Event } from 'h3'
import type { SpTaskDb } from './queue'
import type { Artifact, Message, TaskState } from './types'
import { createError, defineEventHandler, readBody } from 'h3'
import { DEFAULT_LEASE_MS, leaseNextTask, resolveTask, SpTaskError } from './queue'

// h3 route factories for the two SP-side endpoints a service-agent talks to.
// The SP supplies its own DB handle and an auth resolver (typically
// nuxt-auth-sp `requireCaller` narrowed to the one bound service-agent).

export interface SpTaskHandlerOptions {
  db: SpTaskDb | (() => SpTaskDb)
  /** Resolve the calling service-agent's identity; return null to deny (401). */
  resolveAgent: (event: H3Event) => Promise<string | null> | string | null
  leaseMs?: number
  /** Clock injection for tests; defaults to `Date.now`. */
  now?: () => number
}

interface ResolveBody {
  id: string
  state: TaskState
  artifact?: Artifact
  statusMessage?: Message
}

function resolveDb(db: SpTaskHandlerOptions['db']): SpTaskDb {
  return typeof db === 'function' ? db() : db
}

async function requireAgent(opts: SpTaskHandlerOptions, event: H3Event): Promise<string> {
  const agent = await opts.resolveAgent(event)
  if (!agent)
    throw createError({ statusCode: 401, statusMessage: 'Service-agent identity required' })
  return agent
}

/** `GetNextTask` — the worker long-polls this to claim one task (or `{task:null}`). */
export function defineGetNextTaskHandler(opts: SpTaskHandlerOptions) {
  const now = opts.now ?? (() => Date.now())
  return defineEventHandler(async (event) => {
    const agent = await requireAgent(opts, event)
    const task = await leaseNextTask(resolveDb(opts.db), {
      assignee: agent,
      leaseMs: opts.leaseMs ?? DEFAULT_LEASE_MS,
      now: now(),
    })
    return { task }
  })
}

/** `ResolveTask` — the worker posts progress (`state:'working'`) or a terminal state. */
export function defineResolveTaskHandler(opts: SpTaskHandlerOptions) {
  const now = opts.now ?? (() => Date.now())
  return defineEventHandler(async (event) => {
    const agent = await requireAgent(opts, event)
    const body = await readBody<ResolveBody>(event)
    if (!body?.id || !body.state)
      throw createError({ statusCode: 400, statusMessage: 'id and state required' })
    try {
      const task = await resolveTask(resolveDb(opts.db), {
        id: body.id,
        assignee: agent,
        state: body.state,
        artifact: body.artifact,
        statusMessage: body.statusMessage,
        leaseMs: opts.leaseMs ?? DEFAULT_LEASE_MS,
        now: now(),
      })
      return { task }
    }
    catch (err) {
      if (err instanceof SpTaskError)
        throw createError({ statusCode: 409, statusMessage: err.message })
      throw err
    }
  })
}
