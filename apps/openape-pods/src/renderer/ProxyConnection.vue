<script lang="ts">
import { defineComponent } from 'vue'
import type { AgentBackendStatus } from '../contracts/agent-status'
import type { ProxyCommand } from '../contracts/onboarding'
import { agentModelSizeLabels } from '../contracts/agent'
import { useHostBridge } from './host-bridge'
import { t, label, diagnostic } from './i18n'

export default defineComponent({
  setup() { return { hostBridge: useHostBridge() } },
  data() { return { status: null as AgentBackendStatus | null, busy: false, error: '' } },
  async mounted() { await this.execute('proxyStatus') },
  methods: {
    t,
    label,
    diagnostic,
    size(value: keyof typeof agentModelSizeLabels) { return label(agentModelSizeLabels[value]) },
    async execute(type: ProxyCommand['type']) {
      this.busy = true; this.error = ''
      try { this.status = (await this.hostBridge.onboarding({ type })).proxy ?? null }
      catch (error) { this.error = error instanceof Error ? error.message : 'Proxy status is unavailable' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <section class="proxy-connection" :aria-label="t('CLIProxyAPI')">
    <h3>{{ t('CLIProxyAPI') }}</h3>
    <p class="muted">
      {{ t('Text calls with Claude or Codex. Configure model mappings in the local agent-backends.json file.') }}
    </p>
    <p v-if="status" role="status">
      {{ !status.configured ? t('Not configured') : !status.enabled ? t('Disabled') : status.available ? t('Configured and enabled') : t('Unavailable') }}
    </p>
    <p v-else-if="!error" role="status">
      {{ t('loading…') }}
    </p>
    <p v-if="error || status?.error" class="error-message" role="alert">
      {{ diagnostic(error || status?.error?.message) }}
    </p>
    <details v-if="status?.mappings.length">
      <summary>{{ t('Model mappings') }}</summary>
      <p v-for="mapping in status.mappings" :key="`${mapping.provider}:${mapping.modelSize}`">
        {{ mapping.provider === 'claude' ? 'Claude' : 'Codex' }} · {{ size(mapping.modelSize) }} · <code>{{ mapping.modelId }}</code><span v-if="!mapping.enabled"> · {{ t('Disabled') }}</span>
      </p>
      <p class="muted">
        {{ t('Configuration revision') }}: {{ status.revision }}
      </p>
    </details>
    <div class="proxy-actions">
      <button class="secondary" :disabled="busy" @click="execute('reloadProxy')">
        {{ t('Reload configuration') }}
      </button>
      <button class="secondary" :disabled="busy || !status?.enabled" @click="execute('disableProxy')">
        {{ t('Disable proxy') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.proxy-connection{border-top:1px solid var(--border);padding:16px 0;min-width:0;overflow-wrap:anywhere}.proxy-connection h3{margin:0}.proxy-connection p{margin:8px 0}.proxy-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.proxy-connection code{white-space:normal;overflow-wrap:anywhere}.proxy-connection summary{cursor:pointer}
</style>
