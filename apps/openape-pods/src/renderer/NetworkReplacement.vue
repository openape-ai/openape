<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { Organization } from '../contracts/groups'
import type { WorkflowView } from '../contracts/workflows'
import type { NetworkDraft, NetworkSummary, NetworkView } from '../contracts/networks'
import type { ReplacementPreview } from '../contracts/network-replacement'
import { compositionDiff } from './utils/network-replacement'
import NetworkCreate from './NetworkCreate.vue'
import { diagnostic, t } from './i18n'

export default defineComponent({
  components: { NetworkCreate },
  props: {
    network: { type: Object as PropType<NetworkSummary>, required: true },
    pods: { type: Array as PropType<StoredPod[]>, required: true },
    organization: { type: Object as PropType<Organization>, required: true },
    workflows: { type: Object as PropType<WorkflowView>, required: true },
    networks: { type: Object as PropType<NetworkView>, required: true },
  },
  emits: ['cancel', 'changed', 'openPod'],
  data() { return { setup: null as ReplacementPreview | null, preview: null as ReplacementPreview | null, frozenDraft: '', confirmed: false, sourcesReviewed: false, busy: false, closed: false, request: 0, error: '', stale: false } },
  computed: {
    freshSources(): string[] { return this.preview?.candidate?.members.filter(member => member.source && this.preview!.added.includes(member.podId)).map(member => member.podId) ?? [] },
    authoritySignature(): string { return JSON.stringify(this.pods.filter(pod => this.organization.groups.find(group => group.id === this.network.groupId)?.podIds.includes(pod.id)).map(pod => [pod.id, pod.activeScript, pod.revision, pod.lifecycle]).sort()) },
    changes(): { label: string, before: string, after: string }[] {
      if (!this.setup || !this.preview) return []
      const before = this.setup.draft; const after = this.preview.draft
      const { changes, add } = compositionDiff(t('None'))
      add(t('Name'), before.name, after.name, value => value)
      for (const id of new Set([...before.members, ...after.members].map(member => member.podId))) add(this.name(id), before.members.find(member => member.podId === id), after.members.find(member => member.podId === id), this.memberText)
      for (const name of new Set([...before.channels, ...after.channels].map(channel => channel.name))) add(`${t('Channel schemas')}: ${name}`, before.channels.find(channel => channel.name === name), after.channels.find(channel => channel.name === name))
      for (const key of new Set([...(before.gates ?? []), ...(after.gates ?? [])].map(gate => gate.key))) add(t('Approvals'), before.gates?.find(gate => gate.key === key), after.gates?.find(gate => gate.key === key), gate => `${gate.title} · ${this.name(gate.podId)} · ${gate.channel}`)
      for (const id of new Set([...(before.joins ?? []), ...(after.joins ?? [])].map(join => join.id))) add(t('Joins'), before.joins?.find(join => join.id === id), after.joins?.find(join => join.id === id), join => `${this.name(join.podId)} · ${join.channels.join(', ')} · ${join.deadlineMs} ms`)
      for (const name of new Set([...Object.keys(before.sharedValues ?? {}), ...Object.keys(after.sharedValues ?? {})])) add(`${t('Shared values')}: ${name}`, before.sharedValues?.[name], after.sharedValues?.[name])
      return changes
    },
  },
  watch: {
    'network.revision': function () { this.invalidate() },
    'network.state': function () { this.invalidate() },
    authoritySignature() { this.invalidate() },
    'networks.unavailableReason': function () { this.invalidate() },
  },
  async mounted() { await this.load() },
  beforeUnmount() { this.closed = true; this.request++ },
  methods: {
    t, diagnostic,
    memberText(member: NetworkDraft['members'][number]): string {
      if (!member.source) return `${t('Consumer')} · ${t(member.serialCase ? 'Serial case processing' : 'Parallel case processing')}`
      const schedule = member.source.schedule
      return `${t('Source')} · ${!schedule ? t('Manual only') : schedule.kind === 'interval' ? t('Every {seconds} seconds', { seconds: schedule.seconds }) : t('Daily at {time} ({timezone})', { time: schedule.time, timezone: schedule.timezone })}`
    },
    name(id: string): string { return this.pods.find(pod => pod.id === id)?.name ?? id },
    invalidate() { this.request++; this.stale = true; this.confirmed = false; this.sourcesReviewed = false; this.frozenDraft = '' },
    async focus(name: 'heading' | 'error') { await this.$nextTick(); if (!this.closed) (this.$refs[name] as HTMLElement)?.focus() },
    async load() {
      this.busy = true; this.error = ''; const request = ++this.request
      try {
        const view = await window.pods.networks({ type: 'replacementSetup', id: this.network.id, revision: this.network.revision })
        if (this.closed || request !== this.request) return
        this.setup = view.replacement!; this.preview = null; this.stale = false; this.confirmed = false; this.sourcesReviewed = false; this.frozenDraft = ''
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); await this.focus('error') }
      finally { this.busy = false }
    },
    async prepare(draft: NetworkDraft) {
      if (this.busy || !this.setup || this.stale) return
      this.busy = true; this.error = ''; this.confirmed = false; this.sourcesReviewed = false; this.frozenDraft = ''; const request = ++this.request
      try {
        const frozen = JSON.stringify(draft)
        const view = await window.pods.networks({ type: 'replacementPreview', id: this.network.id, revision: this.setup.current.revision, draft: JSON.parse(frozen) })
        if (this.closed || request !== this.request) return
        this.preview = view.replacement!; this.frozenDraft = frozen; await this.focus('heading')
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); await this.focus('error') }
      finally { this.busy = false }
    },
    async replace() {
      if (this.busy || this.stale || !this.confirmed || (this.freshSources.length > 0 && !this.sourcesReviewed) || !this.preview || !this.frozenDraft || this.preview.issues.length || this.networks.unavailableReason) return
      this.busy = true; this.error = ''
      try { this.$emit('changed', await window.pods.networks({ type: 'replaceComposition', id: this.network.id, revision: this.preview.current.revision, draft: JSON.parse(this.frozenDraft), expectedFingerprint: this.preview.fingerprint })) }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); this.invalidate(); await this.focus('error') }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <section class="network-replacement">
    <p v-if="error" ref="error" tabindex="-1" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <template v-if="stale || (error && !setup)">
      <p role="status">
        {{ t('Composition or authority changed. Reload before reviewing again.') }}
      </p>
      <button class="secondary" :disabled="busy" @click="load">
        {{ t('Reload composition') }}
      </button>
    </template>
    <ul v-if="setup?.issues.length && !preview" role="status">
      <li v-for="issue in setup.issues" :key="issue">
        {{ diagnostic(issue) }}
      </li>
    </ul>
    <NetworkCreate v-if="setup" v-show="!preview && !stale" :key="setup.fingerprint" :replacement="setup" :pods="pods" :organization="organization" :workflows="workflows" :networks="networks" @replacement-draft="prepare" @cancel="$emit('cancel')" @open-pod="$emit('openPod', $event)" />
    <template v-if="preview">
      <h1 ref="heading" tabindex="-1">
        {{ t('Review composition changes') }}
      </h1>
      <p>{{ network.name }} · {{ t('Revision {revision}', { revision: preview.current.revision }) }}</p>
      <p>{{ t('The network stays paused. Activation is a separate action.') }}</p>
      <p>{{ t('Existing identities, homes, rights, checkpoints and receipts are preserved. Retired instances cannot process this network. Stored items are not replayed by this change.') }}</p>
      <p>{{ t('Added instances') }}: {{ preview.added.map(name).join(', ') || t('None') }}</p>
      <p>{{ t('Retired instances') }}: {{ preview.retired.map(name).join(', ') || t('None') }}</p>
      <p>{{ t('Retired instances remain reserved and cannot be added again.') }}</p>
      <template v-if="freshSources.length">
        <p role="status">
          {{ t('New sources start with empty checkpoints and independent item identities. After activation, they may read historical inputs. Review their cursor behavior first.') }}
        </p>
        <p>{{ freshSources.map(name).join(', ') }}</p>
        <label><input v-model="sourcesReviewed" type="checkbox" :disabled="busy || stale">{{ t('I reviewed the initial cursor behavior of every new source.') }}</label>
      </template>
      <ul v-if="preview.issues.length" role="status">
        <li v-for="issue in preview.issues" :key="issue">
          {{ diagnostic(issue) }}
        </li>
      </ul>
      <article v-for="(change, index) in changes" :key="index">
        <h2>{{ change.label }}</h2>
        <h3>{{ t('Before') }}</h3><pre>{{ change.before }}</pre>
        <h3>{{ t('After') }}</h3><pre>{{ change.after }}</pre>
      </article>
      <button class="secondary" :disabled="busy || stale" @click="preview = null; confirmed = false; frozenDraft = ''">
        {{ t('Edit composition') }}
      </button>
      <label v-if="!preview.issues.length && !stale"><input v-model="confirmed" type="checkbox" :disabled="busy">{{ t('Save these reviewed changes and keep the network paused.') }}</label>
      <button class="primary" :disabled="busy || stale || !confirmed || (freshSources.length > 0 && !sourcesReviewed) || !!preview.issues.length || !!networks.unavailableReason" @click="replace">
        {{ t('Save paused composition') }}
      </button>
    </template>
    <button v-if="!setup || stale || preview" class="text-button" :disabled="busy" @click="$emit('cancel')">
      {{ t('Cancel') }}
    </button>
  </section>
</template>

<style>
.network-replacement{display:flex;flex-direction:column;gap:16px;max-width:960px;min-width:0}.network-replacement p{margin:0;line-height:1.5;overflow-wrap:anywhere}.network-replacement article{border:1px solid var(--border);border-radius:12px;padding:16px;min-width:0}.network-replacement pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto}.network-replacement label{display:flex;gap:8px;align-items:start}.network-replacement input[type=checkbox]{width:auto;flex-shrink:0}
</style>
