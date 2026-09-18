<script lang="ts">
import { t, diagnostic, label, dateTime } from './i18n'
import { runActivity, runFailure, duration } from './run-activity'
import RunApproval from './RunApproval.vue'
import { defineComponent } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { RunCommand, RunView } from '../contracts/runs'

export default defineComponent({
  components: { RunApproval },
  props: { selectedPodId: { type: String, default: '' } },
  emits: ['selected', 'navigate'],
  data() {
    return { now: Date.now(), pods: [] as StoredPod[], podId: '', runId: '', observations: {} as Record<string, string>, view: { runs: [], events: [] } as RunView, busy: false, error: '', pending: 0, blocked: 0, timer: null as ReturnType<typeof setTimeout> | null, closed: false }
  },
  computed: {
    selectedRun() { return this.view.runs.find(run => run.id === this.runId) ?? this.view.runs[0] },
    activity() { return runActivity(this.view.events) },
    timing() { return this.view.timing ? { active: duration(this.view.timing.activeMs), waiting: duration(this.view.timing.waitingMs) } : null },
    currentOperation() { return [...this.activity].reverse().find(item => item.state === 'started')?.title ?? 'Running the script' },
    failure() { return runFailure(this.selectedRun?.error ?? null) },
  },
  async mounted() {
    try { this.pods = (await window.pods.workspace({ type: 'list' })).pods; this.podId = this.selectedPodId || this.pods[0]?.id || ''; if (this.podId) await this.load() }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not load runs' }
    this.scheduleRefresh()
  },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, diagnostic, label, dateTime,
    scheduleRefresh() {
      if (this.closed) return
      this.timer = setTimeout(async () => {
        this.now = Date.now()
        if (!this.busy && this.podId) await this.load()
        this.scheduleRefresh()
      }, 1000)
    },
    async act(command: RunCommand, preserveError = false) {
      this.busy = true; if (command.type === 'start') this.runId = ''; if (!preserveError) this.error = ''
      try {
        const [view, schedule] = await Promise.all([window.pods.runs(command), window.pods.scheduling({ type: 'list', podId: this.podId })])
        this.view = view; this.pending = schedule.pending; this.blocked = schedule.blocked
        if (schedule.error) this.error = schedule.error
        if (this.runId && !this.view.runs.some(run => run.id === this.runId)) this.runId = ''
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Run operation failed' }
      finally { this.busy = false }
    },
    async load() { await this.act({ type: 'list', podId: this.podId, ...(this.runId ? { runId: this.runId } : {}) }, true) },
    async changePod() { this.runId = ''; await this.load() },
  },
})
</script>

