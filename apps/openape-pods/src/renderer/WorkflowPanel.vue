<script lang="ts">
import MailWorkflowSettings from './MailWorkflowSettings.vue'
import MailWorkflowReview from './MailWorkflowReview.vue'
import type { MailWorkflowConfiguration } from '../contracts/mail-workflow'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { t, diagnostic, label, dateTime } from './i18n'
import type { StoredPod } from '../contracts/control'
import { parseWorkflowNodes, parseWorkflowSchedule } from '../contracts/workflows'
import type { WorkflowCommand, WorkflowNode, WorkflowSchedule, WorkflowView, WorkflowDefinition } from '../contracts/workflows'
import { nextWorkflowDue } from '../contracts/workflow-clock'

export default defineComponent({
  components: { MailWorkflowSettings, MailWorkflowReview },
  props: { view: { type: Object as PropType<WorkflowView>, required: true }, pods: { type: Array as PropType<StoredPod[]>, required: true }, selectedId: { type: String, default: '' } },
  emits: ['changed', 'select'],
  data() { return { mail: null as MailWorkflowConfiguration | null, editing: false, id: '', revision: 0, name: '', nodes: [] as WorkflowNode[], kind: 'none', seconds: 900, time: '09:00', timezone: 'Europe/Vienna', at: '', expression: '0 9 * * 1-5', enabled: false, busy: false, error: '' } },
  computed: {
    definition(): WorkflowDefinition | undefined { return this.view.workflows.find(item => item.id === this.selectedId) },
    history() { return this.view.runs.filter(run => run.workflowId === this.selectedId) },
    active() { return this.history.find(run => run.finishedAt === null) },
    availablePods() { return this.pods.filter(pod => pod.lifecycle !== 'archived') },
    graphError(): string {
      try { parseWorkflowNodes(this.nodes); return '' }
      catch (error) { return error instanceof Error ? error.message : String(error) }
    },
    layers(): WorkflowNode[][] {
      const nodes = this.editing ? this.nodes : this.definition?.nodes ?? []
      const levels: WorkflowNode[][] = []; const seen = new Set<string>()
      while (seen.size < nodes.length) {
        const ready = nodes.filter(node => !seen.has(node.podId) && node.after.every(id => seen.has(id)))
        if (!ready.length) return [nodes]
        levels.push(ready); for (const node of ready) seen.add(node.podId)
      }
      return levels
    },
    preview(): { dates: number[], error: string } {
      try {
        const schedule = this.schedule(); if (!schedule) return { dates: [], error: '' }
        const dates: number[] = []; let after = Date.now(); let previous: number | null = null
        for (let count = 0; count < 3; count++) { const next = nextWorkflowDue(schedule, previous, after); if (next === null) break; dates.push(next); after = next; previous = next }
        return { dates, error: '' }
      }
      catch (error) { return { dates: [], error: error instanceof Error ? error.message : String(error) } }
    },
  },
  watch: { selectedId() { this.editing = false; this.error = '' } },
  methods: {
    t, diagnostic, label, dateTime,
    podName(id: string) { return this.pods.find(pod => pod.id === id)?.name ?? id },
    edit(create = false) {
      const definition = create ? undefined : this.definition
      this.id = definition?.id ?? crypto.randomUUID(); this.revision = definition?.revision ?? 0; this.name = definition?.name ?? ''; this.nodes = (definition?.nodes ?? []).map(node => ({ ...node, after: [...node.after] })); this.enabled = definition?.enabled ?? false
      const spec = definition?.schedule; this.kind = spec?.kind ?? 'none'
      if (spec?.kind === 'interval') this.seconds = spec.seconds
      if (spec?.kind === 'daily') { this.time = spec.time; this.timezone = spec.timezone }
      if (spec?.kind === 'cron') { this.expression = spec.expression; this.timezone = spec.timezone }
      if (spec?.kind === 'once') this.at = new Date(spec.at - new Date(spec.at).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      this.mail = definition?.mail ? JSON.parse(JSON.stringify(definition.mail)) : null
      this.editing = true; this.error = ''
    },
    toggleMail() {
      this.mail = this.mail ? null : { mailbox: '', filterPodId: this.nodes[0]?.podId ?? '', notifyPodId: this.nodes[1]?.podId ?? '', applicationId: '', telegramCredential: 'telegram_bot_token', telegramChatId: '', protectedPartners: [], rules: [], mode: 'preview' }
    },
    togglePod(podId: string) {
      if (this.nodes.some(node => node.podId === podId)) this.nodes = this.nodes.filter(node => node.podId !== podId).map(node => ({ ...node, after: node.after.filter(id => id !== podId) }))
      else this.nodes.push({ podId, after: [], handoff: false })
    },
    schedule(): WorkflowSchedule | null {
      if (this.kind === 'none') return null
      return parseWorkflowSchedule(this.kind === 'interval' ? { kind: 'interval', seconds: Number(this.seconds) } : this.kind === 'daily' ? { kind: 'daily', time: this.time, timezone: this.timezone } : this.kind === 'once' ? { kind: 'once', at: Date.parse(this.at) } : { kind: 'cron', expression: this.expression, timezone: this.timezone })
    },
    async apply(command: WorkflowCommand): Promise<boolean> {
      if (this.busy) return false
      this.busy = true; this.error = ''
      try { this.$emit('changed', await window.pods.workflows(command)); return true }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); return false }
      finally { this.busy = false }
    },
    async save() {
      try {
        const command: WorkflowCommand = { type: 'save', id: this.id, revision: this.revision, name: this.name, nodes: parseWorkflowNodes(this.nodes), schedule: this.schedule(), enabled: this.kind !== 'none' && this.enabled, ...(this.mail ? { mail: this.mail } : {}) }
        if (await this.apply(command)) { this.editing = false; this.$emit('select', this.id) }
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error) }
    },
  },
})
</script>

