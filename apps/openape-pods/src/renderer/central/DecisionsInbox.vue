<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CentralCommand } from '../../contracts/central'
import type { GateBatchView, GateHeldItem } from '../../contracts/gates'
import type { MapView } from '../../contracts/map-view'
import type { NetworkGateView } from '../../contracts/network-gate-view'
import type { NetworkChoiceView, NetworkCommand } from '../../contracts/networks'
import type { WorkflowCommand } from '../../contracts/workflows'
import type { SecretRequestRow, SecretsCommand } from '../../contracts/secrets'
import { diagnostic, label, language, t } from '../i18n'
import { clock, stamp } from '../utils/cadence'

/**
 * Everything that waits for the owner, in five sections: questions per choose route, approval
 * batches decided at the identity provider, runtime rights, unknown deliveries and secret
 * requests. Every decision leaves as an existing owner command; nothing here approves on its own.
 */
const props = defineProps<{ view: MapView, choices: NetworkChoiceView[], gates: NetworkGateView[], graphGates: { batches: GateBatchView[], held: GateHeldItem[] } | null, desktop: boolean, requests?: SecretRequestRow[], secretsOrigin?: string }>()
const emit = defineEmits<{ network: [command: NetworkCommand, settle?: (error: string | null) => void], workflow: [command: WorkflowCommand], command: [command: CentralCommand], secrets: [command: SecretsCommand] }>()
const headline = ['subject', 'title', 'name']
const groupBy = ref('')
const raw = ref(false)
/** A choice is shown as saving until its event leaves the waiting list; a refused save returns the case with its error. */
const saving = ref<Record<string, { eventId: string, title: string, channel: string }>>({})
const failures = ref<Record<string, string>>({})
const evidence = ref<Record<string, string>>({})
const openBatch = ['preparing', 'pending', 'consuming', 'unknown', 'superseded']

interface Case { id: string, networkId: string, revision: number, gate: string, title: string, event: NetworkChoiceView, payload: Record<string, unknown>, versions: number, options: { key: string, title: string, channel: string }[] }
const gateDefinition = (networkId: string, key: string) => props.view.collections.find(collection => collection.id === networkId)?.gates.find(gate => gate.key === key)
function parse(payload: string): Record<string, unknown> {
  try { const value = JSON.parse(payload); return value && typeof value === 'object' && !Array.isArray(value) ? value : { payload } }
  catch { return { payload } }
}
/** Latest event per case; earlier events of the same case count as versions. */
const cases = computed<Case[]>(() => {
  const byCase = new Map<string, Case>()
  for (const choice of props.choices) {
    const id = `${choice.networkId}:${choice.gate}:${choice.caseId}`
    const existing = byCase.get(id)
    const definition = gateDefinition(choice.networkId, choice.gate)
    const options = choice.options.map(option => ({ ...option, channel: definition?.options.find(item => item.key === option.key)?.channel ?? '' }))
    if (existing) { existing.versions++; existing.event = choice; existing.payload = parse(choice.payload); existing.options = options }
    else {
      byCase.set(id, { id, networkId: choice.networkId, revision: choice.revision, gate: choice.gate, title: choice.title, event: choice, payload: parse(choice.payload), versions: 1, options })
    }
  }
  return [...byCase.values()]
})
const gateHeads = computed(() => {
  const keys = new Map<string, { networkId: string, gate: string, title: string, takes: string, options: string[], network: string }>()
  for (const item of cases.value) {
    const key = `${item.networkId}:${item.gate}`
    if (keys.has(key)) continue
    const definition = gateDefinition(item.networkId, item.gate)
    keys.set(key, { networkId: item.networkId, gate: item.gate, title: item.title, takes: definition?.takes ?? '', options: item.options.map(option => option.title), network: props.view.collections.find(collection => collection.id === item.networkId)?.name ?? '' })
  }
  return [...keys.values()]
})
const fields = computed(() => [...new Set(cases.value.flatMap(item => Object.keys(item.payload)))].filter(field => !headline.includes(field) && field !== 'evidence' && field !== 'date'))
const isSaving = (item: Case) => saving.value[item.id]?.eventId === item.event.eventId
const open = (items: Case[]) => items.filter(item => !isSaving(item))
const openEvents = computed(() => open(cases.value).reduce((sum, item) => sum + item.versions, 0))
const headlineOf = (item: Case) => headline.map(key => item.payload[key]).find(value => typeof value === 'string' && value) as string | undefined ?? item.event.caseId
const rest = (item: Case) => Object.entries(item.payload).filter(([key]) => !headline.includes(key))
function format(key: string, value: unknown): string {
  if (key === 'date') { const parsed = Date.parse(String(value)); return Number.isNaN(parsed) ? String(value) : stamp(parsed, language.value) }
  if (key === 'evidence') return `${String(value).slice(0, 12)}…`
  if (typeof value === 'boolean') return t(value ? 'yes' : 'no')
  if (typeof value === 'number') return value.toLocaleString(language.value === 'de' ? 'de-AT' : 'en-GB')
  return typeof value === 'string' ? value : JSON.stringify(value)
}
function groups(items: Case[]): [string, Case[]][] {
  const map = new Map<string, Case[]>()
  for (const item of items) { const key = String(item.payload[groupBy.value]); (map.get(key) ?? map.set(key, []).get(key)!).push(item) }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
}
function choose(item: Case, key: string) {
  const option = item.options.find(option => option.key === key)
  if (!option) return
  const eventId = item.event.eventId
  saving.value = { ...saving.value, [item.id]: { eventId, title: option.title, channel: option.channel } }
  const { [item.id]: _previous, ...others } = failures.value
  failures.value = others
  emit('network', { type: 'choose', id: item.networkId, revision: item.revision, eventId, gate: item.gate, option: key }, (error) => {
    if (!error || saving.value[item.id]?.eventId !== eventId) return
    const { [item.id]: _refused, ...rest } = saving.value
    saving.value = rest
    failures.value = { ...failures.value, [item.id]: error }
  })
}
function chooseAll(items: Case[], key: string) { for (const item of open(items)) choose(item, key) }

