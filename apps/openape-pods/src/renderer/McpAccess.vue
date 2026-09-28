<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { McpAccess, McpDuration, McpMode } from '../contracts/mcp-access'
import { dateTime, diagnostic, t } from './i18n'
import CodexPanel from './CodexPanel.vue'

const state = ref<McpAccess | null>(null)
const busy = ref(false)
const error = ref('')
const modes = [['off', 'Off'], ['read', 'Read-only'], ['write', 'Read and write']] as const
const durations = [['hour', '1 hour'], ['day', '1 day'], ['permanent', 'Permanently']] as const
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false
let request = 0
async function load() {
  const token = request
  try {
    if (!busy.value) {
      const value = await window.pods.mcpAccess({ type: 'get' })
      if (token === request && !closed) state.value = value
    }
  }
  catch (cause) { error.value = String(cause) }
  if (!closed) timer = setTimeout(() => { void load() }, 1000)
}
async function update(mode: McpMode, duration: McpDuration) {
  if (busy.value) return
  request++; busy.value = true; error.value = ''
  try { state.value = await window.pods.mcpAccess({ type: 'set', mode, duration }) }
  catch (cause) { error.value = String(cause); state.value = null }
  finally { busy.value = false }
}
onMounted(load)
onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
</script>

<template>
  <section class="card mcp-access" :aria-label="t('MCP access')">
    <h2>{{ t('MCP access') }}</h2>
    <p class="muted">
      {{ t('One access level for the entire app. Active access starts MCP automatically.') }}
    </p>
    <div class="mcp-levels" role="group" :aria-label="t('MCP access')">
      <button v-for="[mode, title] in modes" :key="mode" :disabled="busy || !state" :aria-pressed="state?.mode === mode" @click="update(mode, state!.duration)">
        {{ t(title) }}
      </button>
    </div>
    <p v-if="state" role="status">
      {{ state.mode === 'off' ? t('MCP is stopped. Agents cannot access Pods.') : state.mode === 'read' ? t('MCP is running. Agents can inspect Pods; changes and runs are blocked.') : t('MCP is running. Agents can change Pods and start runs.') }}
    </p>
    <div v-if="state" class="mcp-duration" role="group" :aria-label="t('Access duration')">
      <span>{{ t('Access duration') }}</span><button v-for="[duration, title] in durations" :key="duration" class="secondary" :disabled="busy" :aria-pressed="state.duration === duration" @click="update(state!.mode, duration)">
        {{ t(title) }}
      </button>
    </div>
    <p v-if="state?.expiresAt" class="muted">
      {{ t('Access ends at {time}. Then MCP switches off.', { time: dateTime(state.expiresAt) }) }}
    </p>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <details><summary>{{ t('Connect Codex') }}</summary><CodexPanel /></details>
  </section>
</template>

<style scoped>
.mcp-access{display:grid;gap:14px}.mcp-access p{margin:0}.mcp-levels{display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:var(--bg);border-radius:8px}.mcp-levels button{flex:1 1 110px;padding:11px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}.mcp-levels [aria-pressed=true],.mcp-duration [aria-pressed=true]{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}.mcp-duration{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.mcp-duration>span{margin-right:10px;color:var(--muted)}summary{cursor:pointer;color:var(--muted)}
</style>
