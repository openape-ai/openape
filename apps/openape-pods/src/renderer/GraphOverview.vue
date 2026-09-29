<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { Organization } from '../contracts/groups'
import type { WorkflowDefinition, WorkflowView } from '../contracts/workflows'
import { t } from './i18n'
import { sharingAvailable } from './utils/sharing'

interface Section { id: string | null, name: string, graphs: WorkflowDefinition[], pods: StoredPod[] }

export default defineComponent({
  props: {
    view: { type: Object as PropType<WorkflowView>, required: true },
    pods: { type: Array as PropType<StoredPod[]>, required: true },
    organization: { type: Object as PropType<Organization>, required: true },
    readOnly: Boolean,
    sharing: { type: Boolean, default: sharingAvailable },
  },
  emits: ['select', 'openPod', 'create', 'import'],
  computed: {
    sections(): Section[] {
      const members = new Set(this.view.workflows.flatMap(graph => graph.nodes.map(node => node.podId)))
      const current = this.pods.filter(pod => pod.lifecycle !== 'archived' && !members.has(pod.id))
      const grouped = new Set(this.organization.groups.flatMap(group => group.podIds))
      const groups = this.organization.groups.map(group => ({ id: group.id as string | null, name: group.name, graphs: this.view.workflows.filter(graph => graph.groupId === group.id), pods: current.filter(pod => group.podIds.includes(pod.id)) }))
      const known = new Set(this.organization.groups.map(group => group.id))
      const loose = { id: null, name: t('Ungrouped'), graphs: this.view.workflows.filter(graph => !graph.groupId || !known.has(graph.groupId)), pods: current.filter(pod => !grouped.has(pod.id)) }
      return [...groups, ...loose.graphs.length || loose.pods.length ? [loose] : []]
    },
    summary(): string {
      return t('Groups: {groups} · Graphs: {graphs} · Single pods: {pods}', { groups: this.organization.groups.length, graphs: this.view.workflows.length, pods: this.sections.reduce((sum, section) => sum + section.pods.length, 0) })
    },
  },
  methods: {
    t,
    waiting(graph: WorkflowDefinition): number {
      const gates = this.view.gates
      if (!gates) return 0
      return gates.batches.filter(batch => batch.workflowId === graph.id && batch.state === 'pending').reduce((sum, batch) => sum + batch.items.length, 0) + gates.held.filter(item => item.workflowId === graph.id).length
    },
    meta(graph: WorkflowDefinition): string {
      const schedule = graph.paused && graph.enabled ? t('paused') : !graph.schedule || !graph.enabled ? t('Manual only') : graph.schedule.kind === 'interval' && graph.schedule.seconds === 3600 ? t('hourly') : graph.schedule.kind === 'daily' ? t('daily at {time}', { time: graph.schedule.time }) : t('scheduled')
      return `${graph.mode === 'channels' ? t('Graph') : t('Sequence')} · ${t('Pods: {count}', { count: graph.nodes.length })} · ${schedule}`
    },
  },
})
</script>

<template>
  <section class="graph-overview">
    <header class="graph-overview-heading">
      <div>
        <h1>{{ t('Graphs') }}</h1>
        <p class="muted">
          {{ summary }}
        </p>
      </div>
      <div v-if="!readOnly" class="graph-overview-actions">
        <button v-if="sharing" class="secondary" @click="$emit('import')">
          {{ t('Import') }}
        </button>
        <button class="primary" @click="$emit('create', null)">
          {{ t('Create new') }}
        </button>
      </div>
    </header>
    <p v-if="!sections.length" class="muted">
      {{ t('No graph and no pod yet.') }}
    </p>
    <section v-for="section in sections" :key="section.id ?? 'ungrouped'" class="graph-group">
      <header>
        <h2>{{ section.name }}</h2>
        <button v-if="!readOnly && section.id" class="text-button" @click="$emit('create', section.id)">
          {{ t('+ Create in {group}', { group: section.name }) }}
        </button>
      </header>
      <div class="graph-cards">
        <button v-for="graph in section.graphs" :key="graph.id" class="graph-card" @click="$emit('select', graph.id)">
          <small>{{ meta(graph) }}</small>
          <strong>{{ graph.name }}</strong>
          <span v-if="waiting(graph)" class="graph-waiting">{{ t('Waiting for approval: {count}', { count: waiting(graph) }) }}</span>
        </button>
        <button v-for="pod in section.pods" :key="pod.id" class="graph-card" @click="$emit('openPod', pod.id)">
          <small>{{ t('Pod') }}</small>
          <strong>{{ pod.name }}</strong>
          <span v-if="view.contracts?.[pod.id]" class="muted">{{ view.contracts[pod.id]!.summary }}</span>
        </button>
      </div>
    </section>
  </section>
</template>

<style>
.graph-overview{display:flex;flex-direction:column;gap:24px;min-width:0}
.graph-overview-heading,.graph-group header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
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
