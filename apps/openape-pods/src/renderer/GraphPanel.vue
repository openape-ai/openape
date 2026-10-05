<script lang="ts">
import NetworkCreate from './NetworkCreate.vue'
import NetworkReplacement from './NetworkReplacement.vue'
import NetworkConversion from './NetworkConversion.vue'
import type { CentralNetworkRead } from '../contracts/central-networks'
import NetworkDetail from './NetworkDetail.vue'
import type { NetworkView } from '../contracts/networks'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { CollectionDescription, StoredPod, WorkspaceState } from '../contracts/control'
import CollectionDescriptionForm from './CollectionDescription.vue'
import type { GraphDetail, GraphNodeKind } from '../contracts/graphs'
import type { Organization } from '../contracts/groups'
import type { WorkflowCommand, WorkflowDefinition, WorkflowView } from '../contracts/workflows'
import GateReview from './GateReview.vue'
import GraphCreate from './GraphCreate.vue'
import GraphInspector from './GraphInspector.vue'
import type { InspectedNode } from './GraphInspector.vue'
import GraphOverview from './GraphOverview.vue'
import GraphView from './GraphView.vue'
import ItemTrace from './ItemTrace.vue'
import WorkflowPanel from './WorkflowPanel.vue'
import { dateTime, diagnostic, t } from './i18n'
import { edgeCounts, nodeCounts } from './utils/graph-counts'
import { contractScript, newGraph, withMember } from './utils/graph-create'
import type { CreateRequest } from './utils/graph-create'
import { traceRows } from './utils/item-trace'
import { arrangementLabel, waitingDecisions } from './utils/graph-presentation'
import type { ArrangementFilter } from './utils/graph-presentation'
import { sharingAvailable } from './utils/sharing'

