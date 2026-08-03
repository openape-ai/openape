import { z } from 'zod'

export const ATTENTION_EVENT_TYPES = [
  'spec.created',
  'spec.approved',
  'spec.changes_requested',
  'work.started',
  'work.blocked',
  'decision.requested',
  'decision.made',
  'proof.attached',
  'verdict.requested',
  'verdict.given',
  'cost.recorded',
  'task.shipped',
] as const

export type AttentionEventType = (typeof ATTENTION_EVENT_TYPES)[number]

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'expected a ULID')

const envelope = {
  id: ulid,
  ts: z.number().int().positive(),
  actor: z.string().min(1),
  actor_kind: z.enum(['human', 'agent']),
  task_ref: z.string().min(1),
  goal_ref: z.string().min(1).optional(),
  org_id: z.string().min(1).optional(),
}

// A card that can never be answered deadlocks whoever waits on it, so a
// request may declare when it stops waiting and what holds instead:
// `recommendation` applies the recommended option, `fail` leaves the work
// blocked. Absent `deadline` means "waits forever" — fine for interactive use.
const waiting = {
  deadline: z.number().int().positive().optional(),
  on_timeout: z.enum(['recommendation', 'fail']).optional(),
} as const

function event<T extends AttentionEventType, P extends z.ZodRawShape>(type: T, payload: P) {
  return z.strictObject({ ...envelope, type: z.literal(type), payload: z.strictObject(payload) })
}

export const AttentionEventSchema = z.discriminatedUnion('type', [
  event('spec.created', { title: z.string().min(1), spec_url: z.url().optional() }),
  event('spec.approved', {}),
  event('spec.changes_requested', { reason: z.string().optional() }),
  event('work.started', {}),
  event('work.blocked', {
    question: z.string().min(1),
    options: z.array(z.string()).optional(),
    recommendation: z.string().optional(),
    ...waiting,
  }),
  event('decision.requested', {
    question: z.string().min(1),
    options: z.array(z.string()).min(2),
    recommendation: z.string().optional(),
    blocks: z.string().optional(),
    ...waiting,
  }),
  event('decision.made', { decision: z.string().min(1), request_id: ulid.optional(), auto: z.boolean().optional() }),
  event('proof.attached', { url: z.url(), kind: z.enum(['pr', 'testrun', 'screenshot', 'log']) }),
  event('verdict.requested', { pr_url: z.url().optional() }),
  event('verdict.given', { verdict: z.enum(['merge', 'rework', 'reject']), request_id: ulid.optional(), auto: z.boolean().optional() }),
  event('cost.recorded', { amount_eur: z.number().nonnegative(), note: z.string().optional() }),
  event('task.shipped', {}),
])

export type AttentionEvent = z.infer<typeof AttentionEventSchema>

export function parseAttentionEvent(input: unknown): AttentionEvent {
  return AttentionEventSchema.parse(input)
}
