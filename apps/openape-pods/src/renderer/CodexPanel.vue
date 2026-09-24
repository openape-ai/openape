<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CodexConnection } from '../contracts/codex'
import { t, diagnostic } from './i18n'

const emit = defineEmits<{ changed: [connection: CodexConnection] }>()
const connection = ref<CodexConnection | null>(null); const busy = ref(false); const error = ref('')
const states = {
  connected: 'Connected. Restart Codex once so it loads OpenApe Pods.',
  disconnected: 'Not connected.',
  foreign: 'Codex already has another server named openape-pods. It was left unchanged.',
  edited: 'The entry was changed in Codex, so the app leaves it alone. Remove it in a terminal with:',
} as const
async function request(type: 'status' | 'connect' | 'disconnect'): Promise<void> {
  busy.value = true; error.value = ''
  try { connection.value = await window.pods.codex({ type }); emit('changed', connection.value) }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Codex request failed' }
  finally { busy.value = false }
}
onMounted(() => request('status'))
</script>

<template>
  <section class="codex-settings" :aria-label="t('Work from Codex')">
    <h3>{{ t('Work from Codex') }}</h3>
    <p class="muted">
      {{ t('Connected Codex can administer your Pods, assign permissions, activate scripts, enable schedules and start runs directly. Any confirmation follows your Codex settings. Conversations stay in Codex.') }}
    </p>
    <template v-if="connection">
      <p role="status">
        {{ t(states[connection.state]) }}
      </p>
      <code v-if="connection.state === 'edited'">{{ connection.manual }}</code>
      <p class="muted codex-home">
        {{ t('Codex configuration: {p0}', { p0: `${connection.home}/config.toml` }) }}
      </p>
      <div class="overview-actions">
        <button v-if="connection.state === 'disconnected'" class="secondary" :disabled="busy" @click="request('connect')">
          {{ t('Connect Codex') }}
        </button><button v-if="connection.state === 'connected'" class="secondary" :disabled="busy" @click="request('disconnect')">
          {{ t('Disconnect Codex') }}
        </button>
      </div>
    </template>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
  </section>
</template>

<style scoped>
.codex-settings { margin-top:24px; }
.codex-home { overflow-wrap:anywhere; }
</style>