export default defineComponent({
  components: { CollectionDescriptionForm, NetworkReplacement, NetworkConversion, NetworkCreate, NetworkDetail, GateReview, GraphCreate, GraphInspector, GraphOverview, GraphView, ItemTrace, WorkflowPanel },
  props: {
    view: { type: Object as PropType<WorkflowView>, required: true },
    pods: { type: Array as PropType<StoredPod[]>, required: true },
    organization: { type: Object as PropType<Organization>, required: true },
    descriptions: { type: Array as PropType<CollectionDescription[]>, default: () => [] },
    selectedId: { type: String, default: '' },
    readOnly: Boolean,
    readNetwork: Function as PropType<(command: CentralNetworkRead) => Promise<NetworkView>>,
    active: { type: Boolean, default: true },
    sharing: { type: Boolean, default: sharingAvailable },
  },
  emits: ['changed', 'select', 'openPod', 'workspace', 'share', 'import'],
  data() { return { networks: { networks: [] } as NetworkView, networkError: '', networkLoading: false, networkRequest: 0, networkTimer: null as ReturnType<typeof setTimeout> | null, closed: false, detail: null as GraphDetail | null, node: '', mode: 'plan' as 'plan' | 'run', overviewFilter: 'all' as ArrangementFilter, page: 'graph' as 'graph' | 'trace' | 'gate' | 'create' | 'legacy-create' | 'workflow-create' | 'convert' | 'replace', gate: '', createIn: null as string | null, busy: false, error: '' } },
  computed: {
    conversionUnavailable(): string {
      if (!this.definition?.groupId) return t('Choose a company.')
      if (this.networks.networks.some(item => item.groupId === this.definition?.groupId && item.state !== 'archived')) return t('This company already has a persistent network.')
      return this.networkError || this.networks.unavailableReason || ''
    },
    network() { return this.networks.networks.find(item => item.id === this.selectedId) },
    definition(): WorkflowDefinition | undefined { return this.view.workflows.find(item => item.id === this.selectedId) },
    groupName(): string { return this.organization.groups.find(group => group.id === this.definition?.groupId)?.name ?? t('Ungrouped') },
    names(): Record<string, string> {
      const definition = this.definition
      if (!definition) return {}
      return Object.fromEntries([...definition.nodes.map(node => [node.podId, this.pods.find(pod => pod.id === node.podId)?.name ?? node.podId]), ...definition.gates.map(gate => [`gate:${gate.key}`, gate.title])])
    },
    kinds(): Record<string, GraphNodeKind> { return this.detail?.nodeKinds ?? {} },
    inspected(): InspectedNode | null {
      const definition = this.definition; const detail = this.detail
      if (!definition || !detail || !this.node || !(this.node in this.names)) return null
      const gate = definition.gates.find(item => `gate:${item.key}` === this.node) ?? null
      const before = detail.edges.filter(edge => edge.to === this.node && edge.from.startsWith('gate:')).map(edge => this.names[edge.from]!)
      return { id: this.node, name: this.names[this.node]!, kind: detail.nodeKinds[this.node] ?? (gate ? 'gate' : 'code'), contract: detail.contracts[this.node] ?? null, gate, rights: detail.rights[this.node] ?? [], approval: before[0] ?? null, counts: nodeCounts(this.node, edgeCounts(detail.edges, detail.counts), detail.waiting) }
    },
    reviewed() { return this.definition?.gates.find(item => item.key === this.gate) },
    headline(): string {
      const detail = this.detail
      if (!detail?.lastRun) return t('Not run yet')
      const counts = waitingDecisions(this.definition!, this.view.gates)
      return [t('Last run {time}', { time: dateTime(detail.lastRun.startedAt) }), ...(counts.choices ? [t('Choices waiting: {count}', { count: counts.choices })] : []), ...(counts.approvals ? [t('Approvals waiting: {count}', { count: counts.approvals })] : [])].join(' · ')
    },
    rows() { return traceRows(this.detail?.trace?.events ?? [], this.names, this.kinds) },
  },
  watch: {
    async active(value: boolean) { if (value) await this.loadNetworks() },
    selectedId: { immediate: true, async handler() { this.page = 'graph'; this.node = ''; this.mode = 'plan'; await this.load() } },
  },
  async mounted() { await this.loadNetworks(); this.pollNetworks() },
  beforeUnmount() { this.closed = true; if (this.networkTimer) clearTimeout(this.networkTimer) },
  methods: {
    t, diagnostic, arrangementLabel,
    async loadNetworks() {
      if ((this.readOnly && !this.readNetwork) || !this.active || document.hidden || this.networkLoading) return
      this.networkLoading = true; const request = ++this.networkRequest
      try { const view = await (this.readNetwork ? this.readNetwork({ type: 'list' }) : window.pods.networks({ type: 'list' })); if (request === this.networkRequest) { this.networks = view; this.networkError = '' } }
      catch (error) { this.networkError = error instanceof Error ? error.message : String(error) }
      finally { this.networkLoading = false }
    },
    pollNetworks() { if (this.closed) return; this.networkTimer = setTimeout(async () => { await this.loadNetworks(); this.pollNetworks() }, 5000) },
    networkChanged(view: NetworkView) { this.networkRequest++; this.networks = view },
    networkCreated(view: NetworkView) { this.networkRequest++; this.networks = view; this.page = 'graph'; this.$emit('select', view.createdId) },
    async converted(view: NetworkView) {
      this.networkCreated(view)
      try { this.$emit('changed', await window.pods.workflows({ type: 'list' })) }
      catch (error) { this.error = error instanceof Error ? error.message : String(error) }
    },
    async send(command: WorkflowCommand): Promise<WorkflowView | null> {
      this.busy = true; this.error = ''
      try {
        const view = await window.pods.workflows(command)
        const { graph, ...rest } = view
        if (graph !== undefined) this.detail = graph
        this.$emit('changed', rest)
        return view
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); return null }
      finally { this.busy = false }
    },
    async load(key?: string) {
      if (!this.selectedId || !this.definition) { this.detail = null; return }
      // A published view carries its pictures along; there is no worker to ask.
      const published = this.view.graphs?.[this.selectedId]
      if (this.view.graphs) {
        const events = key === undefined ? undefined : published?.traces?.[key]
        this.detail = published ? { ...published, trace: key !== undefined && events ? { key, title: published.items.find(item => item.key === key)?.title ?? key, events } : null } : null
        return
      }
      if (this.readOnly) { this.detail = null; return }
      await this.send({ type: 'graph', id: this.selectedId, ...(key === undefined ? {} : { key }) })
    },
    async decide(command: WorkflowCommand) { if (await this.send(command)) await this.load() },
    async openTrace(key: string) { await this.load(key); this.page = 'trace' },
    openGate(key: string) { this.gate = key; this.page = 'gate' },
    startCreate(groupId: string | null) { this.createIn = groupId; this.page = 'create'; this.error = '' },
    described(id: string): CollectionDescription | undefined { return this.descriptions.find(item => item.id === id) },
    async describe(id: string, text: string) {
      this.error = ''
      try { await this.workspace({ type: 'describeCollection', id, revision: this.described(id)?.revision ?? 0, text }) }
      catch (error) { this.error = error instanceof Error ? error.message : String(error) }
    },
    async workspace(command: Parameters<typeof window.pods.workspace>[0]): Promise<WorkspaceState> {
      const state = await window.pods.workspace(command)
      this.$emit('workspace', state)
      return state
    },
    async create(request: CreateRequest) {
      this.busy = true; this.error = ''
      try {
        if (request.kind === 'group') { await this.workspace({ type: 'organize', revision: this.organization.revision, action: 'create', name: request.name }); this.page = 'graph'; return }
        if (request.kind === 'graph') {
          const command = newGraph(crypto.randomUUID(), request, this.view.contracts ?? {})
          this.$emit('changed', await window.pods.workflows(command)); this.$emit('select', command.id); this.page = 'graph'; return
        }
        const before = new Set(this.pods.map(pod => pod.id))
        const created = (await this.workspace({ type: 'create', name: request.name })).pods.find(pod => !before.has(pod.id))
        if (!created) throw new Error('Pod was not created')
        if (request.groupId) {
          const current = await this.workspace({ type: 'list' })
          await this.workspace({ type: 'organize', revision: current.organization.revision, action: 'move', podId: created.id, groupId: request.groupId })
        }
        const contract = { takes: request.takes, gives: request.gives, summary: request.summary }
        await window.pods.scripts({ type: 'save', podId: created.id, revision: created.revision, draftId: null, draftRevision: 0, code: contractScript(contract), capabilities: [] })
        const graph = this.view.workflows.find(item => item.id === request.graphId)
        if (graph) { this.$emit('changed', await window.pods.workflows(withMember(graph, created.id, contract))); this.$emit('select', graph.id); this.page = 'graph'; return }
        this.$emit('openPod', created.id)
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error) }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <NetworkReplacement v-if="page === 'replace' && network && !readOnly && !readNetwork" :key="network.id" :network="network" :pods="pods" :organization="organization" :workflows="view" :networks="networkError ? { ...networks, unavailableReason: networkError } : networks" @cancel="page = 'graph'" @changed="networkChanged($event); page = 'graph'" @open-pod="$emit('openPod', $event)" />
  <NetworkConversion v-else-if="page === 'convert' && definition && !readOnly && !readNetwork" :key="definition.id" :legacy="definition" :pods="pods" :organization="organization" :workflows="view" :networks="networkError ? { ...networks, unavailableReason: networkError } : networks" @cancel="page = 'graph'" @created="converted" @open-pod="$emit('openPod', $event)" />
  <NetworkCreate v-else-if="page === 'create' && !readOnly" :pods="pods" :organization="organization" :workflows="view" :networks="networkError ? { ...networks, unavailableReason: networkError } : networks" :group-id="createIn" @cancel="page = 'graph'" @workflow="page = 'workflow-create'" @created="networkCreated" @other="page = 'legacy-create'" @open-pod="$emit('openPod', $event)" />
  <GraphCreate v-else-if="page === 'legacy-create'" :view="view" :pods="pods" :organization="organization" :group-id="createIn" :busy="busy" :error="error" @create="create" @cancel="page = 'graph'" />
  <WorkflowPanel v-else-if="page === 'workflow-create' && !readOnly" create-on-mount :view="view" :pods="pods" @changed="$emit('changed', $event)" @select="$emit('select', $event); page = 'graph'" @cancel="page = 'graph'" />
  <div v-else-if="network" :key="network.id" class="graph-network">
    <p v-if="sharing && !readOnly && !readNetwork" class="graph-overview-actions">
      <button class="secondary" @click="$emit('share', { kind: 'network', id: network.id })">
        {{ t('Share') }}
      </button>
    </p>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <NetworkDetail :network="network" :view="networks" :read-network="readNetwork" :pods="pods" :description="described(network.id)" :read-only="readOnly" :active="active" @describe="describe(network!.id, $event)" @changed="networkChanged" @replace="page = 'replace'" @back="$emit('select', '')" @open-pod="$emit('openPod', $event)" />
  </div>
  <GraphOverview v-else-if="!definition" v-model:filter="overviewFilter" :networks="networks" :descriptions="descriptions" :network-error="networkError" :view="view" :pods="pods" :organization="organization" :read-only="readOnly" :sharing="sharing" @select="$emit('select', $event)" @open-pod="$emit('openPod', $event)" @create="startCreate" @create-workflow="page = 'workflow-create'" @import="$emit('import')" />
  <section v-else class="graph-panel">
    <header class="graph-panel-heading">
      <p>
        <button class="text-button" @click="$emit('select', '')">
          {{ t('Networks & workflows') }}
        </button> <span class="muted">/ {{ groupName }}</span>
      </p>
      <div class="graph-panel-title">
        <h1>{{ definition.name }}</h1>
        <button v-if="definition.mode === 'channels' && !readOnly && !readNetwork" class="secondary" aria-describedby="conversion-unavailable" :disabled="busy || !!conversionUnavailable" @click="page = 'convert'">
          {{ t('Review graph conversion') }}
        </button>
        <button v-if="sharing && !readOnly" class="secondary" @click="$emit('share', { kind: 'workflow', id: definition.id })">
          {{ t('Share') }}
        </button>
      </div>
      <p v-if="!readOnly && !readNetwork && definition.mode === 'channels' && conversionUnavailable" id="conversion-unavailable" role="status">
        {{ diagnostic(conversionUnavailable) }}
      </p>
      <p class="muted">
        {{ t(arrangementLabel(definition.mode)) }} · {{ headline }}
      </p>
    </header>
    <CollectionDescriptionForm :description="described(definition.id)" :label="t(definition.mode === 'sequence' ? 'What this workflow does' : 'What this network does')" :read-only="readOnly" @save="describe(definition!.id, $event)" />
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <GateReview v-if="page === 'gate' && reviewed" :gate="reviewed" :batches="(view.gates?.batches ?? []).filter(batch => batch.workflowId === definition!.id && batch.gate === gate)" :held="(view.gates?.held ?? []).filter(item => item.workflowId === definition!.id && item.gate === gate)" :busy="busy" :read-only="readOnly" @back="page = 'graph'" @exclude="(batchId: string, itemIds: string[]) => decide({ type: 'gateExclude', batchId, itemIds })" @choose="(itemId: string, option: string) => decide({ type: 'gateChoose', id: definition!.id, gate, itemId, option })" @discard="(batchId: string) => decide({ type: 'gateDiscard', batchId })" @approve="(batchId: string) => send({ type: 'gateOpen', batchId })" />
    <ItemTrace v-else-if="page === 'trace' && detail?.trace" :title="detail.trace.title" :rows="rows" @back="page = 'graph'" @open-gate="openGate" />
    <template v-else-if="detail">
      <GraphView :definition="definition" :detail="detail" :pods="pods" :selected="node" :mode="mode" @select="node = $event" @mode="mode = $event" />
      <div class="graph-panel-body">
        <GraphInspector v-if="inspected" :node="inspected" :channels="definition.channels" :run="mode === 'run'" :batches="(view.gates?.batches ?? []).filter(batch => batch.workflowId === definition!.id && `gate:${batch.gate}` === node)" @open-pod="$emit('openPod', $event)" @open-gate="openGate" />
        <p v-else class="muted graph-panel-hint">
          {{ t('Select a node to read its contract.') }}
        </p>
        <ItemTrace v-if="definition.mode === 'channels'" :items="detail.items" :names="names" @open="openTrace" />
      </div>
      <details class="graph-panel-settings" :open="definition.mode === 'sequence'">
        <summary>{{ t('Schedule, members and runs') }}</summary>
        <WorkflowPanel :read-only="readOnly" :view="view" :pods="pods" :selected-id="selectedId" @changed="$emit('changed', $event); load()" @select="$emit('select', $event)" @open-pod="$emit('openPod', $event)" />
      </details>
    </template>
    <!-- A worker that sends no graph detail still gets the panel it always had. -->
    <WorkflowPanel v-else-if="!busy" :read-only="readOnly" :view="view" :pods="pods" :selected-id="selectedId" @changed="$emit('changed', $event)" @select="$emit('select', $event)" @open-pod="$emit('openPod', $event)" />
  </section>
</template>

<style>
.graph-panel{display:flex;flex-direction:column;gap:16px;min-width:0}
.graph-panel-heading h1{margin:2px 0;font-size:22px;overflow-wrap:anywhere}
.graph-panel-heading p{margin:0}
.graph-panel-title{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.graph-panel-body{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);align-items:start;gap:16px}
.graph-panel-hint{margin:0;padding:20px;border:1px dashed var(--border);border-radius:12px}
@media (max-width:900px){.graph-panel-body{grid-template-columns:minmax(0,1fr)}}
</style>
