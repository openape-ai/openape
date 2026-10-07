import { createHash } from 'node:crypto'
import type { InboxDecide, InboxDecision, InboxDecisionOption, InboxDecisionType } from '../../contracts/inbox'
import { inboxDecisionLimits, inboxSourceId, parseInboxDecision } from '../../contracts/inbox'
import type { MapView } from '../../contracts/map-view'
import type { AccessProposal, MasterCommand } from '../../contracts/master'
import type { NetworkCommand, NetworkView } from '../../contracts/networks'
import type { ResourceState } from '../../contracts/resources'
import type { RunCommand } from '../../contracts/runs'
import { setupResourceMatches } from '../../contracts/setup'
import type { SecretsCommand, SecretsView } from '../../contracts/secrets'
import type { WorkflowCommand, WorkflowView } from '../../contracts/workflows'
import type { MessageKey, Parameters } from '../../i18n'

/** `resources` holds the current resources of every Pod with a pending setup proposal. */
export interface DecisionSources { map: MapView | null, networks: NetworkView, workflows: WorkflowView, proposals: AccessProposal[], resources: Record<string, ResourceState>, secrets: SecretsView | null }
/** The worker calls the projection needs; owner commands run inside the claimed workspace operation. */
export interface DecisionWorker {
  inboxSources: () => Promise<DecisionSources>
  approvalLink: (podId: string, runId: string, grantId: string) => Promise<string>
  networks: (command: NetworkCommand) => Promise<unknown>
  workflows: (command: WorkflowCommand) => Promise<unknown>
  runs: (command: RunCommand) => Promise<unknown>
  secrets: (command: SecretsCommand) => Promise<unknown>
  master: (command: MasterCommand) => Promise<unknown>
}
type Translate = (key: MessageKey, parameters?: Parameters) => string
type Act = (option: string, input: string) => Promise<unknown>
interface Entry { decision: InboxDecision, act: Act }
type Draft = Omit<InboxDecision, 'sourceId' | 'type' | 'digest'>

