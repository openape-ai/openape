<script lang="ts">
import { defineComponent } from 'vue'
import { parseCentralNetworkRead } from '../contracts/central-networks'
import type { CentralNetworkRead } from '../contracts/central-networks'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { GraphDetail } from '../contracts/graphs'
import { deriveEdges } from '../contracts/graphs'
import type { NetworkDataPage, NetworkDetails, NetworkTracePage } from '../contracts/network-operations'
import type { NetworkCommand, NetworkPreview, NetworkSummary, NetworkView } from '../contracts/networks'
import type { WorkflowDefinition } from '../contracts/workflows'
import GraphView from './GraphView.vue'
import NetworkRetirement from './NetworkRetirement.vue'
import { dateTime, diagnostic, t } from './i18n'

export default defineComponent({
  components: { GraphView, NetworkRetirement },
  props: {
    network: { type: Object as PropType<NetworkSummary>, required: true },
    view: { type: Object as PropType<NetworkView>, required: true },
    pods: { type: Array as PropType<StoredPod[]>, required: true },
    readOnly: Boolean,
    readNetwork: Function as PropType<(command: CentralNetworkRead) => Promise<NetworkView>>,
    active: { type: Boolean, default: true },
  },
  emits: ['changed', 'back', 'openPod', 'replace'],
  data() { return { remoteGates: [] as NonNullable<NetworkView['gates']>, loading: false, activityLoading: false, recordsLoading: false, details: null as NetworkDetails | null, trace: null as NetworkTracePage | null, records: null as NetworkDataPage | null, tab: 'structure', caseId: null as string | null, selected: '', loadRequest: 0, error: '', actionError: '', activityError: '', recordsError: '', activityRequest: 0, recordsRequest: 0, now: Date.now(), busy: false, processing: false, processPods: [] as string[], reviewedPaused: [] as string[], budget: 10, preview: null as NetworkPreview | null, evidence: {} as Record<string, string>, timer: null as ReturnType<typeof setTimeout> | null, closed: false } },
  computed: {
    gates() { return (this.readNetwork ? this.remoteGates : this.view.gates ?? []).filter(gate => gate.networkId === this.network.id) },
    structure(): WorkflowDefinition | null {
      const definition = this.details?.definition
      if (!definition) return null
      return { id: definition.id, revision: definition.revision, name: definition.name, groupId: definition.groupId, mode: 'channels', schedule: null, enabled: false, paused: true, nextAt: null, values: [], nodes: definition.members.map(member => ({ podId: member.podId, after: [], handoff: false })), channels: definition.channels.map(channel => ({ name: channel.name, title: channel.title, fields: Object.keys(channel.schema.properties) })), gates: (definition.gates ?? []).map(gate => ({ key: gate.key, title: gate.title, kind: 'approve', takes: gate.channel, gives: gate.channel, excluded: null })) }
    },
    graph(): GraphDetail | null {
      if (!this.details || !this.structure) return null
      const definition = this.details.definition
      const edges = deriveEdges(definition.members, [])
      for (const gate of definition.gates ?? []) {
        for (const edge of edges.filter(edge => edge.to === gate.podId && edge.channel === gate.channel)) edge.to = `gate:${gate.key}`
        edges.push({ from: `gate:${gate.key}`, to: gate.podId, channel: gate.channel })
      }
      return { workflowId: definition.id, contracts: Object.fromEntries(definition.members.map(member => [member.podId, member.contract])), edges, nodeKinds: {}, diagnostics: [], rights: {}, lastRun: null, counts: [], waiting: {}, items: [], trace: null }
    },
    selectedMember() { return this.details?.members.find(member => member.podId === this.selected) },
    pausedSignature(): string { return this.pods.filter(pod => pod.lifecycle === 'paused').map(pod => pod.id).sort().join(',') },
    pausedIds(): string[] { return this.pods.filter(pod => pod.lifecycle === 'paused').map(pod => pod.id) },
    processProblem(): string {
      if (!this.processPods.length) return t('Select at least one Pod.')
      if (this.processPods.some(id => this.pausedIds.includes(id) && !this.reviewedPaused.includes(id))) return t('Explicitly include each paused Pod before continuing.')
      if (!Number.isSafeInteger(this.budget) || this.budget < 1 || this.budget > 100) return t('Choose a processing budget between 1 and 100.')
      return ''
    },
  },
  watch: {
    'network.revision': async function () { this.preview = null; await this.load() },
    processPods() { this.reviewedPaused = this.reviewedPaused.filter(id => this.processPods.includes(id)); this.preview = null },
    pausedSignature() { this.reviewedPaused = this.reviewedPaused.filter(id => this.pausedIds.includes(id)); this.preview = null },
    processing() { this.reviewedPaused = []; this.preview = null },
    async active(value: boolean) { if (value) await this.load() },
  },
  async mounted() { await this.load(); this.poll() },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, diagnostic, dateTime,
    eventLabel(kind: string): string {
      if (kind === 'composition-replaced-reviewed') return t('Composition replacement reviewed')
      if (kind === 'legacy-conversion-reviewed') return t('Legacy conversion reviewed')
      if (kind === 'event-accepted') return t('Item accepted')
      if (kind === 'invocation-settled') return t('Processing outcome')
      if (kind === 'instance-attention' || kind === 'network-maintenance-failed') return t('Runtime needs attention')
      if (kind.startsWith('gate-')) return t('Approval activity')
      if (kind.startsWith('process-now-')) return t('Bounded processing')
      if (kind === 'network-mail-read') return t('Assigned mailbox read')
      return t('Network activity')
    },
    eventSummary(event: NetworkTracePage['events'][number]): string {
      if (event.truncated) return ''
      const receipt = JSON.parse(event.body) as Record<string, unknown>
      return [receipt.message, receipt.error, receipt.reason, receipt.summary].filter(value => typeof value === 'string' && value).map(value => diagnostic(value as string)).join(' · ')
    },
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { this.now = Date.now(); if (this.active && !document.hidden && !this.busy) await this.load(false); this.poll() }, 5000) },
    async read(command: CentralNetworkRead): Promise<NetworkView> {
      if (this.readNetwork) return this.readNetwork(parseCentralNetworkRead(command))
      if (this.readOnly) throw new Error('Network details require a connected desktop')
      return window.pods.networks(command)
    },
    async load(includeTrace = true) {
      const request = ++this.loadRequest
      this.loading = true
      try {
        const response = await this.read({ type: 'detail', id: this.network.id, revision: this.network.revision })
        if (request !== this.loadRequest || this.closed) return
        this.details = response.details!
        if (this.readNetwork) this.remoteGates = response.gates ?? []
        else this.$emit('changed', response)
        this.error = ''
        if (includeTrace || !this.trace) await this.activity(null)
      }
      catch (error) { if (request === this.loadRequest && !this.closed) this.error = error instanceof Error ? error.message : String(error) }
      finally { if (request === this.loadRequest) this.loading = false }
    },
    async activity(before: number | null, selectedCase?: string | null) {
      const request = ++this.activityRequest
      this.activityLoading = true
      const caseId = selectedCase === undefined ? this.caseId : selectedCase
      try { const response = await this.read({ type: 'trace', id: this.network.id, revision: this.network.revision, before, caseId }); if (request !== this.activityRequest || this.closed) return; this.trace = response.trace!; this.caseId = caseId; this.activityError = '' }
      catch (error) { if (request !== this.activityRequest || this.closed) return; this.activityError = error instanceof Error ? error.message : String(error) }
      finally { if (request === this.activityRequest) this.activityLoading = false }
    },
    async dataPage(collectionId: string, after: string | null = null) {
      const request = ++this.recordsRequest
      this.recordsLoading = true
      try { const response = await this.read({ type: 'records', id: this.network.id, revision: this.network.revision, collectionId, after }); if (request !== this.recordsRequest || this.closed) return; this.records = response.records!; this.recordsError = '' }
      catch (error) { if (request !== this.recordsRequest || this.closed) return; this.recordsError = error instanceof Error ? error.message : String(error) }
      finally { if (request === this.recordsRequest) this.recordsLoading = false }
    },
    async send(command: NetworkCommand) {
      if (this.readOnly) return
      this.loadRequest++; this.busy = true; this.actionError = ''
      try {
        const response = await window.pods.networks(command); this.$emit('changed', response)
        if (response.preview) {
          this.preview = response.preview
        }
        else { this.preview = null; this.processing = false; if ('evidence' in command) { const key = command.type === 'reconcileEffect' ? `${command.runId}:${command.key}:${command.attempt}` : command.type === 'gateExclude' ? `${command.taskId}:${command.deliveryIds[0]}` : 'runId' in command ? command.runId : command.taskId; delete this.evidence[key] }; await this.load() }
      }
      catch (error) { this.preview = null; this.actionError = error instanceof Error ? error.message : String(error); await this.$nextTick(); (this.$refs.actionError as HTMLElement)?.focus() }
      finally { this.busy = false; if (this.preview) { await this.$nextTick(); (this.$refs.confirmProcess as HTMLElement)?.focus() } }
    },
    async previewProcess() {
      if (this.processProblem) return
      await this.send({ type: 'preview', id: this.network.id, revision: this.network.revision, podIds: [...this.processPods], pausedPodIds: this.reviewedPaused.filter(id => this.processPods.includes(id) && this.pausedIds.includes(id)), budget: this.budget })
    },
  },
})
</script>

