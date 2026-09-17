<script lang="ts">
import { defineComponent } from 'vue'
import type { ResourceState, PodResource } from '../contracts/resources'
import { parseTerminalView } from '../contracts/programs'
import type { ProgramCommand, TerminalView } from '../contracts/programs'
import { t, diagnostic } from './i18n'

export default defineComponent({
  props: { podId: { type: String, required: true }, state: { type: Object as () => ResourceState, required: true } },
  emits: ['updated'],
  data() { return { selectedApplication: '', busy: false, openingShell: false, error: '', launch: null as TerminalView | null, pollTimer: undefined as ReturnType<typeof setTimeout> | undefined, disposed: false, origin: '', methods: ['GET'] as string[] } },
  computed: {
    selected() { return this.applications.find(item => item.id === this.selectedApplication) },
    applications() { return this.state.resources.filter(item => item.state !== 'revoked' && item.configuration.type === 'program') },
    destinations() { return this.state.resources.filter(item => item.state !== 'revoked' && item.configuration.type === 'http') },
  },
  async mounted() { await this.refreshLaunch() },
  beforeUnmount() { this.disposed = true; clearTimeout(this.pollTimer) },
  methods: {
    t, diagnostic,
    async act(command: ProgramCommand) {
      this.busy = true; this.openingShell = command.type === 'openShell'; this.error = ''
      try {
        const result = await window.pods.programs(command)
        if (command.type === 'launch' || command.type === 'close') { this.launch = parseTerminalView(result); await this.refreshLaunch() }
        else {
          this.$emit('updated', result)
        }
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Application operation failed' }
      finally { this.busy = false; this.openingShell = false }
    },
    async refreshLaunch() {
      clearTimeout(this.pollTimer)
      try {
        const result = await window.pods.programs({ type: 'launchStatus', podId: this.podId })
        if (this.disposed) return
        this.launch = result === null ? null : parseTerminalView(result)
        if (this.launch && this.launch.state !== 'closed') this.pollTimer = setTimeout(() => { void this.refreshLaunch() }, 1000)
      }
      catch (error) { if (!this.disposed) this.error = error instanceof Error ? error.message : 'Application status failed' }
    },
    async grantHttp() {
      this.busy = true; this.error = ''
      try { this.$emit('updated', await window.pods.resources({ type: 'assignHttp', podId: this.podId, epoch: this.state.epoch, permission: { origin: this.origin, methods: this.methods } })) }
      catch (error) { this.error = error instanceof Error ? error.message : 'HTTP permission failed' }
      finally { this.busy = false }
    },
    async revoke(resource: PodResource) {
      this.busy = true; this.error = ''
      try { this.$emit('updated', await window.pods.resources({ type: 'revoke', podId: this.podId, id: resource.id, revision: resource.revision })) }
      catch (error) { this.error = error instanceof Error ? error.message : 'Resource operation failed' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <section class="program-permissions">
    <header>
      <h3>{{ t('Executable applications') }}</h3><button class="secondary" :disabled="busy" @click="act({ type: 'openShell', podId })">
        {{ t('Open Terminal.app') }}
      </button>
    </header>
    <p v-if="openingShell" role="status">
      {{ t('Preparing pod terminal…') }}
    </p>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
    <p class="muted">
      {{ t('Open Terminal.app to configure assigned programs with ape-shell. The terminal and scripts share the pod workspace and program setup.') }}
    </p>
    <section v-if="launch" class="launch-status" aria-live="polite">
      <header>
        <strong>{{ launch.state === 'closed' ? t('Application session ended') : t('Application session · waiting for approval or running') }}</strong>
        <button v-if="launch.state !== 'closed'" class="secondary" :disabled="busy" @click="act({ type: 'close', podId, sessionId: launch.sessionId })">
          {{ t('Stop application') }}
        </button>
      </header>
      <p v-if="launch.error" class="error-message">
        {{ diagnostic(launch.error) }}
      </p>
      <details v-if="launch.output">
        <summary>{{ t('Application output') }}</summary><pre>{{ launch.output }}</pre>
      </details>
    </section>
    <div class="application-list" role="group" :aria-label="t('Executable applications')">
      <article v-for="application in applications" :key="application.id" class="application-card" :class="{ selected: application.id === selectedApplication }">
        <button class="application-select" :aria-pressed="application.id === selectedApplication" @click="selectedApplication = application.id">
          <img v-if="application.configuration.icon" class="application-icon" :src="String(application.configuration.icon)" alt="">
          <span v-else class="application-icon fallback-icon" aria-hidden="true">{{ application.configuration.bundlePath ? '▣' : '›_' }}</span>
          <span>{{ application.name }}</span>
        </button>
        <button class="play-button secondary" :aria-label="t('Open {application}', { application: application.name })" :title="t('Open without arguments')" :disabled="busy || !!launch && launch.state !== 'closed'" @click="act({ type: 'launch', podId, applicationId: application.id, epoch: state.epoch })">
          ▶
        </button>
      </article>
      <p v-if="!applications.length" class="empty-applications">
        {{ t('Add an installed application to use it in this pod.') }}
      </p>
      <footer class="application-toolbar">
        <button class="text-button" :aria-label="t('Add installed application…')" :title="t('Add installed application…')" :disabled="busy" @click="act({ type: 'add', podId, epoch: state.epoch })">
          ＋
        </button>
        <button class="text-button" :aria-label="t('Remove application')" :title="t('Remove application')" :disabled="busy || !selected" @click="selected && revoke(selected)">
          −
        </button>
      </footer>
    </div>
    <h3>{{ t('HTTP destinations') }}</h3>
    <p class="muted">
      {{ t('Node.js scripts can request these HTTPS destinations. Store API tokens under Variables and secrets.') }}
    </p>
    <article v-for="destination in destinations" :key="destination.id" class="application-card">
      <header>
        <strong>{{ destination.name }}</strong><button class="text-button" :disabled="busy" @click="revoke(destination)">
          {{ t('Revoke access') }}
        </button>
      </header>
      <p>{{ (destination.configuration.methods as string[]).join(', ') }}</p>
    </article>
    <form class="http-form" @submit.prevent="grantHttp">
      <label>{{ t('HTTPS origin') }}<input v-model="origin" type="url" required :placeholder="t('https://api.example.com')" :disabled="busy"></label>
      <fieldset><legend>{{ t('Allowed methods') }}</legend><label v-for="method in ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']" :key="method"><input v-model="methods" type="checkbox" :value="method" :disabled="busy">{{ method }}</label></fieldset>
      <button :disabled="busy || !methods.length">
        {{ t('Allow HTTP destination') }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.program-permissions { margin-top:28px; border-top:1px solid var(--border); padding-top:16px; }
.application-list { background:var(--surface); border:1px solid var(--border); border-radius:12px; margin:16px 0; overflow:hidden; }
.application-list .application-card { display:flex; align-items:center; gap:12px; padding:12px 18px; border-bottom:1px solid var(--border); }
.application-card.selected { background:var(--border); }
.application-select { display:flex; flex:1; gap:14px; align-items:center; text-align:left; min-width:0; background:none; border:0; color:inherit; padding:0; font:inherit; font-size:15px; cursor:pointer; }
.application-select span:last-child { overflow-wrap:anywhere; }
.application-icon { width:32px; height:32px; flex-shrink:0; object-fit:contain; }
.fallback-icon { border:1px solid var(--border); border-radius:8px; display:grid; place-items:center; font-size:17px; background:var(--background); }
.play-button { width:36px; height:30px; padding:0; flex-shrink:0; border-radius:16px; }
.application-toolbar { display:flex; align-items:center; padding:6px 12px; gap:0; }
.application-toolbar button { font-size:23px; line-height:1; padding:2px 10px; margin:0; }
.application-toolbar button + button { border-left:1px solid var(--border); border-radius:0; }
.empty-applications { padding:10px 18px; }
.launch-status { border:1px solid var(--border); border-radius:10px; padding:12px; margin:12px 0; }
.launch-status pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:180px; overflow:auto; }
header { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; }
label { display:grid; gap:6px; margin-top:12px; }
input, select { min-width:0; width:100%; box-sizing:border-box; padding:10px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:inherit; font:inherit; }
fieldset { border:0; padding:10px 0; display:flex; flex-wrap:wrap; gap:14px; }
fieldset label { display:flex; margin:0; align-items:center; }
fieldset input { width:auto; }
.http-form { margin-top:14px; }
</style>