const batches = computed(() => props.gates.filter(gate => openBatch.includes(gate.state)))
const graphBatches = computed(() => (props.graphGates?.batches ?? []).filter(batch => openBatch.includes(batch.state)))
const held = computed(() => props.graphGates?.held ?? [])
const approveGates = computed(() => props.view.collections.flatMap(collection => collection.gates.filter(gate => gate.kind === 'approve').map(gate => ({ ...gate, collection }))))
const podName = (id: string) => props.view.pods.find(pod => pod.id === id)?.name ?? id
const rights = computed(() => props.view.pods.flatMap(pod => [...pod.approvals.map(approval => ({ pod, approval, error: null as string | null })), ...(pod.queue.blocked && !pod.approvals.length ? [{ pod, approval: null, error: pod.queue.error }] : [])]))
const unknown = computed(() => props.view.pods.flatMap(pod => pod.unknown.map(item => ({ pod, ...item }))))
const requests = computed(() => (props.requests ?? []).filter(row => row.status !== 'collected' && row.status !== 'expired'))
const requestState = (status: SecretRequestRow['status']) => status === 'failed' ? t('failed') : status === 'filled' ? t('filled') : t('requested')
const total = computed(() => openEvents.value + batches.value.length + graphBatches.value.length + held.value.length + rights.value.length + unknown.value.length + requests.value.length)
defineExpose({ total })
</script>