<template>
  <section class="network-detail">
    <header>
      <button class="text-button" @click="$emit('back')">
        {{ t('Networks & workflows') }}
      </button><h1>{{ network.name }}</h1><p>{{ t('Persistent network') }} · {{ t(network.state) }}</p>
    </header>
    <p v-if="network.state === 'archived' && (readOnly || readNetwork)" role="status">
      {{ t('This network is archived. History and Pod identities remain available; execution cannot resume.') }}
    </p>
    <p v-if="error" role="alert" class="error-message">
      <span v-if="!readOnly">{{ t('Runtime access failed. Refresh before issuing another action.') }}</span> {{ diagnostic(error) }} <button v-if="!readOnly" class="secondary" @click="load()">
        {{ t('Refresh') }}
      </button>
    </p>
    <p v-if="loading && !details" role="status">
      {{ t('Loading workspace…') }}
    </p>
    <p v-if="actionError" ref="actionError" tabindex="-1" role="alert" class="error-message">
      {{ diagnostic(actionError) }}
    </p>
    <div v-if="!readOnly && !readNetwork && network.state !== 'archived'" class="network-actions">
      <button v-if="network.state === 'paused'" class="secondary" :disabled="busy || !!view.unavailableReason" @click="$emit('replace')">
        {{ t('Edit paused composition') }}
      </button>
      <button class="primary" :disabled="busy || (network.state !== 'active' && !!error)" @click="send({ type: network.state === 'active' ? 'pause' : 'activate', id: network.id, revision: network.revision })">
        {{ t(network.state === 'active' ? 'Pause network' : 'Activate network') }}
      </button>
      <button class="secondary" :disabled="busy || !!error" :aria-expanded="processing" @click="processing = !processing; preview = null">
        {{ t('Process now') }}
      </button>
    </div>
    <p>
      {{ t('Waiting: {count}', { count: (network.counts.pending ?? 0) + (network.counts.retry_wait ?? 0) }) }} · {{ t('Processing: {count}', { count: network.counts.claimed ?? 0 }) }} · {{ t('Decisions: {count}', { count: network.state === 'archived' ? 0 : !details && network.decisions !== undefined ? network.decisions : gates.filter(gate => ['pending', 'unknown', 'preparing', 'consuming', 'superseded'].includes(gate.state)).length }) }}
    </p>
    <button v-if="details?.failures.length" class="text-button network-failure-count" @click="tab = 'decisions'">
      {{ t('Failures requiring review: {count}', { count: details.failures.length }) }}
    </button>
    <p v-if="network.health.oldestPendingAt">
      {{ t('Oldest waiting item: {time}', { time: dateTime(network.health.oldestPendingAt) }) }}
    </p>
    <details v-if="network.health.intakeError || network.health.lastSchedulerError">
      <summary>{{ t('Runtime needs attention') }}</summary><pre>{{ diagnostic(network.health.intakeError ?? network.health.lastSchedulerError!) }}</pre>
    </details>
    <form v-if="processing && details && network.state !== 'archived'" class="network-process" @submit.prevent="previewProcess">
      <h2>{{ t('Bounded processing') }}</h2><p>{{ t('This does not enable timers. Only ready work and selected sources can run.') }}</p>
      <template v-if="!preview">
        <fieldset>
          <legend>{{ t('Select at least one Pod.') }}</legend>
          <div v-for="member in details.members" :key="member.podId">
            <label><input v-model="processPods" type="checkbox" :value="member.podId" :disabled="!member.triggers.includes('manual')" :aria-describedby="!member.triggers.includes('manual') ? `manual-${member.podId}` : undefined">{{ member.name }}<span v-if="pausedIds.includes(member.podId)" class="badge">{{ t('paused') }}</span></label><label v-if="processPods.includes(member.podId) && pausedIds.includes(member.podId)" class="paused-consent"><input v-model="reviewedPaused" type="checkbox" :value="member.podId">{{ t('Include paused Pod {name}', { name: member.name }) }}</label><span v-if="!member.triggers.includes('manual')" :id="`manual-${member.podId}`">{{ t('This script does not allow manual runs.') }}</span>
          </div>
        </fieldset>
        <label>{{ t('Maximum invocations') }}<input v-model.number="budget" type="number" min="1" max="100"></label><p id="network-process-problem" role="status">
          {{ processProblem }}
        </p><button class="primary" :disabled="busy || !!processProblem" aria-describedby="network-process-problem">
          {{ t('Preview processing') }}
        </button>
      </template>
      <template v-else>
        <p ref="confirmProcess" tabindex="-1">
          {{ t('Sources: {sources} · Consumers: {consumers}', { sources: preview.sources.length, consumers: preview.consumers.length }) }}
        </p><p>{{ t('Valid until: {time}', { time: dateTime(preview.expiresAt) }) }}</p><ul>
          <li v-for="podId in preview.podIds" :key="podId">
            {{ pods.find(pod => pod.id === podId)?.name ?? podId }} · {{ t(preview.sources.includes(podId) ? 'Source' : 'Consumer') }}<span v-if="preview.pausedPodIds.includes(podId)"> · {{ t('Explicitly included paused Pod') }}</span>
          </li>
        </ul>
        <p v-if="now >= preview.expiresAt" role="status">
          {{ t('This preview expired. Change the selection and review again.') }}
        </p><button type="button" class="primary" :disabled="busy || now >= preview.expiresAt" @click="send({ type: 'process', id: network.id, revision: network.revision, previewId: preview.id })">
          {{ t('Process up to {count}', { count: preview.budget }) }}
        </button><button type="button" class="secondary" @click="preview = null; reviewedPaused = []">
          {{ t('Change selection') }}
        </button>
      </template>
    </form>
    <NetworkRetirement v-if="!readOnly && !readNetwork" :network="network" :pods="pods" @changed="$emit('changed', $event); load()" />
    <div class="graph-modes" role="group" :aria-label="t('Network views')">
      <button v-for="option in ([['structure', 'Structure'], ['activity', 'Recent recorded activity'], ['decisions', 'Decisions and failures'], ['data', 'Shared data']] as const)" :key="option[0]" :aria-pressed="tab === option[0]" @click="tab = option[0]">
        {{ t(option[1]) }}
      </button>
    </div>
    <template v-if="details && tab === 'structure'">
      <section class="network-timers">
        <h2>{{ t('Independent source timers') }}</h2><p>{{ t('Each source runs independently. Paused Pods and paused networks do not start timers.') }}</p>
        <ul>
          <li v-for="member in details.definition.members.filter(member => member.source)" :key="member.podId">
            <strong>{{ pods.find(pod => pod.id === member.podId)?.name ?? member.podId }}</strong> · {{ member.source!.schedule?.kind === 'interval' ? t('Every {seconds} seconds', { seconds: member.source!.schedule.seconds }) : member.source!.schedule?.kind === 'daily' ? `${member.source!.schedule.time} · ${member.source!.schedule.timezone}` : t('Manual only') }}<span v-if="pausedIds.includes(member.podId)"> · {{ t('paused') }}</span>
          </li>
        </ul>
      </section>
      <GraphView v-if="structure && graph" structure-only :definition="structure" :detail="graph" :pods="pods" :selected="selected" @select="selected = $event; if ($event.startsWith('gate:')) tab = 'decisions'" />
      <section v-if="selectedMember" class="network-member-detail">
        <h2>{{ selectedMember.name }}</h2><p v-if="selectedMember.diagnostic" role="alert">
          {{ diagnostic(selectedMember.diagnostic) }}
        </p>
        <p>{{ t('Receives') }}: {{ details.definition.members.find(member => member.podId === selectedMember!.podId)!.contract.takes.join(', ') || t('None') }}</p><p>{{ t('Produces') }}: {{ details.definition.members.find(member => member.podId === selectedMember!.podId)!.contract.gives.join(', ') || t('None') }}</p><p v-for="resource in selectedMember.resources" :key="resource.name">
          {{ resource.name }} · {{ resource.state }}
        </p><p v-if="selectedMember.resourcesMore">
          {{ t('This view shows the first {count} entries.', { count: 256 }) }}
        </p><p>{{ t('Requested rights') }}: {{ selectedMember.diagnostic ? t('Unavailable') : selectedMember.capabilities.join(', ') || t('None') }}</p><p v-for="field in selectedMember.values" :key="field.name">
          {{ field.name }} · {{ t(field.origin === 'pod' ? 'Pod override' : field.origin === 'composition' ? 'Shared value' : 'Definition default') }}: {{ field.kind === 'secret-reference' ? t('Protected reference') : String(field.value) }}
        </p><button class="text-button" @click="$emit('openPod', selectedMember.podId)">
          {{ t('Open Pod') }}
        </button>
      </section>
      <p v-for="join in details.definition.joins ?? []" :key="join.id">
        {{ t('Explicit join: {channels}', { channels: join.channels.join(', ') }) }}
      </p>
    </template>
    <section v-else-if="tab === 'activity'">
      <p v-if="activityError" role="alert" class="error-message">
        {{ diagnostic(activityError) }} <button class="secondary" :disabled="activityLoading" @click="activity(null)">
          {{ t('Retry') }}
        </button>
      </p>
      <p v-if="activityLoading" role="status">
        {{ t('Loading workspace…') }}
      </p>
      <h2>{{ t('Recent recorded activity') }}</h2><p>{{ t('Recorded receipts describe what happened. They do not imply that an external effect succeeded.') }}</p><button v-if="caseId" class="text-button" :disabled="activityLoading" @click="activity(null, null)">
        {{ t('All recent cases') }}
      </button><p v-if="caseId">
        {{ t('Selected case') }}: {{ caseId }}
      </p><p v-if="trace && !trace.events.length && !activityLoading">
        {{ t('No recorded activity in this page.') }}
      </p><article v-for="event in trace?.events ?? []" :key="event.id">
        <p>
          {{ dateTime(event.at) }} · {{ eventLabel(event.kind) }} <button v-if="event.caseId" class="text-button" :disabled="activityLoading" @click="activity(null, event.caseId)">
            {{ t('Open case') }}
          </button>
        </p><p v-if="eventSummary(event)">
          {{ eventSummary(event) }}
        </p><button v-if="event.kind === 'instance-attention' || event.kind === 'invocation-settled'" class="text-button" @click="tab = 'decisions'">
          {{ t('Review decisions and failures') }}
        </button><details><summary>{{ t('Receipt details') }}</summary><p>{{ event.kind }}</p><pre>{{ event.body }}</pre></details><p v-if="event.truncated">
          {{ t('Preview shortened. The original receipt is retained.') }}
        </p>
      </article><button v-if="trace?.before" class="secondary" :disabled="activityLoading" @click="activity(trace.before)">
        {{ t('Older activity') }}
      </button>
    </section>
    <section v-else-if="tab === 'decisions' && details">
      <p v-if="readOnly">
        {{ t('Read-only here. Resolve decisions and failures in the desktop app.') }}
      </p>
      <h2>{{ t('Decisions and failures') }}</h2><p v-if="!details.failures.length && !gates.length">
        {{ t('No decisions or failures need attention.') }}
      </p><p>{{ t('Unknown external actions are never repeated automatically. Inspect and reconcile their outcome first.') }}</p>
      <article v-for="failure in details.failures" :key="failure.runId">
        <h3>{{ details.members.find(member => member.podId === failure.podId)?.name }}</h3><p>{{ diagnostic(failure.reason) }}</p><details><summary>{{ t('Receipt details') }}</summary>{{ failure.runId }} · {{ failure.generation }}</details>
        <p v-if="failure.inspectedAt === null">
          {{ t('First inspect the stopped process. Then reconcile uncertain actions before retrying or disposing of work.') }}
        </p>
        <button v-if="!readOnly && !readNetwork && network.state !== 'archived'" class="secondary" :disabled="busy" @click="send({ type: 'inspect', id: network.id, revision: network.revision, runId: failure.runId, generation: failure.generation })">
          {{ t('Inspect stopped process') }}
        </button>
        <p v-if="failure.inspectedAt !== null">
          {{ t('Stopped process verified at {time}', { time: dateTime(failure.inspectedAt) }) }}
        </p>
        <div v-for="effect in failure.effects" :key="`${effect.key}:${effect.attempt}`">
          <p>{{ effect.key }} · {{ effect.state }}</p>
          <template v-if="!readOnly && !readNetwork && network.state !== 'archived' && ['intent', 'unknown'].includes(effect.state)">
            <label>{{ t('Evidence for {name}', { name: effect.key }) }}<textarea v-model="evidence[`${failure.runId}:${effect.key}:${effect.attempt}`]" maxlength="4000" /></label>
            <button v-for="outcome in (['confirmed_applied', 'confirmed_not_applied'] as const)" :key="outcome" class="secondary" :disabled="busy || !evidence[`${failure.runId}:${effect.key}:${effect.attempt}`]?.trim() || failure.inspectedAt === null" @click="send({ type: 'reconcileEffect', id: network.id, revision: network.revision, runId: failure.runId, generation: failure.generation, key: effect.key, attempt: effect.attempt, sequence: effect.sequence, outcome, evidence: evidence[`${failure.runId}:${effect.key}:${effect.attempt}`] ?? '' })">
              {{ t(outcome === 'confirmed_applied' ? 'Confirm action happened' : 'Confirm action did not happen') }}
            </button>
          </template>
        </div><p v-if="failure.effectsMore">
          {{ t('This view shows the first {count} entries.', { count: 50 }) }}
        </p>
        <label v-if="!readOnly && !readNetwork && network.state !== 'archived'">{{ t('Evidence for {name}', { name: failure.runId }) }}<textarea v-model="evidence[failure.runId]" maxlength="4000" /></label><div v-if="failure.conflict && !readOnly && !readNetwork && network.state !== 'archived'">
          <button v-for="decision in (['retainOriginal', 'discardBatch'] as const)" :key="decision" class="secondary" :disabled="busy || !evidence[failure.runId]?.trim() || failure.inspectedAt === null" @click="send({ type: 'resolveConflict', id: network.id, revision: network.revision, runId: failure.runId, generation: failure.generation, identityHash: failure.conflict, decision, evidence: evidence[failure.runId] ?? '' })">
            {{ t(decision === 'retainOriginal' ? 'Retain original acceptance' : 'Discard conflicting batch') }}
          </button>
        </div><div v-if="!readOnly && !readNetwork && network.state !== 'archived'" class="network-actions">
          <button class="secondary" :disabled="busy || failure.kind === 'uncertain'" @click="send({ type: 'retry', id: network.id, revision: network.revision, runId: failure.runId, generation: failure.generation })">
            {{ t('Retry retained work') }}
          </button><button class="secondary" :disabled="busy || !evidence[failure.runId]?.trim()" @click="send({ type: 'discardFailure', id: network.id, revision: network.revision, runId: failure.runId, generation: failure.generation, evidence: evidence[failure.runId] ?? '' })">
            {{ t('Dispose with evidence') }}
          </button>
        </div>
      </article>
      <article v-for="gate in gates" :key="gate.id">
        <h3>{{ gate.gate }} · {{ t(gate.state) }}</h3><p v-if="gate.error">
          {{ diagnostic(gate.error) }}
        </p><ul>
          <li v-for="item in gate.items" :key="item.deliveryId">
            {{ item.title }} · {{ item.outcome }}
            <label v-if="!readOnly && !readNetwork && network.state !== 'archived' && gate.state === 'pending' && item.outcome === 'held'">{{ t('Evidence to exclude {name}', { name: item.title }) }}<textarea v-model="evidence[`${gate.id}:${item.deliveryId}`]" maxlength="4000" /></label><button v-if="!readOnly && !readNetwork && network.state !== 'archived' && gate.state === 'pending' && item.outcome === 'held'" class="secondary" :disabled="busy || !evidence[`${gate.id}:${item.deliveryId}`]?.trim()" @click="send({ type: 'gateExclude', id: network.id, revision: network.revision, taskId: gate.id, generation: gate.generation, deliveryIds: [item.deliveryId], evidence: evidence[`${gate.id}:${item.deliveryId}`] ?? '' })">
              {{ t('Exclude {name} with evidence', { name: item.title }) }}
            </button>
          </li>
        </ul><div v-if="!readOnly && !readNetwork && network.state !== 'archived'" class="network-actions">
          <button v-if="gate.state === 'pending'" class="primary" :disabled="busy || !gate.url" @click="send({ type: 'gateOpen', id: network.id, revision: network.revision, taskId: gate.id, generation: gate.generation })">
            {{ t('Open approval') }}
          </button><label v-if="['superseded', 'approved', 'unknown'].includes(gate.state)">{{ t('Evidence for {name}', { name: gate.gate }) }}<textarea v-model="evidence[gate.id]" maxlength="4000" /></label><button v-if="['superseded', 'approved', 'unknown'].includes(gate.state)" class="secondary" :disabled="busy || !evidence[gate.id]?.trim()" @click="send({ type: 'gateReview', id: network.id, revision: network.revision, taskId: gate.id, generation: gate.generation, evidence: evidence[gate.id] ?? '' })">
            {{ t('Request fresh approval') }}
          </button><button v-if="gate.state === 'unknown'" class="secondary" :disabled="busy || !evidence[gate.id]?.trim()" @click="send({ type: 'gateDiscard', id: network.id, revision: network.revision, taskId: gate.id, generation: gate.generation, evidence: evidence[gate.id] ?? '' })">
            {{ t('Dispose with evidence') }}
          </button>
        </div>
      </article>
    </section>
    <section v-else-if="tab === 'data' && details">
      <p v-if="recordsError" role="alert" class="error-message">
        {{ diagnostic(recordsError) }}
      </p>
      <p v-if="recordsLoading" role="status">
        {{ t('Loading workspace…') }}
      </p>
      <h2>{{ t('Shared data') }}</h2><p v-if="!details.collections.length || (records && !records.records.length)">
        {{ t('No shared records in this view.') }}
      </p><button v-for="collection in details.collections" :key="collection.id" class="secondary network-collection" :disabled="recordsLoading" :aria-pressed="records?.collectionId === collection.id" @click="dataPage(collection.id)">
        {{ collection.name }} · {{ collection.version }}
      </button><p v-if="details.collectionsMore">
        {{ t('This view shows the first {count} entries.', { count: 64 }) }}
      </p><article v-for="record in records?.records ?? []" :key="record.key">
        <h3>{{ record.key }} · {{ record.revision }}</h3><pre>{{ record.deleted ? t('Deleted record') : record.body }}</pre><p v-if="record.truncated">
          {{ t('Preview shortened. The original receipt is retained.') }}
        </p>
      </article><button v-if="records?.after" class="secondary" :disabled="recordsLoading" @click="dataPage(records.collectionId, records.after)">
        {{ t('Next records') }}
      </button>
    </section>
  </section>
</template>

<style>
.network-collection[aria-pressed=true]{background:var(--tint);border-color:var(--accent);font-weight:700}.network-detail{display:flex;flex-direction:column;gap:16px;min-width:0}.network-detail h1{margin:10px 0}.network-detail p{overflow-wrap:anywhere;margin:4px 0}.network-detail label,.network-detail li{overflow-wrap:anywhere}.network-timers ul{padding-left:20px}.network-process .paused-consent{margin-left:28px;padding:10px;border-left:3px solid var(--border)}.network-detail .text-button{min-height:36px}.network-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font-size:12px}.network-detail article,.network-process{padding:16px;border:1px solid var(--border);border-radius:12px;margin:10px 0}.network-detail textarea{display:block;width:100%;min-height:72px;box-sizing:border-box}.network-detail .graph-modes{flex-wrap:wrap}.network-process label{display:flex;gap:8px;align-items:center;margin:10px 0}.network-process input[type=checkbox]{width:auto}.network-process input[type=number]{max-width:90px}.network-actions>label{flex:1 0 100%}.network-failure-count{align-self:flex-start}.network-actions{display:flex;flex-wrap:wrap;gap:10px}
</style>
