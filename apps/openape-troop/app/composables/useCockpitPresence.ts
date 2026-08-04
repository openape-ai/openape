import { computed, onScopeDispose, ref } from 'vue'

export type AgentMode = 'offline' | 'disconnected' | 'unauthenticated' | 'idle' | 'active' | 'working'

export function presenceErrorMode(error: unknown): 'unauthenticated' | 'disconnected' {
  return (error as { statusCode?: number })?.statusCode === 401 ? 'unauthenticated' : 'disconnected'
}

// Poll the owner's Operator brain state so the header shows the real mode (and, when
// idle, a live countdown to the next check-in). Cheap GET every 5s; the countdown
// ticks locally each second between fetches.
export function useCockpitPresence(company?: () => string) {
  const { t } = useI18n()
  const mode = ref<AgentMode>('offline')
  const nextPollInSec = ref<number | null>(null)
  const missingTools = ref<string[]>([])
  let poll: ReturnType<typeof setInterval> | undefined
  let tick: ReturnType<typeof setInterval> | undefined

  async function refresh(): Promise<void> {
    try {
      const s = await $fetch<{ mode: AgentMode, nextPollInSec: number | null, missingTools?: string[] }>('/api/cockpit/status', { query: company?.() ? { company: company() } : undefined })
      mode.value = s.mode
      nextPollInSec.value = s.nextPollInSec
      missingTools.value = s.missingTools ?? []
    }
    catch (error) { mode.value = presenceErrorMode(error); nextPollInSec.value = null }
  }
  function start(): void {
    if (poll) return
    void refresh()
    poll = setInterval(() => void refresh(), 5000)
    tick = setInterval(() => {
      if (mode.value === 'idle' && nextPollInSec.value != null && nextPollInSec.value > 0) nextPollInSec.value -= 1
    }, 1000)
  }

  const label = computed(() => {
    switch (mode.value) {
      case 'active': return t('cockpit.presence.label.active')
      case 'working': return t('cockpit.presence.label.working')
      case 'idle': return nextPollInSec.value != null
        ? t('cockpit.presence.label.idleCountdown', { seconds: nextPollInSec.value })
        : t('cockpit.presence.label.idle')
      case 'unauthenticated': return t('cockpit.presence.label.unauthenticated')
      case 'disconnected': return t('cockpit.presence.label.disconnected')
      default: return t('cockpit.presence.label.offline')
    }
  })
  const title = computed(() => {
    switch (mode.value) {
      case 'active': return t('cockpit.presence.title.active')
      case 'working': return t('cockpit.presence.title.working')
      case 'idle': return t('cockpit.presence.title.idle')
      case 'unauthenticated': return t('cockpit.presence.title.unauthenticated')
      case 'disconnected': return t('cockpit.presence.title.disconnected')
      default: return t('cockpit.presence.title.offline')
    }
  })

  onScopeDispose(() => { if (poll) clearInterval(poll); if (tick) clearInterval(tick) })
  return { mode, nextPollInSec, missingTools, label, title, start, refresh }
}
