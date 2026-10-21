<script lang="ts">
import { defineComponent } from 'vue'
import type { AgentBackendStatus } from '../contracts/agent-status'
import type { ProxyCommand } from '../contracts/onboarding'
import { agentModelSizeLabels, agentThinkingLevels } from '../contracts/agent'
import { modelApiIds } from '../contracts/model-api'
import type { ModelApiEdit, ModelApiId } from '../contracts/model-api'
import { useHostBridge } from './host-bridge'
import { t, label, diagnostic } from './i18n'

function initial(id: ModelApiId): ModelApiEdit {
  return { enabled: false, baseUrl: 'http://127.0.0.1:8317/v1', format: id === 'openai' ? 'chat-completions' : 'messages', authentication: 'none', defaultThinking: 'medium' }
}
export default defineComponent({
  setup() { return { hostBridge: useHostBridge() } },
  data() { return { status: null as AgentBackendStatus | null, busy: false, error: '', ids: modelApiIds, levels: agentThinkingLevels, draft: { openai: initial('openai'), anthropic: initial('anthropic') }, replacing: { openai: false, anthropic: false } } },
  computed: { editable(): boolean { return this.hostBridge.modelApiSettings === true } },
  async mounted() { await this.execute({ type: 'proxyStatus' }, true) },
  beforeUnmount() { this.clearTokens() },
  methods: {
    t,
    label,
    diagnostic,
    size(value: keyof typeof agentModelSizeLabels) { return label(agentModelSizeLabels[value]) },
    connection(id: ModelApiId) { return this.status?.connections?.find(item => item.id === id) },
    changed(id: ModelApiId) {
      const saved = this.connection(id); const draft = this.draft[id]
      return !saved || !!draft.token || (['enabled', 'baseUrl', 'format', 'authentication', 'defaultThinking'] as const).some(key => saved[key] !== draft[key])
    },
    checkedTime(id: ModelApiId) { const at = this.connection(id)?.checkedAt; return at ? new Date(at).toLocaleTimeString() : '' },
    mappings(id: ModelApiId) { return this.status?.mappings.filter(item => item.provider === (id === 'openai' ? 'codex' : 'claude')) ?? [] },
    clearTokens() { for (const id of this.ids) { delete this.draft[id].token; this.replacing[id] = false } },
    async execute(command: ProxyCommand, reset = false) {
      this.busy = true; this.error = ''
      try {
        this.status = (await this.hostBridge.onboarding(command)).proxy ?? null
        if (reset) {
          this.clearTokens()
          for (const id of this.ids) {
            const value = this.connection(id)
            if (value) this.draft[id] = { enabled: value.enabled, baseUrl: value.baseUrl, format: value.format, authentication: value.authentication, defaultThinking: value.defaultThinking }
          }
        }
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Model API settings are unavailable' }
      finally { this.busy = false }
    },
    async save() {
      const connections = Object.fromEntries(this.ids.map((id) => {
        const { token, ...settings } = this.draft[id]
        return [id, { ...settings, ...(settings.authentication === 'token' && token ? { token } : {}) }]
      })) as Record<ModelApiId, ModelApiEdit>
      await this.execute({ type: 'saveModelApis', settings: { expectedHash: this.status?.hash ?? null, connections } }, true)
    },
  },
})
</script>

<template>
  <section class="proxy-connection" :aria-label="t('Model APIs')">
    <h3>{{ t('Model APIs') }}</h3>
    <p v-if="error || (status?.error && status.error.details.cause !== 'ENOENT')" class="error-message" role="alert">
      {{ diagnostic(error || status?.error?.message) }}
    </p>
    <form @submit.prevent="save">
      <fieldset v-for="id in ids" :key="id" :disabled="busy || !editable">
        <legend>{{ t(id === 'openai' ? 'OpenAI-compatible' : 'Anthropic-compatible') }}</legend>
        <label class="enable"><input v-model="draft[id].enabled" type="checkbox"> {{ t('Enabled') }}</label>
        <label v-if="id === 'openai'">{{ t('API format') }}
          <select v-model="draft[id].format"><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select>
        </label>
        <label>{{ t('Base URL') }}<input v-model="draft[id].baseUrl" type="url" required autocomplete="off" spellcheck="false"></label>
        <label>{{ t('Authentication') }}
          <select v-model="draft[id].authentication" @change="delete draft[id].token"><option value="none">{{ t('None') }}</option><option value="token">{{ t('API token') }}</option></select>
        </label>
        <div v-if="draft[id].authentication === 'token'">
          <label v-if="replacing[id] || !connection(id)?.hasToken">{{ t('API token') }}<input v-model="draft[id].token" type="password" autocomplete="new-password" spellcheck="false"></label>
          <div v-else class="token-state">
            <span aria-label="API token">••••••••</span><button type="button" class="secondary" @click="replacing[id] = true">
              {{ t('Replace') }}
            </button>
          </div>
        </div>
        <details>
          <summary>{{ t('Advanced') }}</summary>
          <label>{{ t('Thinking') }}<select v-model="draft[id].defaultThinking"><option v-for="level in levels" :key="level" :value="level">{{ level }}</option></select></label>
          <p v-for="mapping in mappings(id)" :key="mapping.modelSize">
            {{ size(mapping.modelSize) }} · <code>{{ mapping.modelId }}</code>
            <span v-if="mapping.error" class="error-message" role="alert"> · {{ diagnostic(mapping.error.message) }}</span>
          </p>
        </details>
        <p v-if="connection(id)?.error" class="error-message" role="alert">
          {{ diagnostic(connection(id)?.error?.message) }}
        </p>
        <p v-else-if="connection(id)?.checkedAt" role="status">
          {{ t('Catalog checked') }} · {{ checkedTime(id) }}
        </p>
        <button type="button" class="secondary" :disabled="!status?.configured || !draft[id].enabled || changed(id)" @click="execute({ type: 'checkModelApi', id })">
          {{ t('Check connection') }}
        </button>
      </fieldset>
      <div v-if="editable" class="proxy-actions">
        <button type="submit" class="primary" :disabled="busy">
          {{ t('Save') }}
        </button><button type="button" class="secondary" :disabled="busy" @click="execute({ type: 'reloadProxy' }, true)">
          {{ t('Reload configuration') }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.proxy-connection{border-top:1px solid var(--border);padding:16px 0;min-width:0;overflow-wrap:anywhere}.proxy-connection h3{margin:0 0 16px}.proxy-connection fieldset{border:1px solid var(--border);border-radius:10px;padding:16px;margin:0 0 16px;min-width:0}.proxy-connection legend{font-weight:600;padding:0 6px}.proxy-connection label{display:flex;flex-direction:column;gap:6px;margin:12px 0}.proxy-connection label.enable{flex-direction:row;align-items:center}.proxy-connection input:not([type=checkbox]),.proxy-connection select{width:100%;box-sizing:border-box;min-width:0;font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px}.proxy-connection p{margin:8px 0}.proxy-actions,.token-state{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}.proxy-connection code{white-space:normal;overflow-wrap:anywhere}.proxy-connection summary{cursor:pointer;margin:12px 0}
</style>
