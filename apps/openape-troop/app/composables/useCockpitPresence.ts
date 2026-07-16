import { computed, onScopeDispose, ref } from 'vue'

export type AgentMode = 'offline' | 'idle' | 'active' | 'working'

// Poll the owner's Operator brain state so the header shows the real mode (and, when
// idle, a live countdown to the next check-in). Cheap GET every 5s; the countdown
// ticks locally each second between fetches.
export function useCockpitPresence() {
  const mode = ref<AgentMode>('offline')
  const nextPollInSec = ref<number | null>(null)
  let poll: ReturnType<typeof setInterval> | undefined
  let tick: ReturnType<typeof setInterval> | undefined

  async function refresh(): Promise<void> {
    try {
      const s = await $fetch<{ mode: AgentMode, nextPollInSec: number | null }>('/api/cockpit/status')
      mode.value = s.mode
      nextPollInSec.value = s.nextPollInSec
    }
    catch { mode.value = 'offline'; nextPollInSec.value = null }
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
      case 'active': return 'Operator live'
      case 'working': return 'Operator arbeitet'
      case 'idle': return nextPollInSec.value != null ? `Ruhemodus · ${nextPollInSec.value}s` : 'Ruhemodus'
      default: return 'Operator offline'
    }
  })
  const title = computed(() => {
    switch (mode.value) {
      case 'active': return 'Operator verbunden und wach — Antworten kommen sofort'
      case 'working': return 'Operator arbeitet gerade an einer Aufgabe'
      case 'idle': return 'Operator im Ruhemodus — deine Frage wird beim nächsten Check-in beantwortet'
      default: return 'Kein Operator-Loop verbunden — Fragen bleiben unbeantwortet, bis er läuft'
    }
  })

  onScopeDispose(() => { if (poll) clearInterval(poll); if (tick) clearInterval(tick) })
  return { mode, nextPollInSec, label, title, start, refresh }
}
