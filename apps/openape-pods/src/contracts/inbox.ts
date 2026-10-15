import { normalizeTag, tagLimits } from './tags'

/**
 * Owner decisions as the desktop publishes them to the account inbox (plan issue 1446, M2).
 * The desktop stays the authority: the inbox shows a decision and returns the chosen option,
 * and the desktop maps it back to the same owner command its own Decisions view would send.
 */
export type InboxDecisionType = 'question' | 'work' | 'approval' | 'effect' | 'secret'
/** Who settles the decision: Pods itself, the owner's identity provider, or OpenApe Secrets. */
export type InboxAuthority = 'pods' | 'idp' | 'secrets'
/** `evidence`: the owner states what was observed; `value`: the owner types the requested setting. */
export type InboxOptionInput = 'evidence' | 'value' | null
export interface InboxDecisionOption { key: string, title: string, input: InboxOptionInput }
export interface InboxDecision {
  sourceId: string
  type: InboxDecisionType
  /** Digest of everything the owner sees; a decision taken on an older digest fails as changed. */
  digest: string
  podId: string | null
  podName: string | null
  /** The Pod's tags; absent when it has none and from desktops before issue 1461. */
  podTags?: string[]
  title: string
  body: string
  authority: InboxAuthority
  options: InboxDecisionOption[]
  /** Verified HTTPS handoff to the IdP or Secrets; never an action that Pods performs. Without options or link, the step needs the desktop. */
  link: { title: string, url: string } | null
}
export interface InboxDecide { type: 'decide', sourceId: string, digest: string, option: string, input?: string }

export const inboxDecisionLimits = { decisions: 500, title: 300, body: 4000, options: 16, option: 200, input: 4000, publicationBytes: 1024 * 1024 } as const
export const inboxDecisionTypes: InboxDecisionType[] = ['question', 'work', 'approval', 'effect', 'secret']
export const inboxSourceId = /^[\w.:-]{1,200}$/
const optionKey = /^[\w.-]{1,64}$/
const digestPattern = /^[a-f0-9]{64}$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const inboxTagLimit = 2 * tagLimits.perItem

/** Tags of an inbox message or decision, exactly as stored by the desktop: normalized and without repeats. */
export function parseInboxTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > inboxTagLimit || new Set(value).size !== value.length || value.some(tag => normalizeTag(tag) !== tag)) throw new Error('Invalid inbox tags')
  return value as string[]
}

function record(value: unknown, fields: string[], invalid = 'Invalid inbox decision'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(invalid)
  if (Object.keys(value).some(key => !fields.includes(key))) throw new Error(invalid === 'Invalid inbox decision' ? 'Invalid inbox decision fields' : invalid)
  return value as Record<string, unknown>
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) throw new Error('Invalid inbox decision text')
  return value
}