<template>
  <article class="card runs-panel">
    <div class="card-heading">
      <h2>{{ t("Runs") }}</h2><span class="badge">{{ t("Manual execution") }}</span>
    </div>
    <p v-if="!pods.length" class="muted">
      {{ t("Create a pod in Settings to run its first script.") }}
    </p>
    <template v-else>
      <label v-if="!selectedPodId">{{ t("Pod") }}<select v-model="podId" :disabled="busy" @change="changePod"><option v-for="pod in pods" :key="pod.id" :value="pod.id">{{ pod.name }}</option></select></label>
      <div class="run-actions">
        <button class="primary" :disabled="busy || view.runs.some(run => run.state === 'running')" @click="act({ type: 'start', podId })">
          {{ t("Start run") }}
        </button>
      </div>
      <RunApproval :pod-id="podId" :approvals="view.approvals" />
      <p v-if="pending || blocked" class="muted">
        {{ t("{p0} inputs queued · {p1} awaiting recovery", { p0: pending, p1: blocked }) }}
      </p>
      <button v-if="blocked" class="secondary" :disabled="busy" @click="act({ type: 'retryQueue', podId })">
        {{ t("Retry unstarted inputs") }}
      </button>
      <p v-if="!view.runs.length" class="muted">
        {{ t("No runs yet. Start the saved script from the Script tab.") }}
      </p>
      <section v-if="view.effects?.length" class="http-review">
        <h3>{{ t('Uncertain HTTP deliveries') }}</h3>
        <p>{{ t('Inspect the destination before retrying. Pods cannot tell whether a request without a receipt was delivered.') }}</p>
        <article v-for="effect in view.effects" :key="effect.key">
          <strong>{{ effect.key }}</strong>
          <label>{{ t('Your observation') }}<textarea v-model="observations[effect.key]" maxlength="4000" /></label>
          <button :disabled="busy || !observations[effect.key]?.trim()" @click="act({ type: 'resolveHttp', podId, runId: effect.runId, key: effect.key, applied: true, evidence: observations[effect.key] })">
            {{ t('Already delivered') }}
          </button>
          <button :disabled="busy || !observations[effect.key]?.trim()" @click="act({ type: 'resolveHttp', podId, runId: effect.runId, key: effect.key, applied: false, evidence: observations[effect.key] })">
            {{ t('Not delivered · allow retry') }}
          </button>
        </article>
      </section>
      <article v-for="run in selectedRun ? [selectedRun] : []" :key="run.id" class="run-row">
        <button class="text-button" :aria-pressed="runId === run.id" @click="runId = run.id; load()">
          {{ run.state === 'running' ? t('Current run') : t('Selected run') }}
        </button>
        <span class="badge">{{ run.state === 'running' && view.approvals?.length ? t('Waiting for your approval') : label(run.state) }}</span>
        <p v-if="run.state === 'running' && !view.approvals?.length">
          <strong>{{ diagnostic(currentOperation) }}</strong>
        </p>
        <p v-if="timing" class="muted">
          {{ t('Active: {p0} · Approval wait: {p1}', { p0: timing.active, p1: timing.waiting }) }}
        </p>
        <p class="muted">
          {{ t("{p0} · checkpoint {p1}", { p0: dateTime(run.startedAt), p1: run.checkpointRevision }) }}
        </p>
        <div v-if="failure" class="run-problem" role="status">
          <strong>{{ diagnostic(failure.title) }}</strong><p>{{ diagnostic(failure.help) }}</p>
          <button class="secondary" @click="$emit('navigate', 'permissions')">
            {{ t('Review permissions') }}
          </button>
        </div>
        <p v-else-if="run.summary && run.state !== 'running'">
          {{ diagnostic(run.summary) }}
        </p>
        <p v-if="(view.events[0]?.sequence ?? 0) > 1" class="muted">
          {{ t('Showing the most recent run events. Durations include the complete run.') }}
        </p>
        <ol v-if="activity.length" class="run-timeline">
          <li v-for="item in activity" :key="item.sequence">
            <span class="step" :class="[item.state]">{{ ['completed', 'completedWithGaps'].includes(item.state) ? '✓' : ['failed', 'denied', 'revoked'].includes(item.state) ? '×' : '•' }}</span><strong>{{ diagnostic(item.title) }}</strong><span class="muted">{{ new Date(item.at).toLocaleTimeString() }} · {{ label(item.state) }}</span>
          </li>
        </ol>
        <div v-if="['interrupted', 'failed', 'cancelled', 'blocked'].includes(run.state)" class="recovery-actions">
          <p v-if="run.recovery" class="muted">
            {{ t("Recovery: {p0}", { p0: label(run.recovery.state) }) }}<span v-if="run.recovery.error"> · {{ diagnostic(run.recovery.error) }}</span>
          </p>
          <button class="secondary" :disabled="busy" @click="act({ type: 'recover', podId, runId: run.id, action: 'inspect' })">
            {{ t("Check stopped execution") }}
          </button>
          <button class="secondary" :disabled="busy || run.recovery?.state !== 'ready'" @click="act({ type: 'recover', podId, runId: run.id, action: 'retry' })">
            {{ t("Retry remaining inputs") }}
          </button>
        </div>
        <button v-if="run.state === 'running'" class="secondary" :disabled="busy" @click="act({ type: 'cancel', podId, runId: run.id })">
          {{ t("Cancel run") }}
        </button>
      </article>
      <details v-if="view.events.length">
        <summary>{{ t("Technical details") }}</summary><p v-if="selectedRun?.error">
          {{ diagnostic(selectedRun.error) }}
        </p><p v-if="selectedRun" class="pinned-version">
          {{ t("Pinned script") }} <code>{{ selectedRun.scriptHash }}</code>
        </p><ol class="event-list">
          <li v-for="event in view.events" :key="event.sequence">
            <strong>{{ event.sequence }} · {{ event.type }}</strong><pre>{{ JSON.stringify(event.data, null, 2) }}</pre>
          </li>
        </ol>
      </details>
      <section v-if="view.runs.length" class="run-history">
        <h3>{{ t('Run history') }}</h3><button v-for="run in view.runs" :key="run.id" class="history-entry" :aria-pressed="run.id === selectedRun?.id" @click="runId = run.id; load()">
          <span>{{ dateTime(run.startedAt) }}</span><span>{{ label(run.state) }}</span><span>{{ diagnostic(run.summary) }}</span>
        </button>
      </section>
    </template>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
  </article>
</template>

<style scoped>
.run-problem { background: #fff5f0; color: #573e31; border: 1px solid #ebcfbf; padding: 18px; border-radius: 10px; margin: 16px 0; }
.run-timeline { list-style: none; padding: 0; margin: 22px 0; } .run-timeline li { display: grid; grid-template-columns: 24px 1fr auto; gap: 12px; padding: 10px 0; align-items: center; } .run-timeline .muted { font-size: 12px; } .step { border-radius: 50%; text-align: center; background: #e9eee5; } .step.failed, .step.denied { background: #f8ddd5; } .run-history { margin-top: 24px; } .history-entry { width: 100%; display: flex; gap: 15px; text-align: left; margin: 8px 0; flex-wrap: wrap; } .history-entry[aria-pressed="true"] { border-color: #3e7756; }
@media (max-width: 900px) { .run-timeline li { grid-template-columns: 24px 1fr; } .run-timeline .muted { grid-column: 2; } }
.pinned-version { display:block; overflow-wrap:anywhere; } code { font-size:10px; }
.runs-panel { max-width: 900px; }
label { display: grid; gap: 8px; margin-top: 20px; }
select { padding: 10px; border: 1px solid currentColor; border-radius: 8px; font: inherit; background: transparent; color: inherit; }
.run-actions { display: flex; gap: 10px; margin: 20px 0; flex-wrap: wrap; }
.run-row { border-top: 1px solid #81908355; padding: 16px 0; }
.recovery-actions { display: flex; gap: 10px; flex-wrap: wrap; } .recovery-actions p { width: 100%; }
.run-row .badge { margin-left: 12px; }
.event-list { padding-left: 24px; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
</style>
