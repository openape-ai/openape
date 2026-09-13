<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { ScheduleCommand, ScheduleView } from '../contracts/scheduling'

export default defineComponent({
  props: { pod: { type: Object as PropType<StoredPod>, required: true } },
  emits: ['changed'],
  data() { return { view: null as ScheduleView | null, kind: 'interval', minutes: 60, time: '08:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, enabled: false, concurrency: 2, error: '', message: '', busy: false } },
  watch: { 'pod.id': { immediate: true, handler() { void this.load() } } },
  methods: {
    async load() {
      this.busy = true; this.error = ''
      try {
        this.view = await window.pods.scheduling({ type: 'list', podId: this.pod.id })
        this.enabled = this.view.enabled; this.concurrency = this.view.concurrency
        const spec = this.view.spec
        if (spec) {
          this.kind = spec.kind; if (spec.kind === 'interval') {
            this.minutes = spec.seconds / 60
          }
          else { this.time = spec.time; this.timezone = spec.timezone }
        }
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not load schedule' }
      finally { this.busy = false }
    },
    async act(command: ScheduleCommand) {
      this.busy = true; this.error = ''; this.message = ''
      try { this.view = await window.pods.scheduling(command); this.message = 'Saved on this Mac.'; this.$emit('changed') }
      catch (error) { this.error = error instanceof Error ? error.message : 'Schedule operation failed' }
      finally { this.busy = false }
    },
    async save() {
      if (!this.view) return
      await this.act({ type: 'save', podId: this.pod.id, revision: this.view.revision, enabled: this.enabled, spec: this.kind === 'interval' ? { kind: 'interval', seconds: this.minutes * 60 } : { kind: 'daily', time: this.time, timezone: this.timezone } })
    },
  },
})
</script>

<template>
  <article class="card schedule-panel">
    <div class="card-heading">
      <h2>Schedule and limits</h2><span class="badge">{{ pod.lifecycle }}</span>
    </div>
    <p class="muted">
      Schedules run while Pods is open. Missed times produce one catch-up. Pausing stops new automatic runs; an existing run can finish.
    </p>
    <form @submit.prevent="save">
      <label for="schedule-repeat">Repeat</label><select id="schedule-repeat" v-model="kind" :disabled="busy">
        <option value="interval">
          At an interval
        </option><option value="daily">
          Daily
        </option>
      </select>
      <label v-if="kind === 'interval'">Interval in minutes<input v-model.number="minutes" type="number" min="1" max="43200" step="1" required :disabled="busy"></label>
      <template v-else>
        <label>Local time<input v-model="time" type="time" required :disabled="busy"></label><label>Time zone<input v-model="timezone" required :disabled="busy"></label><p class="muted">
          A repeated clock time runs once. A missing clock time moves to the next available local time.
        </p>
      </template>
      <label class="check"><input v-model="enabled" type="checkbox" :disabled="busy">Enable this schedule</label>
      <button class="secondary" :disabled="busy || !view || pod.lifecycle === 'archived'">
        Save schedule
      </button>
    </form>
    <p v-if="view?.nextAt" class="muted">
      {{ view.enabled && pod.lifecycle === 'active' ? 'Next scheduled time' : 'Saved next time · automatic execution paused' }}: {{ new Date(view.nextAt).toLocaleString() }}
    </p>
    <button class="secondary" :disabled="busy || pod.lifecycle === 'archived'" @click="act({ type: 'lifecycle', podId: pod.id, revision: pod.revision, lifecycle: pod.lifecycle === 'active' ? 'paused' : 'active' })">
      {{ pod.lifecycle === 'active' ? 'Pause automatic execution' : 'Resume automatic execution' }}
    </button>
    <form class="limit-form" @submit.prevent="act({ type: 'concurrency', podId: pod.id, maximum: concurrency })">
      <label>Concurrent pods on this Mac<input v-model.number="concurrency" type="number" min="1" max="16" required :disabled="busy"></label><button class="secondary" :disabled="busy">
        Save concurrency limit
      </button>
    </form>
    <p v-if="view" class="muted">
      {{ view.pending }} pending inputs · {{ view.blocked }} inputs awaiting recovery
    </p>
    <p v-if="error || view?.error" class="error-message" role="alert">
      {{ error || view?.error }}
    </p>
    <p v-if="message" role="status">
      {{ message }}
    </p>
  </article>
</template>

<style scoped>
.schedule-panel { margin-top: 24px; max-width: 780px; }
form, label { display: grid; gap: 10px; } form { margin: 20px 0; gap: 16px; }
input, select { font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 8px; padding: 10px; box-sizing: border-box; }
.check { display: flex; align-items: center; } button { justify-self: start; }
.limit-form { border-top: 1px solid #81908355; padding-top: 20px; }
</style>