export function parseInboxDecision(value: unknown): InboxDecision {
  const item = record(value, ['sourceId', 'type', 'digest', 'podId', 'podName', 'podTags', 'title', 'body', 'authority', 'options', 'link'])
  if (typeof item.sourceId !== 'string' || !inboxSourceId.test(item.sourceId) || !inboxDecisionTypes.includes(item.type as InboxDecisionType) || !item.sourceId.startsWith(`${String(item.type)}:`)) throw new Error('Invalid inbox decision source')
  if (typeof item.digest !== 'string' || !digestPattern.test(item.digest)) throw new Error('Invalid inbox decision digest')
  if (item.podId !== null && (typeof item.podId !== 'string' || !uuid.test(item.podId))) throw new Error('Invalid inbox decision Pod')
  if (!['pods', 'idp', 'secrets'].includes(item.authority as string)) throw new Error('Invalid inbox decision authority')
  if (!Array.isArray(item.options) || item.options.length > inboxDecisionLimits.options) throw new Error('Invalid inbox decision options')
  const options = item.options.map((entry) => {
    const option = record(entry, ['key', 'title', 'input'])
    if (typeof option.key !== 'string' || !optionKey.test(option.key) || ![null, 'evidence', 'value'].includes(option.input as string | null)) throw new Error('Invalid inbox decision option')
    return { key: option.key, title: text(option.title, inboxDecisionLimits.option), input: option.input as InboxOptionInput }
  })
  if (new Set(options.map(option => option.key)).size !== options.length) throw new Error('Duplicate inbox decision option')
  let link: InboxDecision['link'] = null
  if (item.link !== null) {
    const entry = record(item.link, ['title', 'url'])
    const url = typeof entry.url === 'string' && entry.url.length <= 2048 ? URL.parse(entry.url) : null
    if (!url || url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid inbox decision link')
    link = { title: text(entry.title, inboxDecisionLimits.option), url: url.href }
  }
  return {
    sourceId: item.sourceId, type: item.type as InboxDecisionType, digest: item.digest, podId: item.podId as string | null,
    podName: item.podName === null ? null : text(item.podName, 200), ...(item.podTags === undefined ? {} : { podTags: parseInboxTags(item.podTags) }), title: text(item.title, inboxDecisionLimits.title), body: text(item.body, inboxDecisionLimits.body, true),
    authority: item.authority as InboxAuthority, options, link,
  }
}

/**
 * Grants waiting for the owner at the IdP (issue 1458): the count and the IdP grants page, never the grants themselves.
 * `pending` is null when the desktop cannot read them now, for example without an apes login.
 */
export interface InboxApprovals { pending: number | null, url: string }

/** The optional approvals of a decision publication; desktops before issue 1458 send none. */
export function parseInboxApprovals(value: unknown): InboxApprovals | null {
  const publication = record(value, ['decisions', 'approvals'])
  if (publication.approvals === undefined) return null
  const item = record(publication.approvals, ['pending', 'url'])
  const url = typeof item.url === 'string' && item.url.length <= 2048 ? URL.parse(item.url) : null
  if (!url || url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid inbox approvals link')
  if (item.pending !== null && (!Number.isSafeInteger(item.pending) || Number(item.pending) < 0 || Number(item.pending) > 10000)) throw new Error('Invalid inbox approvals count')
  return { pending: item.pending as number | null, url: url.href }
}

export function parseInboxDecisions(value: unknown): InboxDecision[] {
  const item = record(value, ['decisions', 'approvals'])
  if (!Array.isArray(item.decisions) || item.decisions.length > inboxDecisionLimits.decisions) throw new Error('Invalid inbox decision set')
  const decisions = item.decisions.map(parseInboxDecision)
  if (new Set(decisions.map(decision => decision.sourceId)).size !== decisions.length) throw new Error('Duplicate inbox decision source')
  return decisions
}

export function parseInboxDecide(value: unknown): InboxDecide {
  const item = record(value, ['type', 'sourceId', 'digest', 'option', 'input'])
  if (item.type !== 'decide' || typeof item.sourceId !== 'string' || !inboxSourceId.test(item.sourceId) || typeof item.digest !== 'string' || !digestPattern.test(item.digest) || typeof item.option !== 'string' || !optionKey.test(item.option)) throw new Error('Invalid inbox decide command')
  if (item.input === undefined) return { type: 'decide', sourceId: item.sourceId, digest: item.digest, option: item.option }
  return { type: 'decide', sourceId: item.sourceId, digest: item.digest, option: item.option, input: text(item.input, inboxDecisionLimits.input) }
}

/**
 * An owner message from a Pod script (`context.notify`) as the account inbox keeps it: the relay's `InboxItem`
 * of kind `message`. The workspace lists messages and marks, archives or deletes them; it never sends one.
 * Every host parses them at its boundary: the content comes from Pod scripts.
 */
export interface InboxMessage {
  id: string
  title: string
  body: string
  pod: { id: string, name: string | null, tags?: string[] } | null
  runId: string | null
  links: { title: string, url: string }[]
  created: number
  read: number | null
  archived: number | null
}
/** One page, newest first; `next` continues with older messages of the same view. */
export interface InboxMessagePage { messages: InboxMessage[], next: number | null }
/** `deleted` is final: the relay keeps only a tombstone so the message never reappears on another device. */
export type InboxMessagesCommand = { type: 'list', archived?: boolean, before?: number } | { type: 'mark', id: string, read?: boolean, archived?: boolean, deleted?: true }

/** The notify limits (worker/inbox/outbox.ts) as the relay enforces them. */
export const inboxMessageLimits = { page: 50, title: 300, bodyBytes: 64 * 1024, podName: 200, links: 5, linkTitle: 200, url: 2048 } as const
const invalidMessage = 'Invalid inbox message'
const invalidCommand = 'Invalid inbox messages command'
const bytes = (value: string) => new TextEncoder().encode(value).length
function stamp(value: unknown, nullable: boolean): number | null {
  if (nullable && value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(invalidMessage)
  return value as number
}
function messageText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || bytes(value) > maximum) throw new Error(invalidMessage)
  return value
}
function messageId(value: unknown, invalid = invalidMessage): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error(invalid)
  return value
}

