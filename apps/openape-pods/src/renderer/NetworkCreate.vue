<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { DefinitionsView } from '../contracts/definitions'
import type { Organization } from '../contracts/groups'
import type { NetworkSetup } from '../contracts/network-operations'
import { diagnoseNetwork } from '../contracts/networks'
import { graphDiagnosticMessages } from '../contracts/graphs'
import type { NetworkDraft, NetworkView } from '../contracts/networks'
import type { ScalarSchema } from '../contracts/network-payload'
import type { WorkflowView } from '../contracts/workflows'
import { diagnostic, t } from './i18n'

interface ChannelField { name: string, type: ScalarSchema['type'], required: boolean }
export default defineComponent({
  props: {
    pods: { type: Array as PropType<StoredPod[]>, required: true },
    organization: { type: Object as PropType<Organization>, required: true },
    workflows: { type: Object as PropType<WorkflowView>, required: true },
    networks: { type: Object as PropType<NetworkView>, required: true },
    groupId: { type: String as PropType<string | null>, default: null },
  },
  emits: ['cancel', 'workflow', 'created', 'openPod', 'other'],
  data() { return { step: 0, group: this.groupId ?? '', name: '', selected: [] as string[], definitions: null as DefinitionsView | null, setup: null as NetworkSetup | null, values: {} as Record<string, string>, sharedEnabled: {} as Record<string, boolean>, schedules: {} as Record<string, number>, fields: {} as Record<string, ChannelField[]>, gatedInputs: [] as string[], joinedPods: [] as string[], joinDeadline: 300000, busy: false, error: '', reviewNotice: '' } },
  computed: {
    unavailable(): string { if (this.definitions?.instances.some(instance => !this.definitions!.definitions.some(definition => definition.id === instance.definitionId && definition.versions.some(version => version.version === instance.version)))) return t('Prepared definition list is incomplete. Refresh before creating a network.'); return this.networks.unavailableReason ?? this.definitions?.unavailableReason ?? '' },
    candidates() {
      const reserved = new Set([...this.workflows.workflows.flatMap(item => item.nodes.map(node => node.podId)), ...this.networks.networks.flatMap(item => item.podIds ?? [])])
      return (this.definitions?.instances ?? []).filter(item => item.groupId === this.group && !item.diverged && !reserved.has(item.podId) && this.pods.some(pod => pod.id === item.podId && pod.lifecycle !== 'archived')).flatMap((instance) => { const pod = this.pods.find(pod => pod.id === instance.podId)!; const version = this.definitions!.definitions.find(item => item.id === instance.definitionId)?.versions.find(item => item.version === instance.version); return version?.contract && pod.activeScript ? [{ instance, pod, version }] : [] })
    },
    selectedMembers() { return this.candidates.filter(item => this.selected.includes(item.pod.id)) },
    channels(): string[] { return [...new Set(this.selectedMembers.flatMap(item => [...item.version.contract?.takes ?? [], ...item.version.contract?.gives ?? []]))].sort() },
    shared(): { name: string, value: unknown, conflict: boolean, consumers: string[], overrides: string[] }[] {
      const names = [...new Set(this.selectedMembers.flatMap(item => Object.keys(item.version.defaults)))].sort()
      return names.map((name) => {
        const declaring = this.selectedMembers.filter(item => Object.hasOwn(item.version.defaults, name))
        const values = declaring.map(item => item.version.defaults[name])
        return { name, value: values[0], conflict: values.some(value => JSON.stringify(value) !== JSON.stringify(values[0])), consumers: declaring.map(item => item.pod.name), overrides: (this.setup?.members ?? []).filter(member => member.values.some(field => field.name === name && field.origin === 'pod')).map(member => member.name) }
      })
    },
    problem(): string {
      if (!this.name.trim()) return t('Enter a name.')
      if (!this.group) return t('Choose a company.')
      if (this.networks.networks.some(item => item.groupId === this.group && item.state !== 'archived')) return t('This company already has a persistent network.')
      if (this.selectedMembers.length !== this.selected.length) return t('Prepared selection changed. Review the instances again.')
      if (!this.selected.length) return t('Select at least one prepared Pod instance.')
      const unsupported = this.selectedMembers.find(item => item.version.capabilities.some(right => right !== 'mail.read'))
      if (unsupported) return t('Pod {name} requests unsupported network rights: {rights}', { name: unsupported.pod.name, rights: unsupported.version.capabilities.filter(right => right !== 'mail.read').join(', ') })
      if (this.selectedMembers.some(item => item.version.capabilities.includes('mail.read') && item.version.contract!.takes.length)) return t('Network mail reads require a declared source')
      const diagnostics = diagnoseNetwork({ formatVersion: 1, kind: 'network', semantics: 'persistent-network-v1', id: this.group, revision: 1, groupId: this.group, name: this.name, channels: this.channels.map(name => ({ name, title: name, schemaVersion: 1, schema: { type: 'object', properties: {}, required: [], additionalProperties: false } })), members: this.selectedMembers.map(item => ({ podId: item.pod.id, definitionId: item.instance.definitionId, definitionVersion: item.instance.version, bindingRevision: item.instance.bindingRevision, contract: item.version.contract!, source: item.version.contract!.takes.length ? null : { bindingId: item.pod.id, schedule: null }, serialCase: false })) })
      if (diagnostics[0]) return `${diagnostic(graphDiagnosticMessages[diagnostics[0].code])}: ${diagnostics[0].channel ?? this.pods.find(pod => pod.id === diagnostics[0]!.podId)?.name ?? ''}`
      return ''
    },
  },
  watch: { group() { this.selected = []; this.setup = null } },
  async mounted() {
    try { this.definitions = await window.pods.definitions({ type: 'list' }) }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); await this.$nextTick(); (this.$refs.error as HTMLElement)?.focus() }
  },
  methods: {
    t, diagnostic,
    async review() {
      if (this.problem) return
      this.busy = true; this.error = ''
      try {
        const next = (await window.pods.networks({ type: 'setup', groupId: this.group, podIds: [...this.selected] })).setup!
        this.reviewNotice = ''
        if (this.setup?.fingerprint !== next.fingerprint) {
          if (this.setup) this.reviewNotice = t('Selection or rights changed. Review shared values and channels again.')
          this.values = {}; this.sharedEnabled = {}; this.fields = {}; this.gatedInputs = []; this.joinedPods = []
        }
        this.setup = next
        for (const field of this.shared) this.values[field.name] ??= field.conflict ? '' : typeof field.value === 'string' ? field.value : JSON.stringify(field.value)
        for (const channel of this.channels) this.fields[channel] ??= []
        this.step = 2
        await this.$nextTick(); (this.$refs.heading as HTMLElement).focus()
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); await this.$nextTick(); (this.$refs.error as HTMLElement)?.focus() }
      finally { this.busy = false }
    },
    async focusStep(step: number) { this.step = step; await this.$nextTick(); (this.$refs.heading as HTMLElement).focus() },
    async create() {
      if (!this.setup || this.problem || this.unavailable || this.busy) return
      this.busy = true; this.error = ''
      try {
        const sharedValues = Object.fromEntries(this.shared.filter(field => this.sharedEnabled[field.name]).map((field) => {
          const text = this.values[field.name] ?? ''
          if (field.conflict && !text.trim()) throw new Error('Enter an explicit shared value when defaults differ')
          const value = typeof field.value === 'string' ? text : typeof field.value === 'number' ? Number(text) : typeof field.value === 'boolean' ? text === 'true' : null
          if (typeof field.value === 'number' && (!text.trim() || !Number.isFinite(value))) throw new Error('Enter a finite numeric shared value')
          return [field.name, value]
        }))
        for (const channel of this.channels) {
          const names = this.fields[channel]!.map(field => field.name)
          if (names.some(name => !name.trim()) || new Set(names).size !== names.length) throw new Error('Channel fields must have unique nonempty names')
        }
        const draft: NetworkDraft = {
          gates: this.selectedMembers.flatMap((item, index) => item.version.contract!.takes.filter(channel => this.gatedInputs.includes(`${item.pod.id}:${channel}`)).map((channel, channelIndex) => ({ key: `review-${index}-${channelIndex}`, title: item.pod.name.slice(0, 60), kind: 'approve' as const, podId: item.pod.id, channel }))),
          joins: this.selectedMembers.filter(item => this.joinedPods.includes(item.pod.id) && item.version.contract!.takes.length > 1).map((item, index) => ({ id: `join-${index}`, podId: item.pod.id, channels: [...item.version.contract!.takes], deadlineMs: this.joinDeadline, reviewDestination: 'owner' as const })),
          name: this.name.trim(), groupId: this.group, expectedSetup: this.setup.fingerprint, sharedValues,
          members: this.selectedMembers.map(item => ({ podId: item.pod.id, serialCase: false, source: item.version.contract!.takes.length ? null : { schedule: this.schedules[item.pod.id] ? { kind: 'interval', seconds: this.schedules[item.pod.id]! } : null } })),
          channels: this.channels.map(name => ({ name, title: name, schemaVersion: 1, schema: { type: 'object', properties: Object.fromEntries(this.fields[name]!.map(field => [field.name, { type: field.type }])), required: this.fields[name]!.filter(field => field.required).map(field => field.name), additionalProperties: false } })),
        }
        this.$emit('created', await window.pods.networks({ type: 'create', draft }))
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); await this.$nextTick(); (this.$refs.error as HTMLElement)?.focus() }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <section class="network-create">
    <header>
      <button class="text-button" @click="$emit('cancel')">
        {{ t('Back') }}
      </button><h1 ref="heading" tabindex="-1">
        {{ t('Create a composition') }}
      </h1>
    </header>
    <p v-if="error" ref="error" tabindex="-1" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <template v-if="step === 0">
      <div class="network-choice">
        <button class="graph-card" @click="$emit('workflow')">
          <strong>{{ t('Finite workflow') }}</strong><span>{{ t('One request, ordered work and one result.') }}</span>
        </button>
        <button class="graph-card" :disabled="!!unavailable" @click="focusStep(1)">
          <strong>{{ t('Persistent network') }}</strong><span>{{ t('Independent timers and incoming items, until you pause it.') }}</span>
        </button>
      </div>
      <p v-if="unavailable" role="status">
        {{ diagnostic(unavailable) }}
      </p>
      <button class="text-button" @click="$emit('other')">
        {{ t('Create a Pod or company') }}
      </button>
    </template>
    <form v-else-if="step === 1" @submit.prevent="review">
      <label>{{ t('Name') }}<input v-model="name" required maxlength="120"></label>
      <label>{{ t('Company') }}<select v-model="group" :aria-label="t('Company')" required><option value="">{{ t('Choose a company.') }}</option><option v-for="company in organization.groups" :key="company.id" :value="company.id">{{ company.name }}</option></select></label>
      <fieldset>
        <legend>{{ t('Prepared Pod instances') }}</legend>
        <p>{{ t('Each instance keeps its own identity and rights. Existing workflows stay unchanged.') }}</p>
        <label v-for="item in candidates" :key="item.pod.id" class="network-check"><input v-model="selected" type="checkbox" :value="item.pod.id">{{ item.pod.name }}</label>
        <p v-if="!candidates.length">
          {{ t('Publish a definition and prepare a separate instance in this company first.') }}
        </p>
      </fieldset>
      <p id="network-setup-problem" role="status">
        {{ problem }}
      </p>
      <button class="primary" :disabled="busy || !!problem || !!unavailable" aria-describedby="network-setup-problem">
        {{ t('Review values and rights') }}
      </button>
    </form>
    <form v-else @submit.prevent="create">
      <p v-if="reviewNotice" role="status">
        {{ reviewNotice }}
      </p><p>{{ t('Created paused. Activation is a separate action.') }}</p><p>{{ t('Each source runs independently. Use zero for manual only, or at least 60 seconds.') }}</p>
      <fieldset v-if="shared.length">
        <legend>{{ t('Shared values') }}</legend>
        <p>{{ t('Enter each value once. Pod overrides remain in effect.') }}</p>
        <div v-for="field in shared" :key="field.name">
          <label class="network-check"><input v-model="sharedEnabled[field.name]" type="checkbox">{{ t('Set shared value for {name}', { name: field.name }) }}</label>
          <label v-if="sharedEnabled[field.name]">{{ field.name }}<select v-if="typeof field.value === 'boolean'" v-model="values[field.name]"><option disabled value="">{{ t('Choose a value') }}</option><option value="true">{{ t('Yes') }}</option><option value="false">{{ t('No') }}</option></select><input v-else-if="field.value !== null" v-model="values[field.name]" :type="typeof field.value === 'number' ? 'number' : 'text'" step="any" maxlength="1024"><span v-else>{{ t('Empty value') }}</span></label>
          <p>{{ t('Used by: {names}', { names: field.consumers.join(', ') }) }}</p><p v-if="field.overrides.length">
            {{ t('Pod overrides retained: {names}', { names: field.overrides.join(', ') }) }}
          </p><p v-if="field.conflict">
            {{ t('Definitions have different defaults. Leave sharing off to retain them.') }}
          </p>
        </div>
      </fieldset>
      <fieldset v-for="member in setup!.members" :key="member.podId">
        <legend>{{ member.name }}</legend>
        <label v-for="channel in selectedMembers.find(item => item.pod.id === member.podId)?.version.contract?.takes ?? []" :key="channel" class="network-check"><input v-model="gatedInputs" type="checkbox" :value="`${member.podId}:${channel}`">{{ t('Require approval before {name} receives {channel}', { name: member.name, channel }) }}</label><label v-if="(selectedMembers.find(item => item.pod.id === member.podId)?.version.contract?.takes.length ?? 0) > 1" class="network-check"><input v-model="joinedPods" type="checkbox" :value="member.podId">{{ t('Wait for all declared inputs of the same case') }}</label>
        <p>{{ t('Requested rights') }}: {{ member.capabilities.join(', ') || t('None') }}</p>
        <p v-if="member.resourcesMore">
          {{ t('This view shows the first {count} entries.', { count: 256 }) }}
        </p>
        <p v-for="resource in member.resources" :key="resource.name">
          {{ resource.name }} · {{ resource.state }}
        </p>
        <p v-for="field in member.values" :key="field.name">
          {{ field.name }} · {{ t(field.origin === 'pod' ? 'Pod override' : sharedEnabled[field.name] ? 'Shared value' : 'Definition default') }}: {{ field.kind === 'secret-reference' ? t('Protected reference') : String(field.origin !== 'pod' && sharedEnabled[field.name] ? values[field.name] : field.value) }}
        </p>
        <template v-if="!selectedMembers.find(item => item.pod.id === member.podId)?.version.contract?.takes.length">
          <label>{{ t('Timer interval in seconds; zero means manual only') }}<input v-model.number="schedules[member.podId]" type="number" min="0" max="2592000" step="1" :placeholder="t('Manual only')"></label>
        </template>
      </fieldset>
      <fieldset v-for="channel in channels" :key="channel">
        <legend>{{ t('Fields for {channel}', { channel }) }}</legend><p v-if="!fields[channel]?.length">
          {{ t('No fields: only an empty payload is accepted. Add the fields emitted by the scripts.') }}
        </p>
        <p>{{ t('Only declared fields can pass between Pods.') }}</p>
        <div v-for="(field, index) in fields[channel]" :key="index" class="network-field">
          <label>{{ t('Field name') }}<input v-model="field.name" required maxlength="64" pattern="[a-zA-Z][a-zA-Z0-9_]*"></label>
          <label>{{ t('Type') }}<select v-model="field.type"><option v-for="type in (['string', 'number', 'integer', 'boolean', 'null'] as const)" :key="type" :value="type">{{ type }}</option></select></label>
          <label class="network-check"><input v-model="field.required" type="checkbox">{{ t('Required') }}</label>
          <button type="button" class="text-button" @click="fields[channel]!.splice(index, 1)">
            {{ t('Remove') }}
          </button>
        </div>
        <button type="button" class="secondary" :disabled="fields[channel]!.length >= 32" @click="fields[channel]!.push({ name: '', type: 'string', required: true })">
          {{ t('Add field') }}
        </button>
      </fieldset>
      <label v-if="joinedPods.length">{{ t('Join deadline in milliseconds') }}<input v-model.number="joinDeadline" type="number" min="1000" max="86400000"></label>
      <div class="network-actions">
        <button type="button" class="secondary" :disabled="busy" @click="focusStep(1)">
          {{ t('Edit selection') }}
        </button><button class="primary" :disabled="busy || !!unavailable">
          {{ t('Create paused network') }}
        </button>
      </div>
    </form>
  </section>
</template>

<style>
.network-create{display:flex;flex-direction:column;gap:16px;max-width:960px;min-width:0}.network-create form,.network-create fieldset{display:flex;flex-direction:column;gap:14px;min-width:0}.network-create fieldset{padding:18px;border:1px solid var(--border);border-radius:12px}.network-create label{display:flex;flex-direction:column;gap:6px}.network-create .network-check{flex-direction:row;align-items:center}.network-check input{width:auto}.network-choice{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.network-field,.network-actions{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.network-create p{overflow-wrap:anywhere}.network-field>label:first-child{flex:1;min-width:140px}@media(max-width:700px){.network-choice{grid-template-columns:1fr}.network-create fieldset{padding:12px}.network-field{align-items:stretch}}
</style>
