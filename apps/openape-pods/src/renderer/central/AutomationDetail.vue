<script setup lang="ts">
import { computed } from 'vue'
import type { CentralCommand } from '../../contracts/central'
import type { MapPod, MapResource, MapView } from '../../contracts/map-view'
import type { SecretRequestRow } from '../../contracts/secrets'
import type { PortableSourceSelection } from '../../contracts/sharing'
import { diagnostic, language, t } from '../i18n'
import { cadence, stamp } from '../utils/cadence'
import { nodeFacts } from '../utils/automation-layout'

/**
 * The detail page of one Pod, chain, network or system: state and lifecycle, schedule, membership,
 * access grouped by kind, channels with counters, the active script and the last run. Owner
 * commands leave as the existing central commands; network and workflow controls and the editor
 * are native and only enabled where the host is the desktop.
 */
export interface NetworkControl { type: 'pause' | 'activate', id: string, revision: number }
export type WorkflowControl = { type: 'pause', id: string, revision: number, paused: boolean } | { type: 'start', id: string, revision: number }
const props = defineProps<{ view: MapView, id: string, now: number, desktop: boolean, requests?: SecretRequestRow[], sharing?: boolean }>()
const emit = defineEmits<{ close: [], open: [id: string], command: [command: CentralCommand], network: [control: NetworkControl], workflow: [control: WorkflowControl], secret: [podId: string, alias: string | null], folder: [podId: string], editor: [podId: string], share: [selection: PortableSourceSelection] }>()
const pod = computed(() => props.view.pods.find(item => item.id === props.id) ?? null)
const collection = computed(() => props.view.collections.find(item => item.id === props.id) ?? null)
const system = computed(() => props.view.systems.find(item => item.id === props.id) ?? null)
const parent = computed(() => pod.value?.collection ? props.view.collections.find(item => item.id === pod.value!.collection) ?? null : null)
const members = computed(() => (collection.value?.members ?? []).map(id => props.view.pods.find(item => item.id === id)).filter((item): item is MapPod => !!item))
const facts = computed(() => nodeFacts(props.view, props.id))
const degraded = computed(() => !!pod.value && props.view.kpis.degraded.some(item => item.podId === pod.value!.id))
const paused = computed(() => collection.value ? collection.value.state !== 'active' : pod.value?.lifecycle === 'paused')
const title = computed(() => pod.value?.name ?? collection.value?.name ?? system.value?.name ?? props.id)
const kind = computed(() => collection.value ? t(collection.value.kind === 'network' ? 'Network' : 'Chain') : pod.value ? t('Pod') : system.value ? t('System') : '')
const group = computed(() => pod.value?.group ?? collection.value?.group ?? null)
const byKind = (kind: MapResource['kind']) => pod.value?.resources.filter(resource => resource.kind === kind) ?? []
const secrets = computed(() => pod.value?.secrets ?? [])
const openRequests = computed(() => (props.requests ?? []).filter(row => row.podId === props.id && row.status !== 'collected' && row.status !== 'expired'))
const requestState = (status: SecretRequestRow['status']) => status === 'failed' ? t('failed') : status === 'filled' ? t('filled') : t('requested')
const run = computed(() => pod.value?.lastRun ?? collection.value?.lastRun ?? null)
const gates = computed(() => (collection.value?.gates ?? []).map(gate => gate.kind === 'choose' ? t('{title}: you decide ({count} open)', { title: gate.title, count: gate.open }) : t('{title}: approval at the IdP ({count} batches)', { title: gate.title, count: gate.batches.pending ?? 0 })))
const numbers = computed(() => collection.value ? [[t('Deliveries'), String(collection.value.counts.done ?? 0)], [t('Open'), String(collection.value.counts.pending ?? 0)], ...(Object.keys(collection.value.flows).length ? [[t('Flows in 24 h'), Object.entries(collection.value.flows).map(([channel, count]) => `${channel} ${count}`).join(', ')]] : [])] : [])
const scriptPath = computed(() => pod.value ? `pods/${pod.value.id}/pod-script.mjs` : '')
const canControlCollection = computed(() => !!collection.value && props.desktop)
function toggle() {
  if (pod.value) { emit('command', { channel: 'scheduling', body: { type: 'lifecycle', podId: pod.value.id, revision: pod.value.revision, lifecycle: paused.value ? 'active' : 'paused' } }); return }
  if (!collection.value) return
  if (collection.value.kind === 'network' && !collection.value.bounded) emit('network', { type: paused.value ? 'activate' : 'pause', id: collection.value.id, revision: collection.value.revision })
  else emit('workflow', { type: 'pause', id: collection.value.id, revision: collection.value.revision, paused: !paused.value })
}
function runNow() {
  if (pod.value?.script) emit('command', { channel: 'runs', body: { type: 'start', podId: pod.value.id, expectedScript: pod.value.script } })
  else if (collection.value) emit('workflow', { type: 'start', id: collection.value.id, revision: collection.value.revision })
}
</script>