export function parseInboxMessage(value: unknown): InboxMessage {
  const item = record(value, ['id', 'title', 'body', 'pod', 'runId', 'links', 'created', 'read', 'archived'], invalidMessage)
  let pod: InboxMessage['pod'] = null
  if (item.pod !== null) {
    const entry = record(item.pod, ['id', 'name', 'tags'], invalidMessage)
    pod = { id: messageId(entry.id), name: entry.name === null ? null : messageText(entry.name, inboxMessageLimits.podName), ...(entry.tags === undefined ? {} : { tags: parseInboxTags(entry.tags) }) }
  }
  if (!Array.isArray(item.links) || item.links.length > inboxMessageLimits.links) throw new Error(invalidMessage)
  const links = item.links.map((link) => {
    const entry = record(link, ['title', 'url'], invalidMessage)
    const url = typeof entry.url === 'string' && entry.url.length <= inboxMessageLimits.url ? URL.parse(entry.url) : null
    if (!url || url.protocol !== 'https:' || url.username || url.password) throw new Error(invalidMessage)
    return { title: messageText(entry.title, inboxMessageLimits.linkTitle), url: url.href }
  })
  return {
    id: messageId(item.id), title: messageText(item.title, inboxMessageLimits.title), body: messageText(item.body, inboxMessageLimits.bodyBytes),
    pod, runId: item.runId === null ? null : messageId(item.runId), links, created: stamp(item.created, false)!, read: stamp(item.read, true), archived: stamp(item.archived, true),
  }
}

export function parseInboxMessagePage(value: unknown): InboxMessagePage {
  const page = record(value, ['messages', 'next'], invalidMessage)
  if (!Array.isArray(page.messages) || page.messages.length > inboxMessageLimits.page) throw new Error(invalidMessage)
  const messages = page.messages.map(parseInboxMessage)
  if (new Set(messages.map(message => message.id)).size !== messages.length) throw new Error(invalidMessage)
  return { messages, next: stamp(page.next, true) }
}

export function parseInboxMessagesCommand(value: unknown): InboxMessagesCommand {
  const item = record(value, ['type', 'id', 'archived', 'before', 'read', 'deleted'], invalidCommand)
  const flag = (field: unknown) => {
    if (field !== undefined && typeof field !== 'boolean') throw new Error(invalidCommand)
    return field as boolean | undefined
  }
  if (item.type === 'list') {
    if (item.id !== undefined || item.read !== undefined || item.deleted !== undefined) throw new Error(invalidCommand)
    const before = item.before === undefined ? undefined : stamp(item.before, false)!
    return { type: 'list', ...(flag(item.archived) === undefined ? {} : { archived: item.archived as boolean }), ...(before === undefined ? {} : { before }) }
  }
  if (item.type !== 'mark' || item.before !== undefined || (item.deleted !== undefined && item.deleted !== true)) throw new Error(invalidCommand)
  const read = flag(item.read); const archived = flag(item.archived)
  if (read === undefined && archived === undefined && !item.deleted) throw new Error(invalidCommand)
  return { type: 'mark', id: messageId(item.id, invalidCommand), ...(read === undefined ? {} : { read }), ...(archived === undefined ? {} : { archived }), ...(item.deleted ? { deleted: true } : {}) }
}
