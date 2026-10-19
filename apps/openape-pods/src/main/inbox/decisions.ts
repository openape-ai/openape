import { createHash } from 'node:crypto'
import type { InboxDecide, InboxDecision, InboxDecisionType } from '../../contracts/inbox'
import { inboxDecisionLimits, inboxSourceId, parseInboxDecision } from '../../contracts/inbox'
import type { MapView } from '../../contracts/map-view'
import type { DomainCommand, DomainOverview } from '../../contracts/domain-admin'
import type { RunCommand } from '../../contracts/runs'
import type { SecretsCommand, SecretsView } from '../../contracts/secrets'
import type { MessageKey, Parameters } from '../../i18n'

export interface DecisionSources { map: MapView | null, domain: DomainOverview, secrets: SecretsView | null }
/** The worker calls the projection needs; owner commands run inside the claimed workspace operation. */
export interface DecisionWorker {
  inboxSources: () => Promise<DecisionSources>
  domain: (command: DomainCommand) => Promise<unknown>
  runs: (command: RunCommand) => Promise<unknown>
  secrets: (command: SecretsCommand) => Promise<unknown>
}
type Translate = (key: MessageKey, parameters?: Parameters) => string
type Act = (option: string, input: string) => Promise<unknown>
export interface DecisionEntry { decision: InboxDecision, act: Act }
type Draft = Omit<InboxDecision, 'sourceId' | 'type' | 'digest'>

/** The inbox opens only HTTPS links; a summary link is shown by its host. */
function inboxLink(value: string | null): InboxDecision['link'] {
  const url = value ? URL.parse(value) : null
  return url?.protocol === 'https:' ? { title: url.host, url: url.href } : null
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const clip = (value: string, maximum: number) => value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value
function sourceId(type: InboxDecisionType, parts: string[]): string {
  const readable = `${type}:${parts.join(':')}`
  return inboxSourceId.test(readable) ? readable : `${type}:${sha256(parts.join('\n')).slice(0, 40)}`
}
// One field per line: a line break inside a value would forge another `key: value` line (e.g. a fake sender).
const show = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\s*[\r\n\u2028\u2029]\s*/g, ' ⏎ ')

/**
 * Projects the desktop Decisions view into account-inbox decisions and executes a decision taken
 * there with the same owner command the desktop view would send. Every decision is re-read and
 * compared by digest at execution time, so a changed or vanished source fails instead of guessing.
 */
export class InboxDecisions {
  constructor(private readonly worker: DecisionWorker, private readonly t: Translate) {}

  async collect(): Promise<InboxDecision[]> { return (await this.entries()).map(entry => entry.decision) }

  async decide(command: InboxDecide): Promise<{ status: 'applied', sourceId: string }> {
    const entry = (await this.entries()).find(item => item.decision.sourceId === command.sourceId)
    if (!entry) throw new Error('This decision is no longer waiting')
    if (entry.decision.digest !== command.digest) throw new Error('This decision changed; review it again')
    const option = entry.decision.options.find(item => item.key === command.option)
    if (!option) throw new Error('This option is not available for the decision')
    const input = command.input?.trim() ?? ''
    if (option.input === 'evidence' && !input) throw new Error('This decision requires your observation as evidence')
    await entry.act(option.key, input)
    return { status: 'applied', sourceId: command.sourceId }
  }

  private async entries(): Promise<DecisionEntry[]> {
    const sources = await this.worker.inboxSources()
    const entries = [...this.questions(sources), ...this.approvals(sources), ...this.failedWork(sources), ...this.secrets(sources)]
    // One malformed source (for example a non-HTTPS issuer) must not block every other decision.
    const valid = entries.filter((entry) => {
      try { parseInboxDecision(entry.decision); return true }
      catch (error) { console.error(`Inbox decision ${entry.decision.sourceId} is not published`, error); return false }
    })
    // The relay accepts one bounded publication; decisions beyond it wait for a later, smaller set.
    let bytes = 1024
    return valid.slice(0, inboxDecisionLimits.decisions).filter((entry) => {
      bytes += Buffer.byteLength(JSON.stringify(entry.decision)) + 1
      return bytes <= inboxDecisionLimits.publicationBytes
    })
  }