<template>
  <div class="decisions-inbox">
    <h1>{{ t('Decisions') }}</h1>
    <div class="kpi-row" role="list">
      <div class="kpi" role="listitem">
        <b>{{ openEvents }}</b><span>{{ t('Questions') }}</span><small>{{ openEvents ? `${t('in {count} cases', { count: open(cases).length })} · ${gateHeads.map(head => head.network).join(', ')}` : t('no questions') }}</small>
      </div>
      <div class="kpi" role="listitem">
        <b>{{ batches.length + graphBatches.length }}</b><span>{{ t('Approvals waiting') }}</span><small>{{ batches.length + graphBatches.length ? t('batches decided at the IdP') : t('no waiting batches') }}</small>
      </div>
      <div class="kpi" role="listitem">
        <b>{{ rights.length }}</b><span>{{ t('Rights') }}</span><small>{{ rights.length ? t('{count} runtime requests', { count: rights.length }) : t('no open runtime request') }}</small>
      </div>
      <div class="kpi" role="listitem">
        <b>{{ unknown.length }}</b><span>{{ t('unknown deliveries') }}</span><small>{{ unknown.length ? t('{count} deliveries to reconcile', { count: unknown.length }) : t('nothing to reconcile') }}</small>
      </div>
      <div class="kpi" role="listitem">
        <b>{{ requests.length }}</b><span>{{ t('Secrets') }}</span><small>{{ requests.length ? t('{count} secret requests', { count: requests.length }) : t('no secret requests') }}</small>
      </div>
    </div>

    <h2>{{ t('Questions') }} <span class="meta">· {{ t('you choose one way per case') }}</span></h2>
    <div class="ctrls">
      <label class="meta">{{ t('Group by') }} <select v-model="groupBy" class="secondary"><option value="">–</option><option v-for="field in fields" :key="field" :value="field">{{ field }}</option></select></label>
      <label class="meta"><input v-model="raw" type="checkbox"> {{ t('show technical details') }}</label>
    </div>
    <div class="inbox" data-testid="choices">
      <p v-if="!cases.length" class="muted">
        {{ t('Nothing waits for your decision.') }}
      </p>
      <template v-for="head in gateHeads" :key="`${head.networkId}:${head.gate}`">
        <div class="gatehead">
          <b>{{ head.title }}</b> <span class="meta">{{ head.network }} · {{ t('takes {channel} · {count} ways: {options} · {open} open', { channel: head.takes, count: head.options.length, options: head.options.join(', '), open: open(cases.filter(item => item.networkId === head.networkId && item.gate === head.gate)).length }) }}</span>
        </div>
        <template v-for="[groupKey, list] in (groupBy ? groups(cases.filter(item => item.networkId === head.networkId && item.gate === head.gate)) : [['', cases.filter(item => item.networkId === head.networkId && item.gate === head.gate)] as [string, Case[]]])" :key="groupKey">
          <div :class="groupBy ? 'grp' : 'plain'">
            <div v-if="groupBy" class="row">
              <span class="pill off">{{ groupBy }} = {{ groupKey }}</span><span class="meta">{{ t('{count} cases', { count: list.length }) }}</span><span v-if="open(list).length > 1" class="opts"><button v-for="option in list[0]!.options" :key="option.key" class="secondary" type="button" @click="chooseAll(list, option.key)">{{ t('all: {title}', { title: option.title }) }}</button></span>
            </div>
            <template v-for="item in list" :key="item.id">
              <div v-if="isSaving(item)" class="item done" data-saving>
                <div class="row">
                  <span class="pill warn">{{ t('Saving: {title}', { title: saving[item.id]!.title }) }}</span><span class="subj">{{ headlineOf(item) }}</span><span class="meta">→ {{ saving[item.id]!.channel }}</span>
                </div>
              </div>
              <div v-else class="item" :data-case="item.id">
                <div class="row">
                  <span class="subj">{{ headlineOf(item) }}</span><span v-if="item.versions > 1" class="pill warn">{{ t('{count} versions', { count: item.versions }) }}</span>
                </div>
                <dl class="facts">
                  <template v-for="[key, value] in rest(item)" :key="key">
                    <dt>{{ key }}</dt><dd>{{ format(key, value) }}</dd>
                  </template>
                </dl>
                <div class="row auth">
                  <span class="pill pods">{{ item.title }}</span><span class="meta mono">{{ gateDefinition(item.networkId, item.gate)?.takes }} · {{ t('Case {id}', { id: item.event.caseId.slice(0, 8) }) }}</span>
                </div>
                <p v-if="failures[item.id]" class="error-message" role="alert">
                  {{ t('Not saved: {reason}', { reason: diagnostic(failures[item.id]!) }) }}
                </p>
                <div class="opts">
                  <button v-for="option in item.options" :key="option.key" class="secondary" type="button" :title="`→ ${option.channel}`" @click="choose(item, option.key)">
                    {{ option.title }}
                  </button>
                </div>
                <pre v-if="raw" class="raw">{{ JSON.stringify({ eventId: item.event.eventId, caseId: item.event.caseId, gate: item.gate, payload: item.payload }, null, 1) }}</pre>
              </div>
            </template>
          </div>
        </template>
      </template>
      <template v-for="item in held" :key="item.itemId">
        <div class="item">
          <div class="row">
            <span class="subj">{{ item.title }}</span><span class="pill pods">{{ item.gate }}</span>
          </div><div class="opts">
            <button v-for="option in (view.collections.find(collection => collection.id === item.workflowId)?.gates.find(gate => gate.key === item.gate)?.options ?? [])" :key="option.key" class="secondary" type="button" @click="emit('workflow', { type: 'gateChoose', id: item.workflowId, gate: item.gate, itemId: item.itemId, option: option.key })">
              {{ option.title }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <h2>{{ t('Approvals waiting') }} <span class="meta">· {{ t('batches decided at the IdP') }}</span></h2>
    <div class="inbox" data-testid="batches">
      <div v-if="!batches.length && !graphBatches.length" class="item">
        <div class="row">
          <span class="pill off">{{ t('none') }}</span><span class="meta">{{ approveGates.length ? approveGates.map(gate => t('Gate "{title}" has no frozen batch. A batch forms as soon as candidates arrive; at most 30 items, valid for 12 hours.', { title: gate.title })).join(' ') : t('no waiting batches') }}</span>
        </div>
      </div>
      <div v-for="batch in batches" :key="batch.id" class="item">
        <div class="row">
          <span class="pill" :class="batch.state === 'unknown' ? 'warn' : 'idp'">{{ label(batch.state) }}</span><span class="subj">{{ t('Approval batch') }} · {{ batch.gate }}</span><span class="meta">{{ podName(batch.podId) }} · {{ t('{count} items', { count: batch.items.length }) }} · {{ t('expires {time}', { time: stamp(batch.expiresAt, language) }) }}</span>
        </div>
        <p v-if="batch.error" class="error-message">
          {{ diagnostic(batch.error) }}
        </p>
        <ul class="plainlist">
          <li v-for="item in batch.items" :key="item.deliveryId">
            {{ item.title }} <span class="meta">{{ label(item.outcome) }}</span>
          </li>
        </ul>
        <p v-if="batch.state !== 'unknown'" class="meta">
          {{ t('Select the items to approve at the IdP; unselected items are denied.') }}
        </p>
        <label v-else class="meta">{{ t('Evidence') }} <input v-model="evidence[batch.id]" maxlength="4000"></label>
        <div class="opts">
          <template v-if="batch.url">
            <button v-if="desktop" class="secondary idp" type="button" @click="emit('network', { type: 'gateOpen', id: batch.networkId, revision: view.collections.find(collection => collection.id === batch.networkId)?.revision ?? 1, taskId: batch.id, generation: batch.generation })">{{ t('Decide at the IdP') }}</button>
            <a v-else class="secondary idp" :href="batch.url" target="_blank" rel="noopener">{{ t('Decide at the IdP') }}</a>
          </template>
          <button v-if="batch.state === 'unknown'" class="secondary" type="button" :disabled="!desktop || !evidence[batch.id]?.trim()" @click="emit('network', { type: 'gateDiscard', id: batch.networkId, revision: view.collections.find(collection => collection.id === batch.networkId)?.revision ?? 1, taskId: batch.id, generation: batch.generation, evidence: evidence[batch.id] ?? '' })">
            {{ t('Discard batch') }}
          </button>
        </div>
      </div>
      <div v-for="batch in graphBatches" :key="batch.id" class="item">
        <div class="row">
          <span class="pill" :class="batch.state === 'unknown' ? 'warn' : 'idp'">{{ label(batch.state) }}</span><span class="subj">{{ t('Approval batch') }} · {{ batch.gate }}</span><span class="meta">{{ podName(batch.podId) }} · {{ t('{count} items', { count: batch.items.length }) }} · {{ t('expires {time}', { time: stamp(batch.expiresAt, language) }) }}</span>
        </div>
        <ul class="plainlist">
          <li v-for="item in batch.items" :key="item.itemId">
            {{ item.title }}
          </li>
        </ul>
        <div class="opts">
          <template v-if="batch.url">
            <button v-if="desktop" class="secondary idp" type="button" @click="emit('workflow', { type: 'gateOpen', batchId: batch.id })">{{ t('Decide at the IdP') }}</button>
            <a v-else class="secondary idp" :href="batch.url" target="_blank" rel="noopener">{{ t('Decide at the IdP') }}</a>
          </template>
          <button v-if="batch.state === 'unknown'" class="secondary" type="button" :disabled="!desktop" @click="emit('workflow', { type: 'gateDiscard', batchId: batch.id })">
            {{ t('Discard batch') }}
          </button>
        </div>
      </div>
    </div>

    <h2>{{ t('Rights') }} <span class="meta">· {{ t('runtime requests decided at the IdP') }}</span></h2>
    <div class="inbox" data-testid="rights">
      <div v-if="!rights.length" class="item">
        <div class="row">
          <span class="pill off">{{ t('none open') }}</span>
        </div>
      </div>
      <div v-for="row in rights" :key="row.pod.id + (row.approval?.grantId ?? 'queue')" class="item">
        <div class="row">
          <span class="pill" :class="row.approval ? 'idp' : 'warn'">{{ row.approval ? t('Open approval') : t('blocked') }}</span><span class="subj">{{ row.pod.name }}</span><span class="meta">{{ row.approval ? row.approval.title : diagnostic(row.error) }}</span>
        </div>
        <div v-if="row.approval" class="opts">
          <button class="secondary idp" type="button" @click="emit('command', { channel: 'runs', body: { type: 'openApproval', podId: row.pod.id, runId: row.approval.runId, grantId: row.approval.grantId } })">
            {{ t('Decide at the IdP') }}
          </button>
        </div>
      </div>
    </div>

    <h2>{{ t('unknown deliveries') }} <span class="meta">· {{ t('you confirm what arrived outside') }}</span></h2>
    <div class="inbox" data-testid="deliveries">
      <div v-if="!unknown.length" class="item">
        <div class="row">
          <span class="pill off">{{ t('none') }}</span><span class="meta">{{ t('Appears when a Pod did not get an answer: run, key, destination, plus "Delivered" or "Not delivered, send again".') }}</span>
        </div>
      </div>
      <div v-for="item in unknown" :key="item.runId + item.key" class="item">
        <div class="row">
          <span class="pill warn">{{ t('unknown deliveries') }}</span><span class="subj">{{ item.pod.name }}</span><span class="meta mono">{{ item.key }} · {{ item.runId.slice(0, 8) }}</span>
        </div>
        <label class="meta">{{ t('Observation') }} <input v-model="evidence[item.runId + item.key]" maxlength="4000"></label>
        <div class="opts">
          <button class="secondary" type="button" :disabled="!evidence[item.runId + item.key]?.trim()" @click="emit('command', { channel: 'runs', body: { type: 'resolveHttp', podId: item.pod.id, runId: item.runId, key: item.key, applied: true, evidence: evidence[item.runId + item.key] ?? '' } })">
            {{ t('Delivered') }}
          </button>
          <button class="secondary" type="button" :disabled="!evidence[item.runId + item.key]?.trim()" @click="emit('command', { channel: 'runs', body: { type: 'resolveHttp', podId: item.pod.id, runId: item.runId, key: item.key, applied: false, evidence: evidence[item.runId + item.key] ?? '' } })">
            {{ t('Not delivered, send again') }}
          </button>
        </div>
      </div>
    </div>

    <h2>{{ t('Secrets') }} <span class="meta">· {{ t('requests through OpenApe Secrets') }}</span></h2>
    <div class="inbox" data-testid="secrets">
      <div v-for="row in requests" :key="row.id" class="item" data-testid="secret-request">
        <div class="row">
          <span class="pill" :class="row.status === 'failed' ? 'warn' : row.status === 'filled' ? 'pods' : 'warn'">{{ requestState(row.status) }}</span><span class="subj">{{ t('Secret {alias} for {pod}', { alias: row.alias, pod: podName(row.podId) }) }}</span>
        </div>
        <div class="meta">
          {{ row.purpose || t('no purpose given') }} · {{ t('requested {time}', { time: clock(row.createdAt, language) }) }} · {{ t('valid 24 h') }} · {{ t('Request {id}', { id: row.id }) }}{{ row.error ? ` · ${diagnostic(row.error)}` : '' }}
        </div>
        <div class="row auth">
          <span class="pill idp">{{ 'OpenApe Secrets' }}</span><span class="meta">{{ t('You fill it in the browser, sealed against the key of this Mac. Pods collects it once and the request is destroyed.') }}</span>
        </div>
        <div class="opts">
          <a v-if="row.status === 'requested'" class="secondary" :href="secretsOrigin ?? 'https://secrets.openape.ai'" target="_blank" rel="noopener">{{ t('Fill in at secrets.openape.ai') }}</a><button class="secondary" type="button" :disabled="!desktop" :title="desktop ? undefined : t('Only on the desktop')" @click="emit('secrets', { type: 'cancel', id: row.id })">
            {{ t('Cancel') }}
          </button>
        </div>
      </div>
      <div v-if="!requests.length" class="item">
        <div class="row">
          <span class="pill off">{{ t('none') }}</span><span class="meta">{{ t('Appears when Pods requests a secret through OpenApe Secrets.') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.decisions-inbox h1{font-size:22px;margin:24px 0 4px}.decisions-inbox h2{font-size:17px;margin:28px 0 10px}.decisions-inbox h2 .meta{font-weight:400}
.decisions-inbox .meta{font-size:13px;color:var(--muted)}.decisions-inbox .mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.decisions-inbox .ctrls{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin:10px 0}.decisions-inbox .ctrls label{display:inline-flex;gap:6px;align-items:center}.decisions-inbox .ctrls select{padding:4px 8px;font:inherit;font-size:13px}
.decisions-inbox .inbox{display:grid;gap:10px}.decisions-inbox .plain{display:grid;gap:10px}
.decisions-inbox .item{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:grid;gap:8px;min-width:0}
.decisions-inbox .item.done{border-color:var(--ok);background:var(--ok-soft)}.decisions-inbox .item.done .subj{color:var(--ok)}
.decisions-inbox .row{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}.decisions-inbox .subj{font-weight:600}
.decisions-inbox .facts{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:2px 12px;font-size:12px;margin:0}.decisions-inbox .facts dt{color:var(--muted)}.decisions-inbox .facts dd{margin:0;min-width:0;overflow-wrap:anywhere}
@media (max-width:700px){.decisions-inbox .facts{grid-template-columns:auto 1fr}}
.decisions-inbox .opts{display:flex;flex-wrap:wrap;gap:6px}.decisions-inbox .secondary{padding:6px 12px;font-size:14px;text-decoration:none}
.decisions-inbox .pill{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px;white-space:nowrap}
.decisions-inbox .pill.ok{background:var(--ok-soft);color:var(--ok)}.decisions-inbox .pill.warn{background:var(--warn-soft);color:var(--warn)}.decisions-inbox .pill.off{background:var(--tint);color:var(--muted)}.decisions-inbox .pill.idp{background:var(--idp-soft);color:var(--idp)}.decisions-inbox .pill.pods{background:var(--tint);color:var(--accent)}
.decisions-inbox .idp{border-color:var(--idp);background:var(--idp-soft);color:var(--idp);font-weight:600}
.decisions-inbox .gatehead{padding:4px 0}.decisions-inbox .grp{display:grid;gap:8px;padding:10px 12px;border:1px dashed var(--border);border-radius:8px}
.decisions-inbox .raw{font-family:ui-monospace,Menlo,monospace;font-size:11px;white-space:pre-wrap;background:var(--tint);border-radius:6px;padding:8px 10px;margin:0;color:var(--muted)}
.decisions-inbox .plainlist{margin:0;padding-left:18px;font-size:13px}.decisions-inbox label input[type=text],.decisions-inbox label input:not([type]){font:inherit;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);min-width:240px}
</style>
