<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CentralCommand } from '../../contracts/central'
import type { DomainCommand, DomainOverview, DomainQuestionView } from '../../contracts/domain-admin'
import type { MapView } from '../../contracts/map-view'
import type { SecretRequestRow, SecretsCommand } from '../../contracts/secrets'
import { diagnostic, label, language, t } from '../i18n'
import { clock, stamp } from '../utils/cadence'
import { decisionCounts, openSecretRequests, rightsRows } from '../utils/kpis'

/**
 * Everything that waits for the owner: questions of Pods, object approvals decided at the identity
 * provider, runtime rights, held work, uncertain actions and deliveries, and secret requests. Every
 * decision leaves as an existing owner command; nothing here approves on its own.
 */
/** Without `domain` (a browser), questions and approvals are answered in the Pods inbox at `inboxUrl`. */
const props = defineProps<{ view: MapView, domain: DomainOverview | null, desktop: boolean, requests?: SecretRequestRow[], secretsOrigin?: string, inboxUrl?: string }>()
const emit = defineEmits<{ domain: [command: DomainCommand, settle?: (error: string | null) => void], command: [command: CentralCommand], secrets: [command: SecretsCommand] }>()
const groupBy = ref('')
const raw = ref(false)
/** An answer is shown as saving until its question leaves the waiting list; a refused save returns it with its error. */
const saving = ref<Record<string, string>>({})
const failures = ref<Record<string, string>>({})
const evidence = ref<Record<string, string>>({})

const podName = (id: string) => props.view.pods.find(pod => pod.id === id)?.name ?? id
const questions = computed(() => props.domain?.questions ?? [])
const fields = computed(() => [...new Set(questions.value.flatMap(item => Object.keys(item.data)))])
const open = (items: DomainQuestionView[]) => items.filter(item => !saving.value[item.id])
function format(value: unknown): string {
  if (typeof value === 'boolean') return t(value ? 'yes' : 'no')
  if (typeof value === 'number') return value.toLocaleString(language.value === 'de' ? 'de-AT' : 'en-GB')
  return typeof value === 'string' ? value : JSON.stringify(value)
}
/** Questions per asking Pod and title; with a field selected, per value of that field. */
const sections = computed(() => {
  const map = new Map<string, { key: string, title: string, podId: string, items: DomainQuestionView[] }>()
  for (const item of questions.value) {
    const value = groupBy.value ? format(item.data[groupBy.value]) : ''
    const key = `${item.podId}:${item.title}:${value}`
    const section = map.get(key) ?? map.set(key, { key, title: groupBy.value ? `${item.title} · ${groupBy.value} = ${value}` : item.title, podId: item.podId, items: [] }).get(key)!
    section.items.push(item)
  }
  return [...map.values()]
})
function answer(item: DomainQuestionView, option: string) {
  saving.value = { ...saving.value, [item.id]: item.options.find(entry => entry.key === option)?.title ?? option }
  const { [item.id]: _previous, ...others } = failures.value
  failures.value = others
  emit('domain', { type: 'answer', questionId: item.id, option }, (error) => {
    if (!error) return
    const { [item.id]: _refused, ...rest } = saving.value
    saving.value = rest
    failures.value = { ...failures.value, [item.id]: error }
  })
}
function answerAll(items: DomainQuestionView[], option: string) { for (const item of open(items)) answer(item, option) }

