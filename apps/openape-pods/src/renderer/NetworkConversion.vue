<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { Organization } from '../contracts/groups'
import type { WorkflowDefinition, WorkflowView, WorkflowSchedule } from '../contracts/workflows'
import type { NetworkDraft, NetworkView } from '../contracts/networks'
import type { ConversionSelection, ConversionPreview } from '../contracts/network-migration'
import NetworkCreate from './NetworkCreate.vue'
import { dateTime, diagnostic, t } from './i18n'

export default defineComponent({
  components: { NetworkCreate },
  props: {
    legacy: { type: Object as PropType<WorkflowDefinition>, required: true },
    pods: { type: Array as PropType<StoredPod[]>, required: true },
    organization: { type: Object as PropType<Organization>, required: true },
    workflows: { type: Object as PropType<WorkflowView>, required: true },
    networks: { type: Object as PropType<NetworkView>, required: true },
  },
  emits: ['cancel', 'created', 'openPod'],
  data() { return { sources: {} as Record<string, { hash: string, code: string }>, inspecting: '', closed: false, request: 0, frozenSelection: '', selection: null as ConversionSelection | null, preview: null as ConversionPreview | null, reviewed: [] as string[], versions: [] as string[], retainPending: false, validated: false, confirmed: false, busy: false, error: '' } },
  computed: {
    authoritySignature(): string { return JSON.stringify(this.pods.filter(pod => this.legacy.nodes.some(node => node.podId === pod.id)).map(pod => [pod.id, pod.activeScript, pod.revision, pod.lifecycle]).sort()) },
    ready(): boolean { return !!this.preview && this.preview.members.every(member => this.reviewed.includes(member.podId) && (!this.isSource(member.podId) || this.versions.includes(member.podId))) },
  },
  watch: {
    'legacy.revision': function () { this.invalidate(); this.reviewed = []; this.versions = []; this.sources = {}; this.preview = null },
    authoritySignature() { this.invalidate(); this.reviewed = []; this.versions = [] },
  },
  beforeUnmount() { this.closed = true; this.request++ },
  methods: {
    t, diagnostic,
    scheduleText(schedule: WorkflowSchedule | null | undefined): string {
      if (!schedule) return t('Manual only')
      if (schedule.kind === 'interval') return t('Every {seconds} seconds', { seconds: schedule.seconds })
      if (schedule.kind === 'daily') return t('Daily at {time} ({timezone})', { time: schedule.time, timezone: schedule.timezone })
      if (schedule.kind === 'once') return dateTime(schedule.at)
      return `${t('Cron')}: ${schedule.expression} (${schedule.timezone})`
    },
    isSource(podId: string): boolean { return !!this.selection?.draft.members.find(member => member.podId === podId)?.source },
    invalidate() { this.request++; this.validated = false; this.confirmed = false; this.frozenSelection = '' },
    async focus(name: 'heading' | 'error') { await this.$nextTick(); if (this.closed) return; (this.$refs[name] as HTMLElement)?.focus() },
    async inspectScript(podId: string) {
      const member = this.preview?.members.find(item => item.podId === podId)
      if (!member || this.busy || this.inspecting) return
      this.inspecting = podId; this.error = ''
      try {
        const view = await window.pods.scripts({ type: 'list', podId, selection: { kind: 'version', id: member.checkpoint.scriptHash } })
        if (this.closed) return
        if (!view.source || view.source.hash !== member.checkpoint.scriptHash || view.pod.activeScript !== member.checkpoint.scriptHash) { this.invalidate(); throw new Error('Checkpoints or scripts changed. Review the current baseline again.') }
        this.sources[podId] = { hash: view.source.hash, code: view.source.code }
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); await this.focus('error') }
      finally { this.inspecting = '' }
    },
    async prepare(draft: NetworkDraft) {
      if (this.busy) return
      this.busy = true; this.error = ''; this.invalidate(); this.reviewed = []; this.versions = []; this.retainPending = false
      const request = ++this.request
      this.selection = { workflowId: this.legacy.id, revision: this.legacy.revision, draft, checkpoints: [], pending: 'block' }
      try {
        const view = await window.pods.networks({ type: 'conversionPreview', selection: JSON.parse(JSON.stringify(this.selection)) })
        if (this.closed || request !== this.request) return
        this.preview = view.conversion!; await this.focus('heading')
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); await this.focus('error') }
      finally { this.busy = false }
    },
    async validate() {
      if (!this.ready || !this.preview || !this.selection || this.busy) return
      this.busy = true; this.error = ''; this.invalidate()
      const request = ++this.request
      try {
        const selection: ConversionSelection = { ...this.selection, pending: this.retainPending ? 'retainLegacy' : 'block', checkpoints: this.preview.members.map(member => ({ podId: member.podId, revision: member.checkpoint.revision, hash: member.checkpoint.hash, scriptHash: member.checkpoint.scriptHash, explicitSourceVersions: this.isSource(member.podId) })) }
        const previous = this.preview
        const next = (await window.pods.networks({ type: 'conversionPreview', selection: JSON.parse(JSON.stringify(selection)) })).conversion!
        if (this.closed || request !== this.request) return
        const checkpointsChanged = previous.members.some((member) => { const current = next.members.find(item => item.podId === member.podId); return !current || JSON.stringify(current) !== JSON.stringify(member) })
        this.selection = selection; this.preview = next
        if (checkpointsChanged) { this.reviewed = []; this.versions = []; this.sources = {}; this.error = t('Checkpoints or scripts changed. Review the current baseline again.') }
        this.validated = !checkpointsChanged && !next.issues.length
        if (this.validated) this.frozenSelection = JSON.stringify(selection)
        await this.focus('heading')
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); await this.focus('error') }
      finally { this.busy = false }
    },
    async convert() {
      if (!this.validated || !this.confirmed || !this.preview || !this.selection || this.busy) return
      this.busy = true; this.error = ''
      try { this.$emit('created', await window.pods.networks({ type: 'convert', selection: JSON.parse(this.frozenSelection), expectedFingerprint: this.preview.fingerprint })) }
      catch (error) {
        this.error = error instanceof Error ? error.message : String(error); this.confirmed = false
        if (this.error.includes('review changed') || this.error.includes('different reviewed conversion')) this.invalidate()
        await this.focus('error')
      }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <section class="network-conversion">
    <p v-if="error" ref="error" tabindex="-1" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <NetworkCreate v-show="!preview" :pods="pods" :organization="organization" :workflows="workflows" :networks="networks" :conversion="legacy" @conversion-draft="prepare" @cancel="$emit('cancel')" @open-pod="$emit('openPod', $event)" />
    <template v-if="preview">
      <header>
        <button class="text-button" :disabled="busy" @click="$emit('cancel')">
          {{ t('Cancel conversion') }}
        </button><h1 ref="heading" tabindex="-1">
          {{ t('Review graph conversion') }}
        </h1><p>{{ legacy.name }} · {{ t('Revision {revision}', { revision: legacy.revision }) }}</p>
      </header>
      <p>{{ t('This preview changes no state. Converting disables the old graph and its schedules; the new network remains paused.') }}</p>
      <p>{{ t('Pause old schedules before reviewing. New runs or changed checkpoints invalidate this review.') }}</p>
      <ul>
        <li v-for="difference in preview.differences" :key="difference">
          {{ diagnostic(difference) }}
        </li>
      </ul>
      <p>{{ t('Reviewed shared values') }}: {{ Object.entries(selection!.draft.sharedValues ?? {}).map(([name, value]) => `${name}: ${value}`).join(' · ') || t('None') }}</p>
      <p>{{ t('Legacy graph schedule') }}: {{ scheduleText(preview.legacy.schedule) }} · {{ preview.legacy.enabled ? t('Enabled') : t('Disabled') }}</p>
      <fieldset v-for="member in preview.members" :key="member.podId" class="conversion-member" :disabled="busy">
        <legend>{{ member.name }} · {{ t(isSource(member.podId) ? 'Source' : 'Consumer') }}</legend>
        <p>{{ t('Requested rights') }}: {{ member.capabilities.join(', ') || t('None') }}</p>
        <p v-for="resource in member.resources" :key="resource.name">
          {{ resource.name }} · {{ resource.state }}
        </p>
        <p v-if="member.resourcesMore">
          {{ t('This view shows the first {count} entries.', { count: 256 }) }}
        </p>
        <p v-for="field in member.values" :key="field.name">
          {{ field.name }}: {{ field.kind === 'secret-reference' ? t('Protected reference') : String(field.value) }}
        </p>
        <p>{{ t('Old individual schedule') }}: {{ scheduleText(member.schedule?.spec) }} · {{ member.schedule?.enabled ? t('Enabled') : t('Disabled') }}</p>
        <p>{{ t('New source schedule') }}: {{ isSource(member.podId) ? scheduleText(selection!.draft.members.find(item => item.podId === member.podId)?.source?.schedule) : t('Incoming items only') }}</p>
        <p>{{ t('Checkpoint revision {revision}', { revision: member.checkpoint.revision }) }} · <code>{{ member.checkpoint.hash }}</code></p>
        <details><summary>{{ t('Inspect retained checkpoint') }}</summary><pre>{{ member.checkpoint.body }}</pre></details>
        <p v-if="member.checkpoint.truncated" role="status">
          {{ t('The checkpoint preview is truncated. Reconcile its size before conversion.') }}
        </p>
        <button type="button" class="text-button" :disabled="!!inspecting" @click="inspectScript(member.podId)">
          {{ t('Inspect active script') }}
        </button>
        <details v-if="sources[member.podId]?.hash === member.checkpoint.scriptHash" open>
          <summary>{{ t('Pinned active script') }}</summary><pre>{{ sources[member.podId]!.code }}</pre>
        </details>
        <label><input v-model="reviewed" type="checkbox" :value="member.podId" @change="invalidate">{{ t('I reviewed the exact checkpoint, script and local rights of {name}.', { name: member.name }) }}</label>
        <label v-if="isSource(member.podId)"><input v-model="versions" type="checkbox" :value="member.podId" @change="invalidate">{{ t('{name} already emits explicit item IDs and versions with network.emit. Its reviewed baseline excludes historical work.', { name: member.name }) }}</label>
      </fieldset>
      <p>{{ t('Pending legacy deliveries: {count}', { count: preview.pending }) }}</p>
      <label v-if="preview.pending"><input v-model="retainPending" type="checkbox" :disabled="busy" @change="invalidate">{{ t('Keep pending items in the disabled legacy graph without importing or replaying them.') }}</label>
      <ul v-if="preview.issues.length" role="status">
        <li v-for="issue in preview.issues" :key="issue">
          {{ diagnostic(issue) }}
        </li>
      </ul>
      <div class="network-actions">
        <button class="secondary" :disabled="busy" @click="preview = null; invalidate()">
          {{ t('Edit schemas and values') }}
        </button><button class="secondary" :disabled="busy || !ready" @click="validate">
          {{ t('Validate reviewed conversion') }}
        </button>
      </div>
      <template v-if="validated">
        <p role="status">
          {{ t('Review is current. No execution or external action will start.') }}
        </p>
        <label><input v-model="confirmed" type="checkbox" :disabled="busy">{{ t('Disable the old graph and schedules and create this paused network.') }}</label>
        <button class="primary" :disabled="busy || !confirmed" @click="convert">
          {{ t('Convert to paused network') }}
        </button>
      </template>
    </template>
  </section>
</template>

<style>
.network-conversion{display:flex;flex-direction:column;gap:16px;max-width:960px;min-width:0}.network-conversion fieldset{display:flex;flex-direction:column;gap:12px;min-width:0;padding:18px;border:1px solid var(--border);border-radius:12px}.network-conversion label{display:flex;gap:8px;align-items:start}.network-conversion input[type=checkbox]{width:auto;flex-shrink:0}.network-conversion pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}.network-conversion p{margin:0;line-height:1.5}.network-conversion p,.network-conversion code{overflow-wrap:anywhere}
</style>