// Batch states the desktop Decisions view lists as open.
const openBatch = ['preparing', 'pending', 'consuming', 'unknown', 'superseded']
const headline = ['subject', 'title', 'name']

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const clip = (value: string, maximum: number) => value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value
function sourceId(type: InboxDecisionType, parts: string[]): string {
  const readable = `${type}:${parts.join(':')}`
  return inboxSourceId.test(readable) ? readable : `${type}:${sha256(parts.join('\n')).slice(0, 40)}`
}
function payloadFields(payload: string): Record<string, unknown> {
  try {
    const value = JSON.parse(payload) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { payload }
  }
  catch { return { payload } }
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
    if (option.input === 'value' && !input) throw new Error('Enter the missing value')
    await entry.act(option.key, input)
    return { status: 'applied', sourceId: command.sourceId }
  }

  private async entries(): Promise<Entry[]> {
    const sources = await this.worker.inboxSources()
    const entries = [...this.networkChoices(sources), ...this.networkBatches(sources), ...this.workflowItems(sources), ...await this.approvals(sources), ...this.effects(sources), ...this.secrets(sources), ...this.proposals(sources)]
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

  private entry(type: InboxDecisionType, parts: string[], draft: Draft, act: Act): Entry {
    const content = { ...draft, title: clip(draft.title, inboxDecisionLimits.title), body: clip(draft.body, inboxDecisionLimits.body), options: draft.options.map(option => ({ ...option, title: clip(option.title, inboxDecisionLimits.option) })), link: draft.link && { ...draft.link, url: URL.parse(draft.link.url)?.href ?? draft.link.url } }
    const id = sourceId(type, parts)
    return { decision: { sourceId: id, type, digest: sha256(JSON.stringify([id, content])), ...content }, act }
  }

  // Network members change only through desktop review; the phone may still take gate decisions for the network.
  private members(sources: DecisionSources): Set<string> { return new Set((sources.map?.collections ?? []).filter(collection => collection.kind === 'network').flatMap(collection => collection.members)) }
  private podName(sources: DecisionSources, podId: string): string | null { return sources.map?.pods.find(pod => pod.id === podId)?.name ?? null }
  private collection(sources: DecisionSources, id: string) { return sources.map?.collections.find(collection => collection.id === id) }

  // Only the latest event of a case is open; an earlier event is superseded, as on the desktop.
  private networkChoices(sources: DecisionSources): Entry[] {
    const latest = new Map<string, NonNullable<NetworkView['choices']>[number]>()
    for (const choice of sources.networks.choices ?? []) latest.set(`${choice.networkId}:${choice.gate}:${choice.caseId}`, choice)
    return Array.from(latest.values(), (choice) => {
      const fields = payloadFields(choice.payload)
      const title = headline.map(key => fields[key]).find(value => typeof value === 'string' && value) as string | undefined ?? choice.caseId
      const facts = Object.entries(fields).filter(([key]) => !headline.includes(key)).map(([key, value]) => `${key}: ${show(value)}`)
      const network = this.collection(sources, choice.networkId)?.name
      const options = choice.options.map(option => ({ key: option.key, title: option.title, input: null }))
      return this.entry('network-choice', [choice.eventId], { podId: null, podName: null, title, body: [network ? `${choice.title} · ${network}` : choice.title, ...facts].join('\n'), authority: 'pods', options, link: null },
        async option => this.worker.networks({ type: 'choose', id: choice.networkId, revision: choice.revision, eventId: choice.eventId, gate: choice.gate, option }))
    })
  }

  private networkBatches(sources: DecisionSources): Entry[] {
    return (sources.networks.gates ?? []).filter(batch => openBatch.includes(batch.state)).flatMap((batch) => {
      const unknown = batch.state === 'unknown'
      const link = batch.url ? { title: this.t('Decide at the IdP'), url: batch.url } : null
      const revision = this.collection(sources, batch.networkId)?.revision ?? 1
      const lines = [this.t('{count} items', { count: batch.items.length }), ...batch.items.map(item => `- ${item.title} (${item.outcome})`), ...(unknown ? [] : [this.t('Select the items to approve at the IdP; unselected items are denied.')]), ...(batch.error ? [batch.error] : [])]
      // An uncertain or superseded batch can ask the IdP again with the owner's reason; the runtime checks that no item is in use.
      const reviewable = unknown || batch.state === 'superseded'
      const options: InboxDecisionOption[] = [...(unknown ? [{ key: 'discard', title: this.t('Discard batch'), input: 'evidence' as const }] : []), ...(reviewable ? [{ key: 'review', title: this.t('Request fresh approval'), input: 'evidence' as const }] : [])]
      if (!options.length && !link) return []
      return [this.entry('network-batch', [batch.id, String(batch.generation)], { podId: batch.podId, podName: this.podName(sources, batch.podId), title: `${this.t('Approval batch')} · ${batch.gate}`, body: lines.join('\n'), authority: 'idp', options, link },
        async (option, evidence) => this.worker.networks({ type: option === 'review' ? 'gateReview' : 'gateDiscard', id: batch.networkId, revision, taskId: batch.id, generation: batch.generation, evidence }))]
    })
  }

  private workflowItems(sources: DecisionSources): Entry[] {
    const held = (sources.workflows.gates?.held ?? []).flatMap((item) => {
      const workflow = this.collection(sources, item.workflowId)
      const gate = workflow?.gates.find(entry => entry.key === item.gate)
      if (!workflow || !gate?.options.length) return []
      const options = gate.options.map(option => ({ key: option.key, title: option.title, input: null }))
      return [this.entry('workflow-held', [item.workflowId, item.gate, item.itemId], { podId: null, podName: null, title: item.title, body: `${gate.title} · ${workflow.name}`, authority: 'pods', options, link: null },
        async option => this.worker.workflows({ type: 'gateChoose', id: item.workflowId, gate: item.gate, itemId: item.itemId, option }))]
    })
    const batches = (sources.workflows.gates?.batches ?? []).filter(batch => openBatch.includes(batch.state)).flatMap((batch) => {
      const link = batch.url ? { title: this.t('Decide at the IdP'), url: batch.url } : null
      const options: InboxDecisionOption[] = batch.state === 'unknown' ? [{ key: 'discard', title: this.t('Discard batch'), input: null }] : []
      if (!options.length && !link) return []
      const lines = [this.t('{count} items', { count: batch.items.length }), ...batch.items.map(item => `- ${item.title}`)]
      return [this.entry('workflow-batch', [batch.id], { podId: batch.podId, podName: this.podName(sources, batch.podId), title: `${this.t('Approval batch')} · ${batch.gate}`, body: lines.join('\n'), authority: 'idp', options, link },
        async () => this.worker.workflows({ type: 'gateDiscard', batchId: batch.id }))]
    })
    return [...held, ...batches]
  }

  // The link is rebuilt from the Pod's own identity issuer; an approval that cannot be verified is not published.
  private async approvals(sources: DecisionSources): Promise<Entry[]> {
    const rows = (sources.map?.pods ?? []).flatMap(pod => pod.approvals.map(approval => ({ pod, approval })))
    const linked = await Promise.allSettled(rows.map(row => this.worker.approvalLink(row.pod.id, row.approval.runId, row.approval.grantId)))
    return rows.flatMap(({ pod, approval }, index) => {
      const result = linked[index]!
      if (result.status === 'rejected') return []
      return [this.entry('approval', [pod.id, approval.runId, approval.grantId], { podId: pod.id, podName: pod.name, title: approval.title, body: this.t('Open approval'), authority: 'idp', options: [], link: { title: this.t('Decide at the IdP'), url: result.value } },
        async () => { throw new Error('Approvals are decided at the IdP') })]
    })
  }

  // Replaces the desktop confirmation dialog: the owner states what was observed outside, never an automatic resend.
  // Network members keep their retained network recovery, so their deliveries are reviewed on the desktop.
  private effects(sources: DecisionSources): Entry[] {
    const members = this.members(sources)
    return (sources.map?.pods ?? []).flatMap(pod => pod.unknown.map((item) => {
      const desktop = members.has(pod.id)
      const options: InboxDecisionOption[] = desktop ? [] : [{ key: 'delivered', title: this.t('Delivered'), input: 'evidence' }, { key: 'resend', title: this.t('Not delivered, send again'), input: 'evidence' }]
      return this.entry('effect', [pod.id, item.runId, item.key], {
        podId: pod.id, podName: pod.name, title: `${this.t('unknown deliveries')} · ${item.key}`, body: desktop ? `${item.runId}\n${this.t('Only on the desktop')}` : item.runId, authority: 'pods', options, link: null,
      }, async (option, evidence) => this.worker.runs({ type: 'resolveHttp', podId: pod.id, runId: item.runId, key: item.key, applied: option === 'delivered', evidence }))
    }))
  }

  private secrets(sources: DecisionSources): Entry[] {
    const view = sources.secrets
    if (!view) return []
    return view.requests.filter(row => row.status !== 'collected' && row.status !== 'expired').map(row => this.entry('secret', [row.id], {
      podId: row.podId, podName: this.podName(sources, row.podId), title: this.t('Secret {alias} for {pod}', { alias: row.alias, pod: this.podName(sources, row.podId) ?? row.podId }),
      body: [row.purpose || this.t('no purpose given'), ...(row.error ? [row.error] : [])].join('\n'), authority: 'secrets',
      options: [{ key: 'cancel', title: this.t('Cancel'), input: null }], link: row.status === 'requested' ? { title: this.t('Fill in at secrets.openape.ai'), url: view.origin } : null,
    }, async () => this.worker.secrets({ type: 'cancel', id: row.id })))
  }

  // Accepts only what needs no local interaction: a typed variable, a resource that is already assigned, or a
  // scoped Secrets request. New grants, folders and installations remain an explicit step on the desktop.
  private proposals(sources: DecisionSources): Entry[] {
    const members = this.members(sources)
    return sources.proposals.filter(proposal => proposal.state === 'pending').map((proposal) => {
      const request = proposal.body
      const alias = request.alias
      const state = members.has(proposal.podId) ? undefined : sources.resources[proposal.podId]
      const offered = request.argv ? undefined : state?.resources.find(resource => setupResourceMatches(request, request, resource))
      const requested = sources.secrets?.requests.some(row => row.podId === proposal.podId && row.alias === request.alias && ['requested', 'filled'].includes(row.status))
      const accept: [InboxDecisionOption, Act] | null = request.provider === 'variable' && alias && state
        ? [{ key: 'accept', title: this.t('Save variable'), input: 'value' }, async (_option, value) => this.worker.master({ type: 'answerSetup', id: proposal.id, podId: proposal.podId, value, revision: state.variables?.find(item => item.name === alias)?.revision ?? 0 })]
        : offered && state
          ? [{ key: 'accept', title: this.t('Set up {name}', { name: offered.name }), input: null }, async () => this.worker.master({ type: 'resolveSetup', id: proposal.id, podId: proposal.podId, resourceId: offered.id, epoch: state.epoch, request })]
          : request.provider === 'credential' && alias && state && sources.secrets && !requested
            ? [{ key: 'request', title: this.t('Request'), input: null }, async () => this.worker.secrets({ type: 'request', podId: proposal.podId, alias, purpose: clip(request.description, 500) })]
            : null
      const desktopStep = !accept && !(request.provider === 'credential' && requested)
      const body = [request.instructions ?? '', ...(desktopStep ? [`${this.t('Set up in the Pod')} · ${this.t('Only on the desktop')}`] : [])].filter(Boolean).join('\n')
      const decline: InboxDecisionOption = { key: 'decline', title: this.t('Decline'), input: null }
      return this.entry('proposal', [proposal.id], { podId: proposal.podId, podName: this.podName(sources, proposal.podId), title: request.description, body, authority: request.provider === 'credential' ? 'secrets' : 'pods', options: accept ? [accept[0], decline] : [decline], link: null },
        async (option, input) => {
          if (option === 'decline') return this.worker.master({ type: 'decline', id: proposal.id, podId: proposal.podId })
          if (!accept) throw new Error('This option is not available for the decision')
          return accept[1](option, input)
        })
    })
  }
}
