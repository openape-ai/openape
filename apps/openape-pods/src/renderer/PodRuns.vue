<script lang="ts">
import { t, diagnostic, label, dateTime } from './i18n'
import { defineComponent } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { RunCommand, RunView } from '../contracts/runs'

export default defineComponent({
  props: { selectedPodId: { type: String, default: '' } },
  emits: ['selected'],
  data() {
    return { pods: [] as StoredPod[], podId: '', runId: '', observations: {} as Record<string, string>, view: { runs: [], events: [] } as RunView, busy: false, error: '', pending: 0, blocked: 0, timer: null as ReturnType<typeof setTimeout> | null, closed: false }
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
        if (!this.busy && this.podId) await this.load()
        this.scheduleRefresh()
      }, 1000)
    },
    async act(command: RunCommand, preserveError = false) {
      this.busy = true; if (!preserveError) this.error = ''
      try {
        const [view, schedule] = await Promise.all([window.pods.runs(command), window.pods.scheduling({ type: 'list', podId: this.podId })])
        this.view = view; this.pending = schedule.pending; this.blocked = schedule.blocked
        if (schedule.error) this.error = schedule.error
        this.runId = this.view.runs.find(run => run.id === this.runId)?.id ?? this.view.runs[0]?.id ?? ''
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
      <p class="muted">
        {{ t("The local example increments a durable checkpoint. The agent example also needs a connected Codex provider.") }}
      </p>
      <div class="run-actions">
        <button class="secondary" :disabled="busy || view.runs.some(run => run.state === 'running')" @click="act({ type: 'installExample', podId, variant: 'deterministic' })">
          {{ t("Use local example") }}
        </button>
        <button class="secondary" :disabled="busy || view.runs.some(run => run.state === 'running')" @click="act({ type: 'installExample', podId, variant: 'agent' })">
          {{ t("Use agent example") }}
        </button>
        <button class="primary" :disabled="busy || view.runs.some(run => run.state === 'running')" @click="act({ type: 'start', podId })">
          {{ t("Start run") }}
        </button>
      </div>
      <p v-if="pending || blocked" class="muted">
        {{ t("{p0} inputs queued · {p1} awaiting recovery", { p0: pending, p1: blocked }) }}
      </p>
      <button v-if="blocked" class="secondary" :disabled="busy" @click="act({ type: 'retryQueue', podId })">
        {{ t("Retry unstarted inputs") }}
      </button>
      <p v-if="!view.runs.length" class="muted">
        {{ t("No runs yet. Choose a version, then start it manually.") }}
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
      <article v-for="run in view.runs" :key="run.id" class="run-row">
        <button class="text-button" :aria-pressed="runId === run.id" @click="runId = run.id; load()">
          {{ run.summary || (run.state === 'running' ? t("Run in progress") : t("Interrupted run")) }}
        </button>
        <span class="badge">{{ label(run.state) }}</span>
        <p class="muted">
          {{ t("{p0} · checkpoint {p1}", { p0: dateTime(run.startedAt), p1: run.checkpointRevision }) }}
          <span class="pinned-version">{{ t("Pinned script") }} <code>{{ run.scriptHash }}</code></span>
        </p>
        <p v-if="run.error" class="error-message">
          {{ diagnostic(run.error) }}
        </p>
        <div v-if="['interrupted', 'failed', 'cancelled', 'blocked'].includes(run.state)" class="recovery-actions">
          <p v-if="run.recovery" class="muted">
            {{ t("Recovery: {p0}", { p0: label(run.recovery.state) }) }}<span v-if="run.recovery.error"> · {{ diagnostic(run.recovery.error) }}</span>
          </p>
          <button class="secondary" :disabled="busy" @click="act({ type: 'recover', podId, runId: run.id, action: 'inspect' })">
            {{ t("Check stopped execution") }}
          </button>
          <button class="secondary" :disabled="busy || run.recovery?.state === 'needsReview' || run.recovery?.state === 'retryQueued'" @click="act({ type: 'recover', podId, runId: run.id, action: 'retry' })">
            {{ t("Retry remaining inputs") }}
          </button>
        </div>
        <button v-if="run.state === 'running'" class="secondary" :disabled="busy" @click="act({ type: 'cancel', podId, runId: run.id })">
          {{ t("Cancel run") }}
        </button>
      </article>
      <details v-if="view.events.length">
        <summary>{{ t("Persisted events") }}</summary><ol class="event-list">
          <li v-for="event in view.events" :key="event.sequence">
            <strong>{{ event.sequence }} · {{ event.type }}</strong><pre>{{ JSON.stringify(event.data, null, 2) }}</pre>
          </li>
        </ol>
      </details>
    </template>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
  </article>
</template>

<style scoped>
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