<template>
  <section class="workflow-panel">
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <div class="overview-actions">
      <button class="secondary" :disabled="busy" @click="edit(true)">
        {{ t('New workflow') }}
      </button>
      <button v-if="definition && !editing" class="secondary" :disabled="busy" @click="edit()">
        {{ t('Edit workflow') }}
      </button>
      <button v-if="definition && !editing && !active" class="secondary" :disabled="busy" @click="apply({ type: 'delete', id: definition.id, revision: definition.revision })">
        {{ t('Remove workflow') }}
      </button>
    </div>
    <form v-if="editing" class="card workflow-editor" :aria-label="t('Edit workflow')" @submit.prevent="save">
      <label>{{ t('Workflow name') }}<input v-model="name" required maxlength="100"></label>
      <fieldset>
        <legend>{{ t('Add existing pods') }}</legend>
        <p class="muted">
          {{ t('Connecting pods leaves their scripts, permissions and own schedules unchanged.') }}
        </p>
        <div class="workflow-pod-picker">
          <label v-for="pod in availablePods" :key="pod.id"><input type="checkbox" :checked="nodes.some(node => node.podId === pod.id)" @change="togglePod(pod.id)">{{ pod.name }}</label>
        </div>
      </fieldset>
      <p>{{ t('Select pods, then choose their predecessors. All predecessors must finish successfully.') }}</p>
      <fieldset v-for="node in nodes" :key="node.podId" class="workflow-dependencies">
        <legend>{{ podName(node.podId) }}</legend><span class="mini-label">{{ t('Starts after') }}</span>
        <div class="workflow-pod-picker">
          <label v-for="candidate in nodes.filter(item => item.podId !== node.podId)" :key="candidate.podId"><input v-model="node.after" type="checkbox" :value="candidate.podId">{{ podName(candidate.podId) }}</label>
        </div>
        <p v-if="!node.after.length" class="muted">
          {{ t('Starts with the workflow') }}
        </p>
        <label v-if="node.after.length"><input v-model="node.handoff" type="checkbox">{{ t('Receive published predecessor results') }}</label>
      </fieldset>
      <p v-if="nodes.length && graphError" role="alert" class="error-message">
        {{ diagnostic(graphError) }}
      </p>
      <fieldset>
        <legend>{{ t('Workflow schedule') }}</legend>
        <select v-model="kind" :aria-label="t('Workflow schedule')">
          <option value="none">
            {{ t('No automatic schedule') }}
          </option><option value="interval">
            {{ t('Interval') }}
          </option><option value="daily">
            {{ t('Daily') }}
          </option><option value="once">
            {{ t('One time') }}
          </option><option value="cron">
            {{ t('Cron') }}
          </option>
        </select>
        <label v-if="kind === 'interval'">{{ t('Interval in seconds') }}<input v-model.number="seconds" type="number" min="60" max="2592000" required></label>
        <label v-if="kind === 'daily'">{{ t('Local time') }}<input v-model="time" type="time" required></label>
        <label v-if="kind === 'once'">{{ t('Start date and time') }}<input v-model="at" type="datetime-local" required></label>
        <label v-if="kind === 'cron'">{{ t('Cron expression') }}<input v-model="expression" required></label>
        <label v-if="kind === 'daily' || kind === 'cron'">{{ t('Timezone') }}<input v-model="timezone" required></label>
        <p v-if="kind === 'cron'" class="muted">
          {{ t('Five fields: minute, hour, day, month, weekday. Restricted day and weekday match with OR.') }}
        </p>
        <p v-if="preview.error" role="alert" class="error-message">
          {{ diagnostic(preview.error) }}
        </p>
        <div v-if="preview.dates.length">
          <strong>{{ t('Upcoming occurrences') }}</strong><ul>
            <li v-for="date in preview.dates" :key="date">
              {{ dateTime(date) }}
            </li>
          </ul>
        </div>
        <label v-if="kind !== 'none'"><input v-model="enabled" type="checkbox">{{ t('Enable automatic schedule') }}</label>
        <p class="muted">
          {{ t('The app must be running. Missed slots are coalesced. Pausing stops new node starts.') }}
        </p>
      </fieldset>
      <label><input type="checkbox" :checked="!!mail" @change="toggleMail">{{ t('Configure mail filtering and notification') }}</label>
      <MailWorkflowSettings v-if="mail" :key="id" :configuration="mail" :pods="pods.filter(pod => nodes.some(node => node.podId === pod.id))" @update="mail = $event" />
      <div class="overview-actions">
        <button type="submit" class="primary" :disabled="busy || !!graphError || !!preview.error">
          {{ t('Save workflow') }}
        </button><button type="button" class="secondary" @click="editing = false">
          {{ t('Cancel') }}
        </button>
      </div>
    </form>
    <template v-else-if="definition">
      <article class="card">
        <div class="card-heading">
          <h2>{{ definition.name }}</h2><span class="badge">{{ label(definition.paused ? 'paused' : 'active') }}</span>
        </div>
        <p>{{ t('Member pods may be paused individually; this workflow can still invoke them.') }}</p><p class="muted">
          {{ t('Review existing pod schedules to avoid separate, independent runs.') }}
        </p>
        <p>{{ definition.enabled ? t('Schedule enabled') : t('Schedule off') }} · {{ label(definition.schedule?.kind ?? 'Manual only') }}<span v-if="definition.enabled && definition.nextAt"> · {{ dateTime(definition.nextAt) }}</span></p>
        <div class="overview-actions">
          <button class="primary" :disabled="busy || !!active" @click="apply({ type: 'start', id: definition.id, revision: definition.revision })">
            {{ t('Run workflow once') }}
          </button><button class="secondary" :disabled="busy" @click="apply({ type: 'pause', id: definition.id, revision: definition.revision, paused: !(active?.paused ?? definition.paused) })">
            {{ t((active?.paused ?? definition.paused) ? 'Resume workflow' : 'Pause workflow') }}
          </button>
        </div>
      </article>
    </template>
    <article v-else-if="!editing" class="card">
      <h2>{{ t('No workflows yet') }}</h2><p>{{ t('Create a workflow from existing pods to control their order and timing.') }}</p>
    </article>
    <MailWorkflowSettings v-if="definition?.mail && !editing" :key="`${definition.id}:${definition.revision}`" :configuration="definition.mail" :pods="pods" readonly />
    <div v-if="layers.length" class="workflow-graph" :aria-label="t('Workflow graph')">
      <div v-for="(layer, index) in layers" :key="index" class="workflow-layer">
        <article v-for="node in layer" :key="node.podId" class="workflow-node">
          <strong>{{ podName(node.podId) }}</strong><small>{{ node.after.length ? `${t('Starts after')}: ${node.after.map(podName).join(', ')}` : t('Starts with the workflow') }}</small><span v-if="active" class="badge">{{ label(active.nodes.find(item => item.podId === node.podId)?.state) }}</span>
        </article>
      </div>
    </div>
    <section v-if="definition && !editing" class="workflow-history">
      <h2>{{ t('Run history') }}</h2><p v-if="!history.length" class="muted">
        {{ t('No workflow runs yet') }}
      </p>
      <article v-for="run in history" :key="run.id" class="card">
        <div class="card-heading">
          <strong>{{ dateTime(run.startedAt) }}</strong><span class="badge">{{ label(run.state) }}</span>
        </div><p v-if="run.reason" role="status">
          {{ diagnostic(run.reason) }}
        </p>
        <MailWorkflowReview v-if="definition.mail" :batch-id="run.id" />
        <ol class="workflow-run-nodes">
          <li v-for="node in run.nodes" :key="node.podId">
            <div>
              <strong>{{ podName(node.podId) }}</strong> · {{ label(node.state) }}<p v-if="node.reason">
                {{ diagnostic(node.reason) }}
              </p>
            </div><button v-if="node.state === 'blocked' && !run.finishedAt" class="secondary" :disabled="busy" @click="apply({ type: 'retry', runId: run.id, podId: node.podId })">
              {{ t('Retry blocked node') }}
            </button>
          </li>
        </ol>
        <p v-if="run.state === 'blocked'" class="muted">
          {{ t('Retry keeps completed nodes and their effects. Reconcile uncertain effects in the pod history first.') }}
        </p>
        <button v-if="!run.finishedAt" class="secondary" :disabled="busy" @click="apply({ type: 'cancel', runId: run.id })">
          {{ t(run.reason === 'Workflow cancellation requested' ? 'Finish cancellation' : 'Cancel workflow') }}
        </button>
      </article>
    </section>
  </section>