const approvals = computed(() => props.domain?.approvals ?? [])
type ApprovalItem = (typeof approvals.value)[number]
/** One card per IdP batch request with one decision link; approvals still collecting group per Pod until sent. */
const batches = computed(() => {
  const map = new Map<string, { key: string, podId: string, items: ApprovalItem[] }>()
  for (const item of approvals.value.filter(entry => entry.state !== 'unknown')) {
    const key = item.batchId ?? `collecting:${item.podId}`
    ;(map.get(key) ?? map.set(key, { key, podId: item.podId, items: [] }).get(key)!).items.push(item)
  }
  return Array.from(map.values(), batch => ({
    ...batch,
    requested: batch.items.find(item => item.state === 'requested' && item.batchUrl),
    counts: Array.from(new Set(batch.items.map(item => item.state)), state => ({ state, count: batch.items.filter(item => item.state === state).length })),
    updatedAt: Math.max(...batch.items.map(item => item.updatedAt)),
  }))
})
const uncertain = computed(() => approvals.value.filter(item => item.state === 'unknown'))
const held = computed(() => props.domain?.held ?? [])
const effects = computed(() => props.domain?.unknownEffects ?? [])
const rights = computed(() => rightsRows(props.view))
const unknown = computed(() => props.view.pods.flatMap(pod => pod.unknown.map(item => ({ pod, ...item }))))
const requests = computed(() => openSecretRequests(props.requests ?? []))
const requestState = (status: SecretRequestRow['status']) => status === 'failed' ? t('failed') : status === 'filled' ? t('filled') : t('requested')
const intent = (value: unknown) => Object.entries(value && typeof value === 'object' ? value : {}).map(([key, item]) => `${key}: ${format(item)}`).join(' · ')
// The section counters are the KPI's own computation, so Automatisierungen and Entscheidungen show the same numbers.
const counts = computed(() => decisionCounts(props.view, props.requests ?? []))
const total = computed(() => counts.value.count)
defineExpose({ total })
</script>

