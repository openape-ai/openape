<script lang="ts">
import { defineComponent } from 'vue'
import type { UpdateView } from '../contracts/updates'
import { t, diagnostic } from './i18n'

export default defineComponent({
  data() { return { view: null as UpdateView | null, error: '', busy: false, timer: undefined as ReturnType<typeof setInterval> | undefined } },
  computed: {
    working(): boolean { return this.busy || (!!this.view && ['checking', 'downloading', 'preparing', 'installing'].includes(this.view.state)) },
  },
  async mounted() { await this.refresh(); this.timer = setInterval(() => { void this.refresh() }, 1000) },
  beforeUnmount() { clearInterval(this.timer) },
  methods: {
    t, diagnostic,
    async refresh() {
      if (!window.pods.updates) return
      try { this.view = await window.pods.updates({ type: 'status' }) }
      catch (error) { this.error = error instanceof Error ? error.message : 'Update failed' }
    },
    async perform(type: 'check' | 'install') {
      if (!window.pods.updates || this.working) return
      this.busy = true; this.error = ''
      try { this.view = await window.pods.updates({ type }) }
      catch (error) { this.error = error instanceof Error ? error.message : 'Update failed' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <article class="card software-updates">
    <h2>{{ t('Software updates') }}</h2>
    <p v-if="!view || view.state === 'disabled'" class="muted">
      {{ t('Updates are available in the installed Mac app.') }}
    </p>
    <template v-else>
      <p>{{ t('Current version') }}: {{ view.currentVersion }}<span v-if="view.version"> · {{ t('New version') }}: {{ view.version }}</span></p>
      <p class="muted">
        {{ t('Updates are checked automatically every six hours. Installation requires an idle workspace and creates a backup before restarting.') }}
      </p>
      <p v-if="view.state === 'idle'" role="status">
        {{ t('No newer version is available.') }}
      </p>
      <p v-if="view.state === 'checking'" role="status">
        {{ t('Checking for updates…') }}
      </p>
      <p v-if="view.state === 'downloading'" role="status">
        {{ t('Downloading update…') }} {{ Math.round(view.progress) }}%
      </p>
      <p v-if="view.state === 'preparing'" role="status">
        {{ t('Preparing update and backup…') }}
      </p>
      <p v-if="view.state === 'installing'" role="status">
        {{ t('Installing update…') }}
      </p>
      <div class="actions">
        <button class="secondary" :disabled="working" @click="perform('check')">
          {{ t('Check for updates') }}
        </button>
        <button v-if="view.version" class="primary" :disabled="working" @click="perform('install')">
          {{ t('Restart and install') }}
        </button>
      </div>
      <p v-if="view.backup" class="backup">
        {{ view.backup }}
      </p>
    </template>
    <p v-if="error || view?.error" class="error-message" role="alert">
      {{ diagnostic(error || view?.error) }}
    </p>
  </article>
</template>

<style scoped>
.actions { display: flex; flex-wrap: wrap; gap: 12px; }
.backup { overflow-wrap: anywhere; }
p { line-height: 1.6; }
</style>