  private entry(type: InboxDecisionType, parts: string[], draft: Draft, act: Act): DecisionEntry {
    const content = { ...draft, title: clip(draft.title, inboxDecisionLimits.title), body: clip(draft.body, inboxDecisionLimits.body), options: draft.options.map(option => ({ ...option, title: clip(option.title, inboxDecisionLimits.option) })), link: draft.link && { ...draft.link, url: URL.parse(draft.link.url)?.href ?? draft.link.url } }
    const id = sourceId(type, parts)
    return { decision: { sourceId: id, type, digest: sha256(JSON.stringify([id, content])), ...content }, act }
  }

  private podName(sources: DecisionSources, podId: string): string | null { return sources.map?.pods.find(pod => pod.id === podId)?.name ?? null }
  // Tags appear only when the Pod has any, so decisions of untagged Pods keep their digest.
  private pod(sources: DecisionSources, podId: string): Pick<InboxDecision, 'podId' | 'podName' | 'podTags'> {
    const podTags = sources.map?.pods.find(pod => pod.id === podId)?.tags?.own ?? []
    return { podId, podName: this.podName(sources, podId), ...(podTags.length ? { podTags } : {}) }
  }

  /** Owner questions of Pods (issue 1465); the answer becomes an owner-written entry the asking Pod reads. */
  private questions(sources: DecisionSources): DecisionEntry[] {
    return sources.domain.questions.map((question) => {
      const facts = Object.entries(question.data).map(([key, value]) => `${key}: ${show(value)}`)
      return this.entry('question', [question.id], { ...this.pod(sources, question.podId), title: question.title, body: [question.body, ...facts].filter(Boolean).join('\n'), authority: 'pods', options: question.options.map(option => ({ ...option, input: null })), link: null },        async option => this.worker.domain({ type: 'answer', questionId: question.id, option }))
    })
  }

  /**
   * Historical approvals remain visible; their authority and reconciliation moved to the external tool.
   */
  private approvals(sources: DecisionSources): DecisionEntry[] {
    return sources.domain.approvals.filter(approval => approval.state === 'unknown').map(approval => this.entry('approval', [approval.id], {
      ...this.pod(sources, approval.podId),
      title: approval.title,
      body: [this.t('Uncertain approval'), ...(approval.description ? [approval.description] : []), approval.object, ...(approval.reason ? [approval.reason] : [])].join('\n'),
      authority: 'pods',
      options: [],
      link: inboxLink(approval.link),
    }, async () => { throw new Error('Historical decisions are read-only; reconcile the external tool journal') }))
  }

  /** Work that failed and no longer retries on its own; the owner can retry it once the cause is fixed. */
  private failedWork(sources: DecisionSources): DecisionEntry[] {
    const writer = (operation: string) => sources.domain.namespaces.find(namespace => namespace.path === sources.domain.operations.find(item => item.operation === operation)?.output)?.writer
    return sources.domain.held.map((item) => {
      const podId = writer(item.operation)
      return this.entry('work', [item.key], {
        ...(podId && podId !== 'owner' ? this.pod(sources, podId) : { podId: null, podName: null }),
        title: `${this.t('Failed work')} · ${item.operation}`,
        body: [item.object, ...(item.reason ? [item.reason] : [])].join('\n'),
        authority: 'pods',
        options: [{ key: 'release', title: this.t('Retry'), input: null }],
        link: null,
      }, async () => this.worker.domain({ type: 'release', key: item.key }))
    })
  }

  private secrets(sources: DecisionSources): DecisionEntry[] {
    const view = sources.secrets
    if (!view) return []
    return view.requests.filter(row => row.status !== 'collected' && row.status !== 'expired').map(row => this.entry('secret', [row.id], {
      ...this.pod(sources, row.podId),
      title: this.t('Secret {alias} for {pod}', { alias: row.alias, pod: this.podName(sources, row.podId) ?? row.podId }),
      body: [row.purpose || this.t('no purpose given'), ...(row.error ? [row.error] : [])].join('\n'),
      authority: 'secrets',
      options: [{ key: 'cancel', title: this.t('Cancel'), input: null }],
      link: row.status === 'requested' ? { title: this.t('Fill in at secrets.openape.ai'), url: view.origin } : null,
    }, async () => this.worker.secrets({ type: 'cancel', id: row.id })))
  }
}