<template>
  <div class="automation-detail" role="dialog" :aria-label="t('Details')">
    <div class="dhead">
      <b>{{ title }}</b><button class="x" type="button" :aria-label="t('Close')" @click="emit('close')">
        ×
      </button>
    </div>
    <div class="row">
      <span v-if="paused" class="pill off">{{ t('paused') }}</span><span v-else-if="degraded" class="pill warn">{{ t('running with gaps') }}</span><span v-else class="pill ok">{{ t('active') }}</span>
      <span class="pill off">{{ kind }}</span><span v-if="group !== null || pod || collection" class="pill off">{{ group ?? t('without group') }}</span>
      <button v-if="pod || collection" class="secondary" type="button" :disabled="!!collection && !canControlCollection" :title="collection && !canControlCollection ? t('Only on the desktop') : undefined" @click="toggle">
        {{ paused ? t('Resume') : t('Pause') }}
      </button>
      <button v-if="(pod && !paused) || (collection?.kind === 'chain' && !paused)" class="secondary" type="button" :disabled="pod ? !pod.script : !canControlCollection" :title="pod && !pod.script ? t('no active script') : undefined" @click="runNow">
        {{ t('Run now') }}
      </button>
    </div>
    <div v-if="pod?.description" class="sec">
      <div>{{ pod.description }}</div>
    </div>
    <div v-if="pod?.scriptUpdate" class="sec" data-script-update>
      <div class="eyebrow">
        {{ t('Script changes') }}
      </div><div>{{ t('Updated by the assistant {when}: {previous} → {script}', { when: stamp(pod.scriptUpdate.at, language), previous: pod.scriptUpdate.previous.slice(0, 8), script: pod.scriptUpdate.script.slice(0, 8) }) }}</div>
    </div>
    <div v-if="system" class="sec">
      <div class="muted">
        {{ system.kind === 'application' ? `${system.how} · ${t('installed')}` : system.kind === 'service' ? `${t('https')} · ${system.how}` : system.how }}
      </div>
    </div>
    <div v-if="pod?.schedule || collection?.schedule" class="sec">
      <div class="eyebrow">
        {{ t('Schedule') }}
      </div><div>{{ cadence(pod?.schedule ?? collection?.schedule ?? null, pod?.channels.takes) }}</div>
    </div>
    <div v-if="collection" class="sec">
      <div class="eyebrow">
        {{ t('Members') }}
      </div><div class="members">
        <button v-for="member in members" :key="member.id" type="button" @click="emit('open', member.id)">
          {{ member.name }}<template v-if="member.lifecycle === 'paused'">
            · {{ t('paused') }}
          </template>
        </button>
      </div>
    </div>
    <div v-if="gates.length" class="sec">
      <div class="eyebrow">
        {{ t('Decision points') }}
      </div><div v-for="gate in gates" :key="gate">
        {{ gate }}
      </div>
    </div>
    <div v-if="numbers.length" class="sec">
      <div class="eyebrow">
        {{ t('Numbers') }}
      </div><div v-for="[label, value] in numbers" :key="label">
        <span class="muted">{{ label }}:</span> {{ value }}
      </div>
    </div>
    <div v-if="collection && sharing" class="sec">
      <div class="opts">
        <button class="secondary" type="button" @click="emit('share', { kind: collection.kind === 'network' ? 'network' : 'workflow', id: collection.id })">
          {{ t('Export…') }}
        </button>
      </div>
    </div>
    <div v-if="parent" class="sec">
      <div class="eyebrow">
        {{ t('Part of') }}
      </div><div class="members">
        <button type="button" @click="emit('open', parent.id)">
          {{ parent.name }}
        </button>
      </div>
    </div>
    <template v-if="pod">
      <div v-if="byKind('service').length" class="sec">
        <div class="eyebrow">
          {{ t('Services, via HTTPS') }}
        </div><div v-for="resource in byKind('service')" :key="resource.name">
          <b>{{ resource.name }}</b> <span class="muted">{{ resource.how }}</span> <span class="pill ok">{{ t('assigned') }}</span>
        </div>
      </div>
      <div v-if="byKind('application').length" class="sec">
        <div class="eyebrow">
          {{ t('Applications, installed') }}
        </div><div v-for="resource in byKind('application')" :key="resource.name + resource.how">
          <b>{{ resource.name }}</b> <span class="muted">{{ resource.how }}</span> <span class="pill ok">{{ t('assigned') }}</span>
        </div>
      </div>
      <div v-if="byKind('directory').length || byKind('reference').length || byKind('ssh').length" class="sec">
        <div class="eyebrow">
          {{ t('Folders and files') }}
        </div><div v-for="resource in [...byKind('directory'), ...byKind('reference'), ...byKind('ssh')]" :key="resource.kind + resource.name">
          <b>{{ resource.name }}</b> <span class="muted">{{ resource.how }}</span> <span class="pill ok">{{ t('assigned') }}</span>
        </div>
      </div>
      <div class="sec">
        <div class="eyebrow">
          {{ t('Secrets') }}
        </div>
        <div v-for="alias in secrets" :key="alias">
          <b>{{ alias }}</b> <span class="muted">{{ t('set · readable only in the script') }}</span> <button class="secondary small" type="button" @click="emit('secret', pod.id, alias)">
            {{ t('Replace') }}
          </button>
        </div>
        <div v-for="row in openRequests" :key="row.id" data-testid="secret-request">
          <b>{{ row.alias }}</b> <span class="pill" :class="row.status === 'failed' ? 'warn' : 'pods'">{{ requestState(row.status) }}</span> <span class="muted">{{ 'OpenApe Secrets' }}{{ row.purpose ? ` · ${row.purpose}` : '' }}{{ row.error ? ` · ${diagnostic(row.error)}` : '' }}</span>
        </div>
        <div v-if="!secrets.length && !openRequests.length" class="muted">
          {{ t('none') }}
        </div>
        <div class="opts">
          <button class="secondary" type="button" @click="emit('secret', pod.id, null)">
            {{ t('+ Secret') }}
          </button>
        </div>
        <slot name="secret" />
      </div>
    </template>
    <div v-if="facts.channels.length" class="sec">
      <div class="eyebrow">
        {{ t('Channels') }}
      </div><div v-for="channel in facts.channels" :key="channel.direction + channel.channel" class="mono">
        {{ channel.direction === 'gives' ? t('gives') : t('takes') }} {{ channel.channel }} ({{ channel.flow }})
      </div>
    </div>
    <div v-if="pod" class="sec">
      <div class="eyebrow">
        {{ t('For developers') }}
      </div><div class="opts">
        <button class="secondary" type="button" @click="emit('editor', pod.id)">
          {{ t('Open details') }}
        </button><button class="secondary" type="button" :disabled="!desktop" :title="desktop ? undefined : t('Only on the desktop')" @click="emit('folder', pod.id)">
          {{ t('Open in editor') }}
        </button><button v-if="sharing" class="secondary" type="button" @click="emit('share', { kind: 'pod', id: pod.id })">
          {{ t('Export…') }}
        </button><span class="muted mono">{{ scriptPath }}</span>
      </div><div class="muted mono">
        {{ t('Active script') }}: {{ pod.script ? pod.script.slice(0, 12) : t(pod.draft ? 'draft' : 'no active script') }}
      </div>
    </div>
    <div v-if="run" class="sec">
      <div class="eyebrow">
        {{ t('Latest run') }}
      </div><div class="run">
        <span class="muted">{{ stamp(run.at, language) }}</span><span class="pill" :class="run.state === 'completed' ? 'ok' : run.state === 'running' ? 'pods' : 'warn'">{{ diagnostic(run.state) }}</span><span>{{ run.summary }}</span>
      </div><div v-if="pod?.runs" class="muted">
        {{ t('{count} runs in total', { count: pod.runs }) }}
      </div>
    </div>
  </div>
