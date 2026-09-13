<script lang="ts">
import { defineComponent } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { RunCommand, RunView } from '../contracts/runs'

export default defineComponent({
  data() {
    return { pods: [] as StoredPod[], podId: '', runId: '', view: { runs: [], events: [] } as RunView, busy: false, error: '', pending: 0, blocked: 0, timer: null as ReturnType<typeof setTimeout> | null, closed: false }
  },
  async mounted() {
    try { this.pods = (await window.pods.workspace({ type: 'list' })).pods; this.podId = this.pods[0]?.id ?? ''; if (this.podId) await this.load() }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not load runs' }
    this.scheduleRefresh()
  },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
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
      <h2>Runs</h2><span class="badge">Manual execution</span>
    </div>
    <p v-if="!pods.length" class="muted">
      Create a pod in Settings to run its first script.
    </p>
    <template v-else>
      <label>Pod<select v-model="podId" :disabled="busy" @change="changePod"><option v-for="pod in pods" :key="pod.id" :value="pod.id">{{ pod.name }}</option></select></label>
      <p class="muted">
        The local example increments a durable checkpoint. The agent example also needs a connected Codex provider.
      </p>
      <div class="run-actions">
        <button class="secondary" :disabled="busy || view.runs.some(run => run.state === 'running')" @click="act({ type: 'installExample', podId, variant: 'deterministic' })">
          Use local example
        </button>
        <button class="secondary" :disabled="busy || view.runs.some(run => run.state === 'running')" @click="act({ type: 'installExample', podId, variant: 'agent' })">
          Use agent example
        </button>
        <button class="primary" :disabled="busy || view.runs.some(run => run.state === 'running')" @click="act({ type: 'start', podId })">
          Start run
        </button>
      </div>
      <p v-if="pending || blocked" class="muted">
        {{ pending }} inputs queued · {{ blocked }} awaiting recovery
      </p>
      <p v-if="!view.runs.length" class="muted">
        No runs yet. Choose a version, then start it manually.
      </p>
      <article v-for="run in view.runs" :key="run.id" class="run-row">
        <button class="text-button" :aria-pressed="runId === run.id" @click="runId = run.id; load()">
          {{ run.summary || 'Run in progress' }}
        </button>
        <span class="badge">{{ run.state }}</span>
        <p class="muted">
          {{ new Date(run.startedAt).toLocaleString() }} · checkpoint {{ run.checkpointRevision }}
        </p>
        <p v-if="run.error" class="error-message">
          {{ run.error }}
        </p>
        <button v-if="run.state === 'running'" class="secondary" :disabled="busy" @click="act({ type: 'cancel', podId, runId: run.id })">
          Cancel run
        </button>
      </article>
      <details v-if="view.events.length">
        <summary>Persisted events</summary><ol class="event-list">
          <li v-for="event in view.events" :key="event.sequence">
            <strong>{{ event.sequence }} · {{ event.type }}</strong><pre>{{ JSON.stringify(event.data, null, 2) }}</pre>
          </li>
        </ol>
      </details>
    </template>
    <p v-if="error" class="error-message" role="alert">
      {{ error }}
    </p>
  </article>
</template>

<style scoped>
.runs-panel { max-width: 900px; }
label { display: grid; gap: 8px; margin-top: 20px; }
select { padding: 10px; border: 1px solid currentColor; border-radius: 8px; font: inherit; background: transparent; color: inherit; }
.run-actions { display: flex; gap: 10px; margin: 20px 0; flex-wrap: wrap; }
.run-row { border-top: 1px solid #81908355; padding: 16px 0; }
.run-row .badge { margin-left: 12px; }
.event-list { padding-left: 24px; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
</style>
