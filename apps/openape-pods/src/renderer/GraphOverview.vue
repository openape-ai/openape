<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { CollectionDescription, StoredPod } from '../contracts/control'
import { descriptionSummary } from '../contracts/description'
import type { Organization } from '../contracts/groups'
import type { WorkflowDefinition, WorkflowView } from '../contracts/workflows'
import type { NetworkSummary, NetworkView } from '../contracts/networks'
import { dateTime, diagnostic, label, t } from './i18n'
import { arrangementLabel, waitingDecisions } from './utils/graph-presentation'
import type { ArrangementFilter } from './utils/graph-presentation'
import { sharingAvailable } from './utils/sharing'

interface Section { id: string | null, name: string, graphs: WorkflowDefinition[], networks: NetworkSummary[], pods: StoredPod[] }

export default defineComponent({
  props: {
    networks: { type: Object as PropType<NetworkView>, default: () => ({ networks: [] }) },
    descriptions: { type: Array as PropType<CollectionDescription[]>, default: () => [] },
    networkError: { type: String, default: '' },
    view: { type: Object as PropType<WorkflowView>, required: true },
    pods: { type: Array as PropType<StoredPod[]>, required: true },
    organization: { type: Object as PropType<Organization>, required: true },
    filter: { type: String as PropType<ArrangementFilter>, default: 'all' },
    readOnly: Boolean,
    sharing: { type: Boolean, default: sharingAvailable },
  },
  emits: ['select', 'openPod', 'create', 'createWorkflow', 'import', 'update:filter'],
  computed: {
    sections(): Section[] {
      const definitions = this.view.workflows.filter(item => this.filter === 'all' || item.mode === this.filter)
      const members = new Set([...this.view.workflows.flatMap(graph => graph.nodes.map(node => node.podId)), ...this.networks.networks.flatMap(network => network.podIds ?? [])])
      const current = this.pods.filter(pod => this.filter === 'all' && pod.lifecycle !== 'archived' && !members.has(pod.id))
      const grouped = new Set(this.organization.groups.flatMap(group => group.podIds))
      const groups = this.organization.groups.map(group => ({ id: group.id as string | null, name: group.name, graphs: definitions.filter(graph => graph.groupId === group.id), networks: this.networks.networks.filter(network => network.groupId === group.id && this.filter !== 'sequence'), pods: current.filter(pod => group.podIds.includes(pod.id)) }))
      const known = new Set(this.organization.groups.map(group => group.id))
      const loose = { id: null, name: t('Ungrouped'), networks: this.networks.networks.filter(network => !known.has(network.groupId) && this.filter !== 'sequence'), graphs: definitions.filter(graph => !graph.groupId || !known.has(graph.groupId)), pods: current.filter(pod => !grouped.has(pod.id)) }
      return [...groups, ...loose.graphs.length || loose.networks.length || loose.pods.length ? [loose] : []].filter(section => this.filter === 'all' || section.graphs.length || section.networks.length || section.pods.length)
    },
    summary(): string {
      return t('Networks connect Pods. Workflows define ordered processes.')
    },
  },
  methods: {
    t, dateTime, diagnostic, label,
    purpose(id: string): string { return descriptionSummary(this.descriptions.find(item => item.id === id)?.text ?? '') },
    waiting(graph: WorkflowDefinition) { return waitingDecisions(graph, this.view.gates) },
    meta(graph: WorkflowDefinition): string {
      const schedule = graph.paused && graph.enabled ? t('paused') : !graph.schedule || !graph.enabled ? t('Manual only') : graph.schedule.kind === 'interval' && graph.schedule.seconds === 3600 ? t('hourly') : graph.schedule.kind === 'daily' ? t('daily at {time}', { time: graph.schedule.time }) : t('scheduled')
      return `${t(arrangementLabel(graph.mode))} · ${t('Pods: {count}', { count: graph.nodes.length })} · ${schedule}`
    },
  },
})
</script>

