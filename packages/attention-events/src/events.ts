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
  'policy.proposed',
  'policy.adopted',
  'call.raised',
  'call.answered',
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
// A card has to stand on its own: whoever opens it — days later, on a phone,
// without the conversation that produced it — must understand what is at stake
// before deciding, and still understand it afterwards. `title` is the headline,
// `summary` the executive summary of the situation.
const briefing = {
  title: z.string().min(1).max(200).optional(),
  summary: z.string().min(1).max(4000).optional(),
} as const

// One line per option: what choosing it actually means. Kept separate from
// `options` (the machine-readable values) so buttons stay stable.
const optionBriefing = z.array(z.strictObject({
  option: z.string().min(1),
  summary: z.string().min(1).max(1000),
})).optional()

const waiting = {
  deadline: z.number().int().positive().optional(),
  on_timeout: z.enum(['recommendation', 'fail']).optional(),
} as const

function event<T extends AttentionEventType, P extends z.ZodRawShape>(type: T, payload: P) {
  return z.strictObject({ ...envelope, type: z.literal(type), payload: z.strictObject(payload) })
}

// A **call** is the OpenApe word for a decision waiting on a human: an agent
// *raises* one, a human *answers* it. `call.raised` unifies what used to be
// three separate request types — the `kind` says which sort it is, and the
// payload carries whatever that sort needs.
//
// The older `decision.requested` / `work.blocked` / `verdict.requested` and
// their answers stay valid forever: 50+ of them are already recorded, and
// every reader folds both vocabularies. New writers should raise calls.
const CALL_KINDS = ['decision', 'escalation', 'verdict'] as const

export const AttentionEventSchema = z.discriminatedUnion('type', [
  event('call.raised', {
    kind: z.enum(CALL_KINDS),
    question: z.string().min(1).optional(),
    options: z.array(z.string()).optional(),
    option_summaries: optionBriefing,
    recommendation: z.string().optional(),
    recommendation_why: z.string().max(2000).optional(),
    blocks: z.string().optional(),
    pr_url: z.url().optional(),
    highlights: z.array(z.string().min(1).max(500)).max(10).optional(),
    ...briefing,
    ...waiting,
  }),
  event('call.answered', {
    answer: z.string().min(1),
    request_id: ulid.optional(),
    auto: z.boolean().optional(),
  }),
  event('spec.created', { title: z.string().min(1), spec_url: z.url().optional() }),
  event('spec.approved', {}),
  event('spec.changes_requested', { reason: z.string().optional() }),
  event('work.started', {}),
  event('work.blocked', {
    question: z.string().min(1),
    options: z.array(z.string()).optional(),
    option_summaries: optionBriefing,
    recommendation: z.string().optional(),
    recommendation_why: z.string().max(2000).optional(),
    ...briefing,
    ...waiting,
  }),
  event('decision.requested', {
    question: z.string().min(1),
    options: z.array(z.string()).min(2),
    option_summaries: optionBriefing,
    recommendation: z.string().optional(),
    recommendation_why: z.string().max(2000).optional(),
    blocks: z.string().optional(),
    ...briefing,
    ...waiting,
  }),
  event('decision.made', { decision: z.string().min(1), request_id: ulid.optional(), auto: z.boolean().optional() }),
  event('proof.attached', { url: z.url(), kind: z.enum(['pr', 'testrun', 'screenshot', 'log']) }),
  event('verdict.requested', {
    pr_url: z.url().optional(),
    // What the change does and what the reviewer should look at.
    highlights: z.array(z.string().min(1).max(500)).max(10).optional(),
    recommendation: z.enum(['merge', 'rework', 'reject']).optional(),
    recommendation_why: z.string().max(2000).optional(),
    ...briefing,
  }),
  event('verdict.given', { verdict: z.enum(['merge', 'rework', 'reject']), request_id: ulid.optional(), auto: z.boolean().optional() }),
  event('cost.recorded', { amount_eur: z.number().nonnegative(), note: z.string().optional() }),
  // What remains of a decision once it applies to future work, not just this
  // case. `source_id` points at the card it came from, so "since when, and out
  // of which decision" stays answerable.
  event('policy.proposed', {
    rule: z.string().min(1).max(2000),
    rationale: z.string().max(4000).optional(),
    source_id: ulid.optional(),
  }),
  event('policy.adopted', {
    rule: z.string().min(1).max(2000),
    rationale: z.string().max(4000).optional(),
    source_id: ulid.optional(),
    /** Where the rule is written down so it actually binds (e.g. CLAUDE.md). */
    enforced_in: z.string().max(500).optional(),
  }),
  event('task.shipped', {}),
])

export type AttentionEvent = z.infer<typeof AttentionEventSchema>

export function parseAttentionEvent(input: unknown): AttentionEvent {
  return AttentionEventSchema.parse(input)
}
