<script lang="ts">
import { usePodAccess, trackPodEdits } from './pod-access'
import { variableDrafts } from './form-buffer'
import { defineComponent } from 'vue'
import { t, diagnostic } from './i18n'
import type { PodVariable } from '../contracts/resources'
import PodResources from './PodResources.vue'

export default defineComponent({
  components: { PodResources },
  props: { requestedSecret: { type: String, default: '' }, podId: { type: String, required: true } },
  setup() { const access = usePodAccess(); return { access, remoteRevision: access.revision } },
  data() { return { variables: [] as PodVariable[], requiredAliases: [] as string[], name: '', value: '', revision: 0, busy: false, error: '' } },
  watch: { remoteRevision() { if (!this.busy && !this.error) void this.load() } },
  async mounted() { const draft = variableDrafts.get(this.access.key(this.podId)); if (draft) Object.assign(this, draft); trackPodEdits(this.access, 'variables', () => !!this.name || !!this.value); await this.load() },
  beforeUnmount() { variableDrafts.set(this.access.key(this.podId), { name: this.name, value: this.value, revision: this.revision }) },
  methods: {
    t, diagnostic,
    async load() {
      try {
        const [resources, script] = await Promise.all([this.access.api.resources({ type: 'list', podId: this.podId }), this.access.api.scripts({ type: 'list', podId: this.podId })])
        this.variables = resources.variables ?? []
        const scriptAliases = script.source?.capabilities.filter(item => item.startsWith('credential.')).map(item => item.slice(11)) ?? []
        this.requiredAliases = [...new Set(scriptAliases)]
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not load variables' }
    },
    edit(variable: PodVariable) { this.name = variable.name; this.value = variable.value; this.revision = variable.revision },
    reset() { this.name = ''; this.value = ''; this.revision = 0 },
    async save() {
      this.busy = true; this.error = ''
      try { await this.access.api.resources({ type: 'saveVariable', podId: this.podId, name: this.name, value: this.value, revision: this.revision }); this.reset(); await this.load() }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not save variable' }
      finally { this.busy = false }
    },
    async remove(variable: PodVariable) {
      this.busy = true; this.error = ''
      try { await this.access.api.resources({ type: 'removeVariable', podId: this.podId, name: variable.name, revision: variable.revision }); await this.load() }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not delete variable' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <section id="pod-values" :aria-label="t('Variables and secrets')">
    <article class="card">
      <h2>{{ t('Variables') }}</h2><p class="muted">
        {{ t('These values are visible to the pod assistant. Changes apply to future runs. Store sensitive values as secrets below.') }}
      </p>
      <div v-for="variable in variables" :key="variable.name" class="value-row">
        <div>
          <strong>{{ variable.name }}</strong><p v-if="variable.value">
            {{ variable.value }}
          </p><p v-else class="muted">
            {{ t('Not set') }}
          </p><code>{{ `context.variables[${JSON.stringify(variable.name)}]` }}</code>
        </div>
        <button class="text-button" :disabled="busy" @click="edit(variable)">
          {{ t('Edit') }}
        </button><button class="text-button" :disabled="busy" @click="remove(variable)">
          {{ t('Delete variable') }}
        </button>
      </div>
      <form @submit.prevent="save">
        <label>{{ t('Variable name') }}<input v-model="name" :readonly="revision > 0" :disabled="busy" required pattern="[a-z][a-z0-9_-]{0,63}" maxlength="64"></label>
        <label>{{ t('Variable value') }}<input v-model="value" :disabled="busy" maxlength="2048"></label>
        <button class="secondary" :disabled="busy || !name">
          {{ t('Save variable') }}
        </button><button v-if="revision" class="text-button" type="button" @click="reset">
          {{ t('Cancel') }}
        </button>
      </form><p v-if="error" class="error-message" role="alert">
        {{ diagnostic(error) }}
      </p>
    </article>
    <PodResources :selected-pod-id="podId" mode="values" :required-aliases="requiredAliases" :requested-secret="requestedSecret" />
  </section>
</template>

<style scoped>
section { display:grid; gap:20px; } form,label { display:grid; gap:8px; } form { margin-top:20px; } input { width:100%;min-width:0;padding:10px;font:inherit;color:inherit;background:transparent;border:1px solid var(--border);border-radius:8px; } form button { justify-self:start; }.value-row { display:flex;flex-wrap:wrap;gap:14px;align-items:center;border-bottom:1px solid var(--border);padding:14px 0; }.value-row>div { flex:1 1 260px;min-width:0;overflow-wrap:anywhere; }
</style>
