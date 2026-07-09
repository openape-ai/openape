import { onScopeDispose, ref } from 'vue'

// Poll whether this owner's reactive CEO brain is connected, so the header can
// show real-vs-mock. Cheap GET; 5s cadence is plenty for a status dot.
export function useCockpitPresence() {
  const connected = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined

  async function refresh(): Promise<void> {
    try { connected.value = (await $fetch<{ connected: boolean }>('/api/cockpit/status')).connected }
    catch { connected.value = false }
  }
  function start(): void {
    if (timer) return
    void refresh()
    timer = setInterval(() => void refresh(), 5000)
  }
  onScopeDispose(() => { if (timer) clearInterval(timer) })
  return { connected, start, refresh }
}
