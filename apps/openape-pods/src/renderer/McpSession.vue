<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { McpSessionView } from '../contracts/mcp-session'
import { diagnostic, t, time } from './i18n'
import CodexPanel from './CodexPanel.vue'

const state = ref<McpSessionView | null>(null)
const busy = ref(false)
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false
async function load() {
  try {
    if (!busy.value) {
      const value = await window.pods.mcpSession({ type: 'get' })
      if (!closed && !busy.value) state.value = value
    }
  }
  catch (cause) { error.value = String(cause) }
  if (!closed) timer = setTimeout(() => { void load() }, 1000)
}
async function end() {
  busy.value = true; error.value = ''
  try { state.value = await window.pods.mcpSession({ type: 'end' }) }
  catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
onMounted(load)
onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
</script>

<template>
  <section class="card mcp-session" :aria-label="t('MCP access')">
    <h2>{{ t('MCP access') }}</h2>
    <p class="muted">
      {{ t('Codex signs in with your DDISA account and receives full Pods access for one hour. Grants stay at your identity provider.') }}
    </p>
    <p v-if="state" role="status">
      {{ state.expiresAt ? t('Codex signed in until {time}', { time: time(state.expiresAt) }) : state.pending ? t('Sign-in waiting for you in the browser') : t('Codex not signed in') }}
    </p>
    <div v-if="state?.expiresAt || state?.pending">
      <button class="secondary" :disabled="busy" @click="end">
        {{ t('End session') }}
      </button>
    </div>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <details><summary>{{ t('Connect Codex') }}</summary><CodexPanel /></details>
  </section>
</template>

<style scoped>
.mcp-session{display:grid;gap:14px}.mcp-session p{margin:0}summary{cursor:pointer;color:var(--muted)}
</style>
