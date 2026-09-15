<script lang="ts">
import { defineComponent, defineAsyncComponent } from 'vue'
import type { ResourceState, PodResource } from '../contracts/resources'
import type { ProgramCommand } from '../contracts/programs'
import { t, diagnostic } from './i18n'
import ScriptAccess from './ScriptAccess.vue'

const PodConsole = defineAsyncComponent(() => import('./PodConsole.vue'))

export default defineComponent({
  components: { PodConsole, ScriptAccess },
  props: { podId: { type: String, required: true }, state: { type: Object as () => ResourceState, required: true } },
  emits: ['updated'],
  data() { return { terminalId: '', busy: false, error: '', source: 'o365-cli' as 'o365-cli' | 'choose', origin: '', methods: ['GET'] as string[] } },
  computed: {
    applications() { return this.state.resources.filter(item => item.state !== 'revoked' && item.configuration.type === 'program') },
    destinations() { return this.state.resources.filter(item => item.state !== 'revoked' && item.configuration.type === 'http') },
  },
  methods: {
    t, diagnostic,
    async act(command: ProgramCommand) {
      this.busy = true; this.error = ''
      try {
        const result = await window.pods.programs(command)
        this.$emit('updated', result)
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Application operation failed' }
      finally { this.busy = false }
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
    <h3>{{ t('Executable applications') }}</h3>
    <p class="muted">
      {{ t('Assign a program and open the pod terminal to configure it. Authentication is managed by the program itself.') }}
    </p>
    <article v-for="application in applications" :key="application.id" class="application-card">
      <header>
        <strong>{{ application.name }}</strong><button class="secondary" :aria-expanded="terminalId === application.id" :disabled="busy || !!terminalId" @click="terminalId = application.id">
          {{ t('Open terminal') }}
        </button><button class="text-button" :disabled="busy || !!terminalId" @click="revoke(application)">
          {{ t('Remove application') }}
        </button>
      </header>
      <p class="resource-path">
        {{ application.configuration.executable }}
      </p>
      <details>
        <summary>{{ t('Allowed commands') }}</summary>
        <p v-if="!(application.configuration.grants as unknown[])?.length">
          {{ t('No commands allowed yet.') }}
        </p>
        <ul>
          <li v-for="grant in (application.configuration.grants as { permission: string, display: string }[])" :key="grant.permission">
            {{ grant.display }}
          </li>
        </ul>
      </details>
      <details class="script-reference">
        <summary>{{ t('Use in script') }}</summary>
        <code>{{ `context.tools.invoke({ application: ${JSON.stringify(application.name)}, argv: [...] })` }}</code>
      </details>
      <button class="text-button" :disabled="busy || !!terminalId" @click="act({ type: 'importState', podId, applicationId: application.id, epoch: state.epoch })">
        {{ t('Import existing setup') }}
      </button>
      <PodConsole v-if="terminalId === application.id" :pod-id="podId" :application="String(application.configuration.cliId)" @updated="$emit('updated', $event)" @closed="terminalId = ''" />
    </article>
    <form class="actions" @submit.prevent="act({ type: 'add', podId, epoch: state.epoch, source })">
      <select v-model="source" :aria-label="t('Application source')" :disabled="busy || !!terminalId">
        <option value="o365-cli">
          {{ t('o365-cli') }}
        </option><option value="choose">
          {{ t('Choose installed CLI…') }}
        </option>
      </select>
      <button :disabled="busy || !!terminalId">
        {{ t('Add application') }}
      </button>
    </form>
    <ScriptAccess :key="state.epoch" :pod-id="podId" kind="tools" />
    <h3>{{ t('HTTP destinations') }}</h3>
    <p class="muted">
      {{ t('Node.js scripts can request these HTTPS destinations. Store API tokens under Variables and secrets.') }}
    </p>
    <article v-for="destination in destinations" :key="destination.id" class="application-card">
      <header>
        <strong>{{ destination.name }}</strong><button class="text-button" :disabled="busy || !!terminalId" @click="revoke(destination)">
          {{ t('Revoke access') }}
        </button>
      </header>
      <p>{{ (destination.configuration.methods as string[]).join(', ') }}</p>
    </article>
    <form class="http-form" @submit.prevent="grantHttp">
      <label>{{ t('HTTPS origin') }}<input v-model="origin" type="url" required :placeholder="t('https://api.example.com')" :disabled="busy || !!terminalId"></label>
      <fieldset><legend>{{ t('Allowed methods') }}</legend><label v-for="method in ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']" :key="method"><input v-model="methods" type="checkbox" :value="method" :disabled="busy || !!terminalId">{{ method }}</label></fieldset>
      <button :disabled="busy || !!terminalId || !methods.length">
        {{ t('Allow HTTP destination') }}
      </button>
    </form>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
  </section>
</template>

<style scoped>
.program-permissions { margin-top:28px; border-top:1px solid var(--border); padding-top:16px; }
.application-card { border:1px solid var(--border); border-radius:12px; padding:16px; margin:12px 0; }
header, .actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; }
.actions { justify-content:flex-start; margin-top:12px; }
label { display:grid; gap:6px; margin-top:12px; }
input, select { min-width:0; width:100%; box-sizing:border-box; padding:10px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:inherit; font:inherit; }
.actions select { width:auto; }
fieldset { border:0; padding:10px 0; display:flex; flex-wrap:wrap; gap:14px; }
fieldset label { display:flex; margin:0; align-items:center; }
fieldset input { width:auto; }
.script-reference code { display:block; overflow-wrap:anywhere; padding:10px 0; user-select:all; }
.resource-path { overflow-wrap:anywhere; font-size:12px; opacity:.7; }
.http-form { margin-top:14px; }
</style>
