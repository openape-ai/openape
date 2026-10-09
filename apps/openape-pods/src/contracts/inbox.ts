/**
 * Owner decisions as the desktop publishes them to the account inbox (plan issue 1446, M2).
 * The desktop stays the authority: the inbox shows a decision and returns the chosen option,
 * and the desktop maps it back to the same owner command its own Decisions view would send.
 */
// Desktops before issue 1455 (M5) also publish setup `proposal` decisions; the relay accepts them until those builds are replaced.
export type InboxDecisionType = 'network-choice' | 'network-batch' | 'workflow-held' | 'workflow-batch' | 'approval' | 'effect' | 'secret' | 'proposal'
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
  title: string
  body: string
  authority: InboxAuthority
  options: InboxDecisionOption[]
  /** Verified HTTPS handoff to the IdP or Secrets; never an action that Pods performs. Without options or link, the step needs the desktop. */
  link: { title: string, url: string } | null
}
export interface InboxDecide { type: 'decide', sourceId: string, digest: string, option: string, input?: string }

export const inboxDecisionLimits = { decisions: 500, title: 300, body: 4000, options: 16, option: 200, input: 4000, publicationBytes: 1024 * 1024 } as const
export const inboxDecisionTypes: InboxDecisionType[] = ['network-choice', 'network-batch', 'workflow-held', 'workflow-batch', 'approval', 'effect', 'secret', 'proposal']
export const inboxSourceId = /^[\w.:-]{1,200}$/
const optionKey = /^[\w.-]{1,64}$/
const digestPattern = /^[a-f0-9]{64}$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

function record(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid inbox decision')
  if (Object.keys(value).some(key => !fields.includes(key))) throw new Error('Invalid inbox decision fields')
  return value as Record<string, unknown>
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) throw new Error('Invalid inbox decision text')
  return value
}

export function parseInboxDecision(value: unknown): InboxDecision {
  const item = record(value, ['sourceId', 'type', 'digest', 'podId', 'podName', 'title', 'body', 'authority', 'options', 'link'])
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
    podName: item.podName === null ? null : text(item.podName, 200), title: text(item.title, inboxDecisionLimits.title), body: text(item.body, inboxDecisionLimits.body, true),
    authority: item.authority as InboxAuthority, options, link,
  }
}

export function parseInboxDecisions(value: unknown): InboxDecision[] {
  const item = record(value, ['decisions'])
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
