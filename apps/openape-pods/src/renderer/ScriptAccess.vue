<script lang="ts">
import { defineComponent } from 'vue'
import type { ScriptView } from '../contracts/scripts'
import { isDirty, scriptBuffer } from './script-buffer'
import { t, diagnostic } from './i18n'

export default defineComponent({
  props: { podId: { type: String, required: true }, kind: { type: String, required: true } },
  data() { return { view: null as ScriptView | null, choices: [] as { capability: string, name: string }[], selected: [] as string[], busy: false, error: '', saved: false } },
  computed: {
    changed(): boolean { return JSON.stringify([...this.selected].sort()) !== JSON.stringify((this.view?.source?.capabilities.filter(this.matches) ?? []).sort()) },
  },
  async mounted() { await this.load() },
  methods: {
    t, diagnostic,
    matches(capability: string) { return capability.startsWith('credential.') === (this.kind === 'secrets') },
    async load() {
      try {
        const [view, resources] = await Promise.all([window.pods.scripts({ type: 'list', podId: this.podId }), window.pods.resources({ type: 'list', podId: this.podId })])
        this.view = view; this.selected = view.source?.capabilities.filter(this.matches) ?? []
        const assigned = resources.resources.flatMap((resource) => {
          const capability = resource.kind === 'credential' ? `credential.${resource.name}` : resource.configuration.capability
          return typeof capability === 'string' && this.matches(capability) && resource.state === 'ready' ? [{ capability, name: resource.name }] : []
        })
        this.choices = [...assigned, ...this.selected.filter(capability => !assigned.some(item => item.capability === capability)).map(capability => ({ capability, name: capability.replace(/^credential\./, '') }))]
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not load script access' }
    },
    async save() {
      const view = this.view; const source = view?.source
      if (!view || !source || this.busy) return
      this.error = ''; this.saved = false
      if (isDirty(scriptBuffer(this.podId))) { this.error = 'Save your script editor changes first'; return }
      this.busy = true
      try {
        const next = await window.pods.scripts({ type: 'save', podId: this.podId, revision: view.pod.revision, draftId: source.kind === 'draft' ? source.id : null, draftRevision: source.kind === 'draft' ? source.revision : 0, code: source.code, capabilities: [...source.capabilities.filter(capability => !this.matches(capability)), ...this.selected] })
        this.view = next; this.saved = true
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not save script access' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <section v-if="view?.source && choices.length" class="script-access">
    <h3>{{ t(kind === 'secrets' ? 'Secrets used by the script' : 'Applications used by the script') }}</h3>
    <p class="muted">
      {{ t('Select what the saved script may use. Changes require a new script check; existing access approvals remain mandatory.') }}
    </p>
    <label v-for="choice in choices" :key="choice.capability"><input v-model="selected" type="checkbox" :value="choice.capability" :disabled="busy || view.pod.lifecycle === 'archived'">{{ choice.name }}</label>
    <button :disabled="busy || !changed || view.pod.lifecycle === 'archived'" @click="save">
      {{ t('Save script access') }}
    </button>
    <p v-if="saved && !changed" role="status">
      {{ t('Script access saved') }}
    </p>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
  </section>
  <p v-else-if="error" role="alert" class="error-message">
    {{ diagnostic(error) }}
  </p>
</template>

<style scoped>
.script-access { margin-top:20px; }label { display:flex;gap:10px;align-items:center;margin:12px 0;overflow-wrap:anywhere; }input { flex-shrink:0; }button { margin-top:12px; }
</style>
