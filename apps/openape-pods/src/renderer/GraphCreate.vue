<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { Organization } from '../contracts/groups'
import type { WorkflowView } from '../contracts/workflows'
import { diagnostic, t } from './i18n'
import { channelNames } from './utils/graph-create'
import type { CreateRequest, GraphSchedule } from './utils/graph-create'

export default defineComponent({
  props: {
    view: { type: Object as PropType<WorkflowView>, required: true },
    pods: { type: Array as PropType<StoredPod[]>, required: true },
    organization: { type: Object as PropType<Organization>, required: true },
    groupId: { type: String as PropType<string | null>, default: null },
    busy: Boolean,
    error: { type: String, default: '' },
  },
  emits: ['create', 'cancel'],
  data() { return { kind: 'pod' as CreateRequest['kind'], name: '', summary: '', group: this.groupId ?? '', graph: '', schedule: 'manual' as GraphSchedule, time: '07:00', members: [] as string[], takes: '', gives: '' } },
  computed: {
    graphs() { return this.view.workflows.filter(item => item.mode === 'channels' && (item.groupId ?? '') === this.group) },
    candidates(): StoredPod[] {
      const members = new Set(this.view.workflows.flatMap(item => item.nodes.map(node => node.podId)))
      const grouped = this.organization.groups.find(group => group.id === this.group)?.podIds
      const others = new Set(this.organization.groups.flatMap(group => group.podIds))
      return this.pods.filter(pod => pod.lifecycle !== 'archived' && !members.has(pod.id) && (grouped ? grouped.includes(pod.id) : !others.has(pod.id)))
    },
    channels(): string[] { return this.view.workflows.find(item => item.id === this.graph)?.channels.map(channel => channel.name) ?? [] },
    problem(): string {
      if (!this.name.trim()) return t('Enter a name.')
      if (this.kind === 'pod' && (!this.summary.trim() || this.summary.length > 40)) return t('Enter a subtitle of at most 40 characters.')
      return ''
    },
  },
  watch: { group() { this.graph = ''; this.members = [] } },
  methods: {
    t, diagnostic,
    submit() {
      if (this.problem || this.busy) return
      const groupId = this.group || null
      const request: CreateRequest = this.kind === 'group'
        ? { kind: 'group', name: this.name.trim() }
        : this.kind === 'graph'
          ? { kind: 'graph', name: this.name.trim(), groupId, schedule: this.schedule, time: this.time, podIds: [...this.members] }
          : { kind: 'pod', name: this.name.trim(), summary: this.summary.trim(), groupId, graphId: this.graph || null, takes: this.takes ? [this.takes] : [], gives: channelNames(this.gives) }
      this.$emit('create', request)
    },
  },
})
</script>

<template>
  <form class="graph-create" @submit.prevent="submit">
    <header>
      <h1>{{ t('Create new') }}</h1>
      <p class="muted">
        {{ t('By hand or in the chat. Both ways create the same and can be mixed later.') }}
      </p>
    </header>
    <div class="graph-modes" role="group" :aria-label="t('What to create')">
      <button type="button" :aria-pressed="kind === 'graph'" @click="kind = 'graph'">
        {{ t('Bounded graph') }}
      </button><button type="button" :aria-pressed="kind === 'pod'" @click="kind = 'pod'">
        {{ t('Pod') }}
      </button><button type="button" :aria-pressed="kind === 'group'" @click="kind = 'group'">
        {{ t('Group') }}
      </button>
    </div>
    <div class="graph-create-fields">
      <fieldset>
        <legend>{{ kind === 'graph' ? t('Bounded graph') : kind === 'pod' ? t('Pod') : t('Group') }}</legend>
        <label>{{ t('Name') }}<input v-model="name" type="text" maxlength="100" required></label>
        <label v-if="kind === 'pod'">{{ t('Subtitle, at most 40 characters') }}<input v-model="summary" type="text" maxlength="40"></label>
        <label v-if="kind !== 'group'">{{ t('Group') }}<select v-model="group">
          <option value="">{{ t('Ungrouped') }}</option>
          <option v-for="item in organization.groups" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select></label>
        <label v-if="kind === 'pod'">{{ t('Bounded graph') }}<select v-model="graph">
          <option value="">{{ t('None, single pod') }}</option>
          <option v-for="item in graphs" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select></label>
        <template v-if="kind === 'graph'">
          <label>{{ t('Schedule') }}<select v-model="schedule">
            <option value="manual">{{ t('Manual only') }}</option>
            <option value="hourly">{{ t('hourly') }}</option>
            <option value="daily">{{ t('daily at …') }}</option>
          </select></label>
          <label v-if="schedule === 'daily'">{{ t('Time') }}<input v-model="time" type="time" required></label>
        </template>
        <p v-if="kind === 'group'" class="muted">
          {{ t('A group separates companies. Shared values apply only inside the group.') }}
        </p>
      </fieldset>
      <fieldset v-if="kind === 'graph'">
        <legend>{{ t('Pods in this network') }}</legend>
        <p v-if="!candidates.length" class="muted">
          {{ t('This group has no free pod. Create pods in this network afterwards.') }}
        </p>
        <label v-for="pod in candidates" :key="pod.id" class="graph-create-check"><input v-model="members" type="checkbox" :value="pod.id"><span>{{ pod.name }}</span></label>
        <p class="muted">
          {{ t('You draw no connections. They appear as soon as one pod gives what another takes.') }}
        </p>
      </fieldset>
      <fieldset v-if="kind === 'pod'">
        <legend>{{ t('Contract') }}</legend>
        <label>{{ t('Receives') }}<select v-model="takes">
          <option value="">{{ t('Nothing, starts with the network') }}</option>
          <option v-for="channel in channels" :key="channel" :value="channel">{{ channel }}</option>
        </select></label>
        <label>{{ t('Produces') }}<input v-model="gives" type="text" :placeholder="t('for example invoice.filed')"></label>
        <p class="muted">
          {{ t('The pod starts with an empty script for this contract. Validate and activate it in its Script tab.') }}
        </p>
      </fieldset>
    </div>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <div class="graph-create-actions">
      <button class="primary" type="submit" :disabled="busy || !!problem" :title="problem">
        {{ t('Create') }}
      </button>
      <button class="text-button" type="button" @click="$emit('cancel')">
        {{ t('Cancel') }}
      </button>
    </div>
  </form>
</template>

<style>
.graph-create{display:flex;flex-direction:column;gap:20px;min-width:0}
.graph-create h1{margin:0;font-size:22px}
.graph-create .graph-modes{align-self:flex-start}
.graph-create-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}
.graph-create fieldset{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;min-width:0;margin:0;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.graph-create legend{padding:0 6px;font-size:12px;font-weight:650;color:var(--muted)}
.graph-create label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600}
.graph-create input[type="text"],.graph-create input[type="time"],.graph-create select{box-sizing:border-box;width:100%;min-height:44px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:inherit;font-weight:400}
.graph-create .graph-create-check{flex-direction:row;align-items:center;gap:12px;min-height:44px;font-weight:400}
.graph-create-check input{width:20px;height:20px;accent-color:var(--accent)}
.graph-create-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
</style>