</template>

<style>
.automation-detail{position:fixed;right:16px;top:56px;width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 90px);overflow:auto;z-index:9;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:14px 16px;display:grid;gap:8px;font-size:14px}
.automation-detail .dhead{display:flex;justify-content:space-between;align-items:center}
.automation-detail .x{font-size:18px;line-height:1;padding:2px 6px}
.automation-detail .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.automation-detail .sec{border-top:1px solid var(--border);padding-top:8px;display:grid;gap:4px}
.automation-detail .eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600}
.automation-detail .members{display:flex;flex-wrap:wrap;gap:4px}
.automation-detail .members button{font-size:12px;border:1px solid var(--border);background:var(--tint);border-radius:12px;padding:2px 9px;color:var(--text)}
.automation-detail .pill{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px;white-space:nowrap}
.automation-detail .pill.ok{background:var(--ok-soft);color:var(--ok)}.automation-detail .pill.warn{background:var(--warn-soft);color:var(--warn)}.automation-detail .pill.off{background:var(--tint);color:var(--muted)}.automation-detail .pill.pods{background:var(--tint);color:var(--accent)}
.automation-detail .secondary{padding:6px 12px;font-size:14px}.automation-detail .secondary.small{padding:1px 8px;font-size:12px}
.automation-detail .mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;overflow-wrap:anywhere}
.automation-detail .run{display:grid;grid-template-columns:auto auto 1fr;gap:8px;align-items:baseline;font-size:13px}
.automation-detail .opts{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.automation-detail .muted{font-size:13px;line-height:1.45}
</style>