<template>
  <div class="decisions-inbox">
    <h1>{{ t('Decisions') }}</h1>
    <div class="kpi-row" role="list">
      <div class="kpi" role="listitem">
        <b>{{ counts.questions }}</b><span>{{ t('Questions') }}</span><small>{{ questions.length ? [...new Set(questions.map(item => podName(item.podId)))].join(', ') : t('no questions') }}</small>
      </div>
      <div class="kpi" role="listitem">
        <b>{{ counts.approvals }}</b><span>{{ t('Approvals waiting') }}</span><small>{{ counts.approvals ? t('decided at the IdP') : t('no waiting approvals') }}</small>
      </div>
      <div class="kpi" role="listitem">
        <b>{{ counts.rights }}</b><span>{{ t('Rights') }}</span><small>{{ counts.rights ? t('{count} runtime requests', { count: counts.rights }) : t('no open runtime request') }}</small>
      </div>
      <div class="kpi" role="listitem">
        <b>{{ counts.reconcile }}</b><span>{{ t('To reconcile') }}</span><small>{{ counts.reconcile ? t('held work and uncertain actions') : t('nothing to reconcile') }}</small>
      </div>
      <div class="kpi" role="listitem">
        <b>{{ counts.secrets }}</b><span>{{ t('Secrets') }}</span><small>{{ counts.secrets ? t('{count} secret requests', { count: counts.secrets }) : t('no secret requests') }}</small>
      </div>
    </div>

    <h2>{{ t('Questions') }} <span class="meta">· {{ t('your answer becomes a rule the Pod reads') }}</span></h2>
    <div class="ctrls">
      <label class="meta">{{ t('Group by') }} <select v-model="groupBy" class="secondary"><option value="">–</option><option v-for="field in fields" :key="field" :value="field">{{ field }}</option></select></label>
      <label class="meta"><input v-model="raw" type="checkbox"> {{ t('show technical details') }}</label>
    </div>
    <div class="inbox" data-testid="questions">
      <p v-if="!domain && inboxUrl" class="muted">
        {{ t('Questions and approvals of your Pods are answered in the Pods inbox.') }} <a :href="inboxUrl">{{ t('Open the Pods inbox') }}</a>
      </p>
      <p v-else-if="!questions.length" class="muted">
        {{ t('Nothing waits for your decision.') }}
      </p>
      <div v-for="section in sections" :key="section.key" class="grp">
        <div class="row">
          <b>{{ section.title }}</b><span class="meta">{{ podName(section.podId) }} · {{ t('{count} open', { count: open(section.items).length }) }}</span>
          <span v-if="open(section.items).length > 1" class="opts"><button v-for="option in section.items[0]!.options" :key="option.key" class="secondary" type="button" @click="answerAll(section.items, option.key)">{{ t('all: {title}', { title: option.title }) }}</button></span>
        </div>
        <template v-for="item in section.items" :key="item.id">
          <div v-if="saving[item.id]" class="item done" data-saving>
            <div class="row">
              <span class="pill warn">{{ t('Saving: {title}', { title: saving[item.id]! }) }}</span><span class="subj">{{ item.body || item.key }}</span>
            </div>
          </div>
          <div v-else class="item" :data-question="item.id">
            <p class="question-body">
              {{ item.body || item.key }}
            </p>
            <dl class="facts">
              <template v-for="(value, key) in item.data" :key="key">
                <dt>{{ key }}</dt><dd>{{ format(value) }}</dd>
              </template>
            </dl>
            <p v-if="failures[item.id]" class="error-message" role="alert">
              {{ t('Not saved: {reason}', { reason: diagnostic(failures[item.id]!) }) }}
            </p>
            <div class="opts">
              <button v-for="option in item.options" :key="option.key" class="secondary" type="button" @click="answer(item, option.key)">
                {{ option.title }}
              </button>
            </div>
            <pre v-if="raw" class="raw">{{ JSON.stringify({ id: item.id, namespace: item.namespace, key: item.key, data: item.data }, null, 1) }}</pre>
          </div>
        </template>
      </div>
    </div>

    <h2>{{ t('Approvals waiting') }} <span class="meta">· {{ t('each action on one object, decided at the IdP') }}</span></h2>
    <div class="inbox" data-testid="approvals">
      <p v-if="!domain && inboxUrl && counts.approvals" class="muted">
        {{ t('Questions and approvals of your Pods are answered in the Pods inbox.') }} <a :href="inboxUrl">{{ t('Open the Pods inbox') }}</a>
      </p>
      <div v-else-if="!approvals.length" class="item">
        <div class="row">
          <span class="pill off">{{ t('none') }}</span><span class="meta">{{ t('no waiting approvals') }}</span>
        </div>
      </div>
      <div v-for="batch in batches" :key="batch.key" class="item" data-batch>
        <div class="row">
          <span class="subj">{{ batch.key.startsWith('collecting:') ? t('{count} objects are being collected for one request', { count: batch.items.length }) : t('{count} objects in one batch request', { count: batch.items.length }) }}</span><span class="meta">{{ podName(batch.podId) }} · {{ stamp(batch.updatedAt, language) }}</span>
        </div>
        <div class="row">
          <span v-for="entry in batch.counts" :key="entry.state" class="pill" :class="entry.state === 'requested' ? 'idp' : entry.state === 'approved' ? 'ok' : 'off'">{{ entry.count }} {{ label(entry.state) }}</span>
        </div>
        <div v-if="batch.requested" class="opts">
          <button v-if="desktop" class="secondary idp" type="button" @click="emit('domain', { type: 'openApproval', id: batch.requested.id })">
            {{ t('Decide at the IdP') }}
          </button>
          <a v-else class="secondary idp" :href="batch.requested.batchUrl!" target="_blank" rel="noopener">{{ t('Decide at the IdP') }}</a>
        </div>
        <details :open="batch.items.length <= 5">
          <summary class="meta">
            {{ t('Show objects') }}
          </summary>
          <ul class="plainlist">
            <li v-for="item in batch.items" :key="item.id">
              {{ item.title }} <span class="meta">· {{ label(item.state) }}</span>
            </li>
          </ul>
        </details>
      </div>
      <div v-for="approval in uncertain" :key="approval.id" class="item">
        <div class="row">
          <span class="pill warn">{{ label(approval.state) }}</span><span class="subj">{{ approval.title }}</span><span class="meta">{{ podName(approval.podId) }} · {{ stamp(approval.updatedAt, language) }}</span>
        </div>
        <p v-if="approval.reason" class="meta">
          {{ diagnostic(approval.reason) }}
        </p>
        <label class="meta">{{ t('Observation') }} <input v-model="evidence[approval.id]" maxlength="2000"></label>
        <div class="opts">
          <button class="secondary" type="button" :disabled="!evidence[approval.id]?.trim()" @click="emit('domain', { type: 'resolveApproval', id: approval.id, decision: 'renew', evidence: evidence[approval.id] ?? '' })">
            {{ t('Ask again') }}
          </button>
          <button class="secondary" type="button" :disabled="!evidence[approval.id]?.trim()" @click="emit('domain', { type: 'resolveApproval', id: approval.id, decision: 'withdraw', evidence: evidence[approval.id] ?? '' })">
            {{ t('Withdraw') }}
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
      <div v-for="row in rights" :key="row.pod.id + (row.kind === 'approval' ? row.approval.grantId : row.kind === 'grant' ? row.grant.grantId : 'queue')" class="item" :data-right="row.kind">
        <div class="row">
          <span class="pill" :class="row.kind === 'blocked' ? 'warn' : 'idp'">{{ row.kind === 'blocked' ? t('blocked') : t('Open approval') }}</span><span class="subj">{{ row.pod.name }}</span><span class="meta">{{ row.kind === 'approval' ? row.approval.title : row.kind === 'grant' ? t('Requested grant: {title}', { title: row.grant.title }) : diagnostic(row.error) }}</span>
        </div>
        <div v-if="row.kind === 'approval'" class="opts">
          <button class="secondary idp" type="button" @click="emit('command', { channel: 'runs', body: { type: 'openApproval', podId: row.pod.id, runId: row.approval.runId, grantId: row.approval.grantId } })">
            {{ t('Decide at the IdP') }}
          </button>
        </div>
        <div v-else-if="row.kind === 'grant'" class="opts">
          <button v-if="desktop" class="secondary idp" type="button" @click="emit('command', { channel: 'runs', body: { type: 'openGrant', podId: row.pod.id, grantId: row.grant.grantId } })">
            {{ t('Decide at the IdP') }}
          </button>
          <a v-else class="secondary idp" :href="row.grant.url" target="_blank" rel="noopener">{{ t('Decide at the IdP') }}</a>
        </div>
      </div>
    </div>

    <h2>{{ t('To reconcile') }} <span class="meta">· {{ t('you confirm what happened outside') }}</span></h2>
    <div class="inbox" data-testid="reconcile">
      <p v-if="!domain && inboxUrl && counts.reconcile > unknown.length" class="muted">
        {{ t('Held work and uncertain actions are settled in the Pods inbox.') }} <a :href="inboxUrl">{{ t('Open the Pods inbox') }}</a>
      </p>
      <div v-else-if="!held.length && !effects.length && !unknown.length" class="item">
        <div class="row">
          <span class="pill off">{{ t('none') }}</span><span class="meta">{{ t('Appears when a Pod could not finish safely or did not get an answer; nothing runs again until you state what happened.') }}</span>
        </div>
      </div>
      <div v-for="item in held" :key="item.key" class="item">
        <div class="row">
          <span class="pill warn">{{ label(item.state) }}</span><span class="subj">{{ t('Held work') }} · {{ item.operation }}</span><span class="meta mono">{{ item.object }}</span>
        </div>
        <p v-if="item.reason" class="meta">
          {{ diagnostic(item.reason) }}
        </p>
        <label class="meta">{{ t('Observation') }} <input v-model="evidence[item.key]" maxlength="2000"></label>
        <div class="opts">
          <button class="secondary" type="button" :disabled="!evidence[item.key]?.trim()" @click="emit('domain', { type: 'release', key: item.key, evidence: evidence[item.key] ?? '' })">
            {{ t('Release after review') }}
          </button>
        </div>
      </div>
      <div v-for="effect in effects" :key="effect.actionKey + effect.attempt" class="item">
        <div class="row">
          <span class="pill warn">{{ t('Uncertain action') }}</span><span class="subj">{{ podName(effect.podId) }} · {{ effect.operation }}</span><span class="meta">{{ stamp(effect.createdAt, language) }}</span>
        </div>
        <p class="meta mono">
          {{ intent(effect.intent) }}
        </p>
        <label class="meta">{{ t('Observation') }} <input v-model="evidence[effect.actionKey]" maxlength="2000"></label>
        <div class="opts">
          <button class="secondary" type="button" :disabled="!evidence[effect.actionKey]?.trim()" @click="emit('domain', { type: 'resolveEffect', actionKey: effect.actionKey, attempt: effect.attempt, applied: true, evidence: evidence[effect.actionKey] ?? '' })">
            {{ t('It happened') }}
          </button>
          <button class="secondary" type="button" :disabled="!evidence[effect.actionKey]?.trim()" @click="emit('domain', { type: 'resolveEffect', actionKey: effect.actionKey, attempt: effect.attempt, applied: false, evidence: evidence[effect.actionKey] ?? '' })">
            {{ t('It did not happen') }}
          </button>
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
.decisions-inbox .question-body{margin:0;white-space:pre-line;line-height:1.45;overflow-wrap:anywhere}
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
