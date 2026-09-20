<script lang="ts">
import { t, diagnostic, label, dateTime } from './i18n'
import { runSteps, runHeadline, runFailure, duration } from './run-activity'
import RunApproval from './RunApproval.vue'
import { defineComponent } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { RunCommand, RunView } from '../contracts/runs'

export default defineComponent({
  components: { RunApproval },
  props: { selectedPodId: { type: String, default: '' }, selectedRunId: { type: String, default: '' } },
  emits: ['selected', 'navigate'],
  data() {
    return { now: Date.now(), pods: [] as StoredPod[], podId: '', runId: '', observations: {} as Record<string, string>, view: { runs: [], events: [] } as RunView, busy: false, error: '', scheduleError: '', pending: 0, blocked: 0, timer: null as ReturnType<typeof setTimeout> | null, closed: false }
  },
  computed: {
    selectedRun() { return this.view.runs.find(run => run.id === this.runId) ?? this.view.runs[0] },
    steps() { return runSteps(this.view.events, this.selectedRun?.state) },
    needsRecovery() { return !!this.selectedRun && ['interrupted', 'failed', 'cancelled', 'blocked'].includes(this.selectedRun.state) && this.selectedRun.recovery?.state !== 'retryQueued' },
    hasActiveRun() { return this.view.runs.some(run => run.state === 'running') },
    actionFailure() { return runFailure(this.error || (this.scheduleError !== this.selectedRun?.error ? this.scheduleError : '') || null) },
    timing() { return this.view.timing ? { active: duration(this.view.timing.activeMs), waiting: duration(this.view.timing.waitingMs) } : null },
    currentOperation() { return this.view.approvals?.some(approval => approval.runId === this.selectedRun?.id && approval.state === 'pending') ? 'Waiting for your approval' : this.steps.find(item => item.running)?.title ?? 'Running the script' },
    failure() { return runFailure(this.selectedRun?.error ?? null) },
  },
  async mounted() {
    try { this.pods = (await window.pods.workspace({ type: 'list' })).pods; this.runId = this.selectedRunId; this.podId = this.selectedPodId || this.pods[0]?.id || ''; if (this.podId) await this.load() }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not load runs' }
    this.scheduleRefresh()
  },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, diagnostic, label, dateTime, runHeadline, runFailure,
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
        this.scheduleError = schedule.error ?? ''
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
      <h2>{{ t('Run history') }}</h2>
      <button v-if="pods.length && (!needsRecovery || hasActiveRun)" class="primary" :disabled="busy || hasActiveRun" @click="act({ type: 'start', podId })">
        {{ t('Run now') }}
      </button>
    </div>
    <p v-if="!pods.length" class="muted">
      {{ t('Create a pod in Settings to run its first script.') }}
    </p>
    <template v-else>
      <label v-if="!selectedPodId">{{ t('Pod') }}<select v-model="podId" :disabled="busy" @change="changePod"><option v-for="pod in pods" :key="pod.id" :value="pod.id">{{ pod.name }}</option></select></label>
      <RunApproval :pod-id="podId" :approvals="view.approvals" />
      <p v-if="!view.runs.length" class="muted">
        {{ t('No runs yet. Start the saved script from the Script tab.') }}
      </p>
      <article v-if="selectedRun" class="run-result">
        <p class="muted run-date">
          {{ dateTime(selectedRun.startedAt) }}<span v-if="timing"> · {{ t('Active: {p0} · Approval wait: {p1}', { p0: timing.active, p1: timing.waiting }) }}</span>
        </p>
        <div :class="failure || needsRecovery ? 'run-problem' : 'run-outcome'" role="status">
          <h3>{{ diagnostic(runHeadline(selectedRun)) }}</h3>
          <p v-if="failure">
            {{ diagnostic(failure.help) }}
          </p>
          <p v-else-if="selectedRun.state === 'running'">
            {{ diagnostic(currentOperation) }}
          </p>
          <p v-else-if="selectedRun.summary && !['Run failed', 'Run cancelled', 'Run completed'].includes(selectedRun.summary)">
            {{ label(selectedRun.summary) }}
          </p>
          <button v-if="failure?.action" class="secondary" @click="$emit('navigate', failure.action)">
            {{ failure.action === 'permissions' ? t('Review permissions') : failure.action === 'identity' ? t('Open pod identity') : t('Open App settings') }}
          </button>
          <div v-if="needsRecovery" class="next-action">
            <strong>{{ t('Next step') }}</strong>
            <p v-if="selectedRun.recovery?.state === 'ready'">
              {{ t('The check is complete. You can retry the unfinished work.') }}
            </p>
            <p v-else>
              {{ t('Check whether this run can be retried safely. This check does not start the script.') }}
            </p>
            <button v-if="selectedRun.recovery?.state === 'ready'" class="primary" :disabled="busy || hasActiveRun || !!view.effects?.length" @click="act({ type: 'recover', podId, runId: selectedRun.id, action: 'retry' })">
              {{ t('Retry unfinished work') }}
            </button>
            <button v-else class="primary" :disabled="busy || hasActiveRun" @click="act({ type: 'recover', podId, runId: selectedRun.id, action: 'inspect' })">
              {{ t('Prepare retry') }}
            </button>
            <p v-if="selectedRun.recovery?.error" class="muted">
              {{ diagnostic(runFailure(selectedRun.recovery.error)?.help) }}
            </p>
          </div>
          <p v-else-if="selectedRun.recovery?.state === 'retryQueued'">
            {{ t('Retry queued. The new run will appear here.') }}
          </p>
          <button v-if="selectedRun.state === 'running'" class="secondary" :disabled="busy" @click="act({ type: 'cancel', podId, runId: selectedRun.id })">
            {{ t('Cancel run') }}
          </button>
        </div>
        <section v-if="steps.length" class="run-work">
          <h3>{{ t('What happened') }}</h3>
          <p v-if="(view.events[0]?.sequence ?? 0) > 1" class="muted">
            {{ t('Only the recent part of this run is shown.') }}
          </p>
          <ul class="run-steps">
            <li v-for="(step, index) in steps" :key="index">
              <span class="step" :class="{ failed: step.failed }">{{ step.failed ? '×' : step.running ? '…' : '✓' }}</span>
              <div>
                <strong>{{ diagnostic(step.title) }}</strong><span v-if="step.application" class="muted"> · {{ step.application }}</span><p class="muted">
                  <span v-if="step.completed">{{ t('{p0} completed', { p0: step.completed }) }}</span><span v-if="step.failed">{{ step.completed ? ' · ' : '' }}{{ t('{p0} not completed', { p0: step.failed }) }}</span><span v-if="step.running">{{ step.completed || step.failed ? ' · ' : '' }}{{ t('In progress') }}</span>
                </p>
              </div>
            </li>
          </ul>
        </section>
      </article>
      <section v-if="view.effects?.length" class="http-review">
        <h3>{{ t('Check the delivery before retrying') }}</h3>
        <p>{{ t('Inspect the destination before retrying. Pods cannot tell whether a request without a receipt was delivered.') }}</p>
        <article v-for="effect in view.effects" :key="effect.key">
          <label>{{ t('Your observation') }}<textarea v-model="observations[effect.key]" maxlength="4000" /></label>
          <button :disabled="busy || !observations[effect.key]?.trim()" @click="act({ type: 'resolveHttp', podId, runId: effect.runId, key: effect.key, applied: true, evidence: observations[effect.key] })">
            {{ t('Already delivered') }}
          </button>
          <button :disabled="busy || !observations[effect.key]?.trim()" @click="act({ type: 'resolveHttp', podId, runId: effect.runId, key: effect.key, applied: false, evidence: observations[effect.key] })">
            {{ t('Not delivered · allow retry') }}
          </button>
          <small>{{ effect.key }}</small>
        </article>
      </section>
      <div v-if="actionFailure" class="run-problem" role="alert">
        <strong>{{ diagnostic(actionFailure.title) }}</strong><p>{{ diagnostic(actionFailure.help) }}</p>
        <button v-if="actionFailure.action" class="secondary" @click="$emit('navigate', actionFailure.action)">
          {{ actionFailure.action === 'permissions' ? t('Review permissions') : actionFailure.action === 'identity' ? t('Open pod identity') : t('Open App settings') }}
        </button>
      </div>
      <details v-if="blocked || pending" class="queued-starts">
        <summary>{{ t('Other waiting starts: {p0}', { p0: blocked + pending }) }}</summary>
        <p>{{ t('These are queued start requests, not a count of emails or files. Repeated clicks may create several requests.') }}</p>
        <button v-if="blocked" class="secondary" :disabled="busy || hasActiveRun" @click="act({ type: 'retryQueue', podId })">
          {{ t('Retry unstarted requests') }}
        </button>
      </details>
      <details class="run-details">
        <summary>{{ t('Technical details') }}</summary>
        <p v-if="error || scheduleError">
          {{ error || scheduleError }}
        </p>
        <p v-if="selectedRun?.error">
          {{ selectedRun.error }}
        </p>
        <p v-if="selectedRun?.recovery?.error">
          {{ selectedRun.recovery.error }}
        </p>
        <p v-if="selectedRun">
          {{ t('Pinned script') }} <code>{{ selectedRun.scriptHash }}</code>
        </p>
        <ol class="event-list">
          <li v-for="event in view.events" :key="event.sequence">
            <strong>{{ dateTime(event.at) }} · {{ event.type }}</strong><pre>{{ JSON.stringify(event.data, null, 2) }}</pre>
          </li>
        </ol>
      </details>
      <section v-if="view.runs.length > 1" class="run-history">
        <h3>{{ t('Previous runs') }}</h3>
        <button v-for="run in view.runs" :key="run.id" class="history-entry" :aria-pressed="run.id === selectedRun?.id" @click="runId = run.id; load()">
          <span>{{ dateTime(run.startedAt) }}</span><span>{{ diagnostic(runHeadline(run)) }}</span>
        </button>
      </section>
    </template>
  </article>
</template>

<style scoped>
.runs-panel { max-width: 900px; }
.run-date { font-size: 13px; margin: 8px 0 20px; }
.run-problem, .run-outcome { padding: 20px; border-radius: 12px; background: #edf3e9; }
.run-problem { background: #fff5f0; color: #573e31; border: 1px solid #ebcfbf; }
h3 { margin: 0 0 12px; } p { line-height: 1.5; }
.next-action { border-top: 1px solid #81908344; padding-top: 16px; margin-top: 18px; }
.next-action strong { display: block; } .next-action p { margin: 8px 0 14px; }
.run-work { margin: 26px 0; }
.run-steps { list-style: none; padding: 0; display: grid; gap: 14px; }
.run-steps li { display: flex; align-items: start; gap: 12px; }
.run-steps p { font-size: 13px; margin: 3px 0; }
.step { background: #e9eee5; border-radius: 50%; width: 26px; text-align: center; flex-shrink: 0; }
.step.failed { background: #f8ddd5; }
.run-details, .queued-starts { margin-top: 20px; } summary { cursor: pointer; }
.run-history { border-top: 1px solid #81908344; margin-top: 24px; padding-top: 20px; }
.history-entry { width: 100%; display: flex; justify-content: space-between; gap: 15px; text-align: left; margin: 8px 0; flex-wrap: wrap; }
.history-entry[aria-pressed="true"] { border-color: #3e7756; }
label { display: grid; gap: 8px; margin-top: 20px; }
select { padding: 10px; border: 1px solid currentColor; border-radius: 8px; font: inherit; background: transparent; color: inherit; }
pre, code, small { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.http-review { margin: 20px 0; } .http-review small { display: block; margin: 8px 0; }
</style>
