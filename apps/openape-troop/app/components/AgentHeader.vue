<script setup lang="ts">
import type { Agent, NestHost } from '../types/agent'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

// The agent page's sticky top bar: identity, the two badges that say how this
// agent is reached, and the pause switch. Pause is the only thing here that
// writes — the page keeps the one copy of the agent, so the new value goes up
// as an event instead of being assigned through the prop.
const props = defineProps<{ agentName: string, agent: Agent | null }>()
const emit = defineEmits<{ 'update:paused': [paused: boolean], 'error': [message: string] }>()

const { t } = useI18n()

// Live-nest indicator. Polls /api/nest/hosts every 30s. If any
// connected nest covers this owner's hosts, the agent is on a
// host that propagates config-updates over WS instead of the 5min
// poll. Pure UX surface — never gates any action.
const nestHosts = ref<NestHost[]>([])
let nestHostsTimer: ReturnType<typeof setInterval> | null = null
async function loadNestHosts() {
  try { nestHosts.value = await apiFetch('/api/nest/hosts') }
  catch { /* badge silently falls back to "offline" */ }
}
onMounted(() => {
  void loadNestHosts()
  nestHostsTimer = setInterval(loadNestHosts, 30_000)
})
onBeforeUnmount(() => { if (nestHostsTimer) clearInterval(nestHostsTimer) })

const nestOnline = computed(() => nestHosts.value.length > 0)
const nestLabel = computed(() => {
  if (!nestOnline.value) return t('agentDetail.nest.offlineLabel')
  const names = nestHosts.value.map(h => h.hostname).join(', ')
  return t('agentDetail.nest.onlineLabel', { names })
})

// Pause toggle. A paused agent stays enrolled but runs no LLM turns; resume is
// instant. State mirrors the nest registry via the agent's `paused` field.
const paused = computed(() => props.agent?.paused ?? false)
const pausing = ref(false)
async function togglePause() {
  if (!props.agent) return
  pausing.value = true
  try {
    const verb = paused.value ? 'resume' : 'pause'
    await apiFetch(`/api/agents/${props.agentName}/${verb}`, { method: 'POST' })
    emit('update:paused', !paused.value)
  }
  catch (err: any) {
    emit('error', err?.data?.statusMessage || err?.message || t('agentDetail.error.loadFailed'))
  }
  finally {
    pausing.value = false
  }
}
</script>

<template>
  <header class="border-b border-(--ui-border) px-3 sm:px-6 py-3 flex items-center gap-2 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
    <UButton to="/agents" variant="ghost" size="sm" icon="i-lucide-arrow-left" :ui="{ base: 'shrink-0' }">
      <span class="hidden sm:inline">{{ $t('agentDetail.backToAgents') }}</span>
    </UButton>
    <span v-if="agent" class="font-mono font-semibold truncate flex-1">
      🦍 {{ agent.agentName }}
    </span>
    <span
      v-if="agent && paused"
      class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap text-amber-300 bg-amber-500/10"
      :title="$t('agentDetail.pause.badgeTitle')"
    >
      ⏸ {{ $t('agentDetail.pause.badge') }}
    </span>
    <span
      class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
      :class="nestOnline ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-500 bg-zinc-800/50'"
      :title="nestLabel"
    >
      {{ nestOnline ? $t('agentDetail.nest.badgeLive') : $t('agentDetail.nest.badgePoll') }}
    </span>
    <UButton
      v-if="agent"
      :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
      :color="paused ? 'primary' : 'neutral'"
      variant="ghost"
      size="sm"
      :loading="pausing"
      :title="paused ? $t('agentDetail.pause.resumeTitle') : $t('agentDetail.pause.pauseTitle')"
      :ui="{ base: 'shrink-0' }"
      @click="togglePause"
    >
      <span class="hidden sm:inline">{{ paused ? $t('agentDetail.pause.resume') : $t('agentDetail.pause.pause') }}</span>
    </UButton>
    <LocaleSwitcher />
  </header>
</template>