</template>

<style scoped>
.workflow-panel { display:grid; gap:20px; }
.workflow-editor { display:grid; gap:18px; }
.workflow-editor fieldset { border:1px solid var(--border); border-radius:12px; padding:16px; min-width:0; }
.workflow-editor legend { padding:0 6px; font-weight:600; }
.workflow-editor label { display:flex; align-items:center; gap:9px; flex-wrap:wrap; margin:10px 0; }
.workflow-editor input:not([type=checkbox]),.workflow-editor select { max-width:100%; padding:9px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); }
.workflow-editor>label { flex-direction:column; align-items:stretch; }
.workflow-pod-picker { display:flex; flex-wrap:wrap; gap:0 20px; }
.workflow-graph { display:flex; gap:28px; overflow-x:auto; padding:8px 2px 18px; align-items:center; }
.workflow-layer { display:grid; flex:1 0 180px; gap:14px; max-width:280px; position:relative; }
.workflow-layer+.workflow-layer::before { content:'→'; position:absolute; left:-23px; top:50%; color:var(--muted); }
.workflow-node { display:grid; gap:10px; padding:16px; border:1px solid var(--border); border-radius:12px; background:var(--surface); overflow-wrap:anywhere; }
.workflow-node small { line-height:1.5; }
.workflow-run-nodes { padding-left:22px; }
.workflow-run-nodes li { padding:12px 0; }
.workflow-run-nodes p { margin:6px 0; }
@media (max-width:900px) { .workflow-graph { flex-direction:column; align-items:stretch; overflow:visible; } .workflow-layer { flex:auto; max-width:none; } .workflow-layer+.workflow-layer::before { content:'↓'; left:50%; top:-24px; } }
</style>
