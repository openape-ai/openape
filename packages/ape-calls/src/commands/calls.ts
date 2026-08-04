import { defineCommand } from 'citty'
import { error, fmtTime, info, printJson, printLine } from '@openape/proof-cli'
import { apiCall } from '../api.ts'

const REQUEST_TYPES = ['decision.requested', 'work.blocked', 'verdict.requested']
const RESOLUTION_TYPES = ['decision.made', 'verdict.given']

interface WireEvent {
  id: string
  ts: number
  actor: string
  actor_kind: 'human' | 'agent'
  task_ref: string
  type: string
  payload: Record<string, unknown>
}

function title(event: WireEvent): string {
  return String(event.payload.title ?? event.payload.question ?? event.payload.pr_url ?? event.task_ref)
}

/** The open calls: a request without the event that answers it. */
export function openCalls(events: WireEvent[]): WireEvent[] {
  const answered = new Set(
    events.filter(e => RESOLUTION_TYPES.includes(e.type)).map(e => String(e.payload.request_id ?? '')),
  )
  return events
    .filter(e => REQUEST_TYPES.includes(e.type) && !answered.has(e.id))
    .sort((a, b) => a.ts - b.ts)
}

/** What a resolved call decided, in one word. */
export function answerOf(resolution: { payload: Record<string, unknown> } | null): string | null {
  if (!resolution) return null
  return String(resolution.payload.verdict ?? resolution.payload.decision ?? '')
}

export const listCommand = defineCommand({
  meta: { name: 'list', description: 'Show the calls waiting for a human, longest-waiting first.' },
  args: {
    json: { type: 'boolean', description: 'Print the full objects as JSON.' },
    endpoint: { type: 'string', description: 'Override troop endpoint.' },
  },
  async run({ args }) {
    const { events } = await apiCall<{ events: WireEvent[] }>('GET', '/api/events', {
      query: { since: '-30d' },
      endpoint: args.endpoint,
    })
    const open = openCalls(events)

    if (args.json) {
      printJson(open)
      return
    }
    if (open.length === 0) {
      info('Nothing is waiting for you.')
      return
    }
    for (const call of open) {
      printLine(`${call.id}  ${fmtTime(call.ts)}  ${title(call)}`)
    }
  },
})

export const showCommand = defineCommand({
  meta: { name: 'show', description: 'Show one call with its proofs and its answer, if it has one.' },
  args: {
    id: { type: 'positional', required: true, description: 'Call (event) ULID.' },
    json: { type: 'boolean', description: 'Print the full object as JSON.' },
    endpoint: { type: 'string', description: 'Override troop endpoint.' },
  },
  async run({ args }) {
    const card = await apiCall<{ event: WireEvent, resolution: WireEvent | null, proofs: WireEvent[] }>(
      'GET',
      `/api/events/${args.id}`,
      { endpoint: args.endpoint },
    )
    if (args.json) {
      printJson(card)
      return
    }
    printLine(title(card.event))
    info(`${card.event.type} · ${card.event.actor} · ${card.event.task_ref}`)
    for (const proof of card.proofs) printLine(`  proof (${proof.payload.kind}): ${proof.payload.url}`)
    const answer = answerOf(card.resolution)
    printLine(answer ? `  answered: ${answer} (${card.resolution!.actor})` : '  open')
  },
})

export const waitCommand = defineCommand({
  meta: {
    name: 'wait',
    description: 'Block until a call is answered, then print the answer. Exits 2 if it expired.',
  },
  args: {
    id: { type: 'positional', required: true, description: 'Call (event) ULID.' },
    timeout: { type: 'string', description: 'Give up after this long (e.g. 2h, 30m). Default: 1h.' },
    json: { type: 'boolean', description: 'Print the resolving event as JSON.' },
    endpoint: { type: 'string', description: 'Override troop endpoint.' },
  },
  async run({ args }) {
    const deadline = Date.now() + parseDuration(args.timeout ?? '1h')

    // Long-poll: troop holds the request until the call is answered, so the
    // answer arrives within a second of the click instead of on a poll tick.
    while (Date.now() < deadline) {
      const card = await apiCall<{ resolution: WireEvent | null, expired?: boolean }>(
        'GET',
        `/api/events/${args.id}`,
        { query: { wait: 25 }, endpoint: args.endpoint },
      )
      if (card.resolution) {
        if (args.json) printJson(card.resolution)
        else printLine(answerOf(card.resolution)!)
        return
      }
      if (card.expired) {
        error('The call expired without an answer.')
        process.exit(2)
      }
    }
    error(`No answer within ${args.timeout ?? '1h'}.`)
    process.exit(3)
  },
})

/** "90s" / "30m" / "2h" / "1d" → milliseconds. */
export function parseDuration(input: string): number {
  const match = /^(\d+)([smhd])$/.exec(input.trim())
  if (!match) throw new Error(`invalid duration "${input}" — use 30s, 15m, 2h or 1d`)
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return Number(match[1]) * units[match[2] as keyof typeof units]
}