<template>
  <section class="graph-overview">
    <header class="graph-overview-heading">
      <div>
        <h1>{{ t('Networks & workflows') }}</h1>
        <p class="muted">
          {{ summary }}
        </p>
      </div>
      <div v-if="!readOnly" class="graph-overview-actions">
        <button v-if="sharing" class="secondary" @click="$emit('import')">
          {{ t('Import') }}
        </button>
        <button v-if="filter !== 'sequence'" class="primary" @click="$emit('create', null)">
          {{ t('Create network') }}
        </button>
        <button v-if="filter !== 'channels'" class="secondary" @click="$emit('createWorkflow')">
          {{ t('Create workflow') }}
        </button>
      </div>
    </header>
    <p v-if="networkError" role="alert">
      {{ diagnostic(networkError) }}
    </p>
    <p v-if="readOnly" class="muted">
      {{ t('Persistent network details require a connected desktop runtime.') }}
    </p>
    <div class="graph-modes" role="group" :aria-label="t('Filter networks and workflows')">
      <button v-for="option in ([['all', 'All'], ['channels', 'Networks'], ['sequence', 'Workflows']] as const)" :key="option[0]" :aria-pressed="filter === option[0]" @click="$emit('update:filter', option[0])">
        {{ t(option[1]) }}
      </button>
    </div>
    <p v-if="!sections.length" class="muted">
      {{ t(filter === 'all' ? 'No network, workflow or pod yet.' : 'No results for this filter.') }}
    </p>
    <button v-if="!sections.length && filter !== 'all'" class="text-button" @click="$emit('update:filter', 'all')">
      {{ t('Show all') }}
    </button>
    <section v-for="section in sections" :key="section.id ?? 'ungrouped'" class="graph-group">
      <header>
        <h2>{{ section.name }}</h2>
        <button v-if="!readOnly && section.id && filter !== 'sequence'" class="text-button" @click="$emit('create', section.id)">
          {{ t('+ Create network in {group}', { group: section.name }) }}
        </button>
      </header>
      <div class="graph-cards">
        <button v-for="network in section.networks" :key="network.id" class="graph-card" @click="$emit('select', network.id)">
          <small>{{ t('Persistent network') }} · {{ t(network.state) }}</small><strong>{{ network.name }}</strong><span v-if="purpose(network.id)">{{ purpose(network.id) }}</span><span>{{ t('Decisions: {count}', { count: network.decisions ?? (networks.gates ?? []).filter(gate => gate.networkId === network.id && ['preparing', 'pending', 'consuming', 'unknown', 'superseded'].includes(gate.state)).length }) }}</span>
          <span>{{ t('Waiting: {count}', { count: (network.counts.pending ?? 0) + (network.counts.retry_wait ?? 0) }) }}</span>
          <span v-if="network.health.oldestPendingAt">{{ t('Oldest waiting item: {time}', { time: dateTime(network.health.oldestPendingAt) }) }}</span>
          <span v-if="network.health.lastFailure || network.health.intakeError || network.health.lastSchedulerError" class="graph-waiting">{{ t('Runtime needs attention') }}</span>
        </button>
        <button v-for="graph in section.graphs" :key="graph.id" class="graph-card" @click="$emit('select', graph.id)">
          <small>{{ meta(graph) }}</small>
          <strong>{{ graph.name }}</strong>
          <span v-if="purpose(graph.id)">{{ purpose(graph.id) }}</span>
          <span v-if="waiting(graph).choices" class="graph-waiting">{{ t('Choices waiting: {count}', { count: waiting(graph).choices }) }}</span>
          <span v-if="waiting(graph).approvals" class="graph-waiting">{{ t('Approvals waiting: {count}', { count: waiting(graph).approvals }) }}</span>
        </button>
      </div>
      <h3 v-if="section.pods.length" class="graph-single-heading">
        {{ t('Standalone Pods') }}
      </h3>
      <div v-if="section.pods.length" class="graph-cards">
        <button v-for="pod in section.pods" :key="pod.id" class="graph-card" @click="$emit('openPod', pod.id)">
          <small>{{ t('Pod') }} · {{ label(pod.lifecycle) }}</small>
          <strong>{{ pod.name }}</strong>
          <span v-if="pod.description">{{ pod.description }}</span>
          <span v-if="view.contracts?.[pod.id]" class="muted">{{ view.contracts[pod.id]!.summary }}</span>
        </button>
      </div>
    </section>
  </section>
</template>

<style>
.graph-overview{display:flex;flex-direction:column;gap:24px;min-width:0}
.graph-overview-heading,.graph-group header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.graph-overview>.graph-modes{align-self:flex-start;flex-wrap:wrap}.graph-single-heading{margin:4px 0 0;font-size:13px;color:var(--muted)}
.graph-overview-actions{display:flex;flex-wrap:wrap;gap:12px}
.graph-overview h1{margin:0;font-size:22px}
.graph-overview h2{margin:0;font-size:16px}
.graph-overview p{margin:4px 0 0}
.graph-group{display:flex;flex-direction:column;gap:12px}
.graph-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:16px}
.graph-card{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font:inherit;text-align:left;cursor:pointer}
.graph-card small{font-size:12px;font-weight:650;color:var(--muted)}
.graph-card strong{max-width:100%;font-size:16px;overflow-wrap:anywhere}
.graph-waiting{padding:4px 10px;border:1px solid var(--warn);border-radius:8px;background:light-dark(#f6ead3,#4a3a1c);color:light-dark(#4a2f08,#f6ead3);font-size:12px;font-weight:600}
</style>
