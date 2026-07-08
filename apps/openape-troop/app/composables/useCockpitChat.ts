import { ref, computed } from 'vue'
import type { ChatMessage } from '../utils/cockpit/types'
import { createSseParser } from '../utils/cockpit/sse'
import { loadCockpitHistory, saveCockpitHistory, loadCockpitCompany, saveCockpitCompany } from '../utils/cockpit/store'

export interface Company { id: string; name: string; short: string; accent: string }

let seq = 0
function makeId(): string { seq += 1; return `${Date.now()}-${seq}` }

export function useCockpitChat() {
  const messages = ref<ChatMessage[]>([])
  const isStreaming = ref(false)
  const companies = ref<Company[]>([])
  const currentCompanyId = ref('')
  const currentCompany = computed(() => companies.value.find(c => c.id === currentCompanyId.value) ?? companies.value[0])
  let controller: AbortController | null = null

  if (import.meta.client) {
    void (async () => {
      try {
        const list = await $fetch<Company[]>('/api/cockpit/companies')
        if (Array.isArray(list)) companies.value = list
      }
      catch { /* not logged in / no orgs */ }
      const saved = await loadCockpitCompany()
      currentCompanyId.value = saved && companies.value.some(c => c.id === saved)
        ? saved
        : (companies.value[0]?.id ?? '')
      if (currentCompanyId.value) messages.value = await loadCockpitHistory(currentCompanyId.value)
    })()
  }

  async function selectCompany(id: string): Promise<void> {
    if (id === currentCompanyId.value || !companies.value.some(c => c.id === id)) return
    stop()
    currentCompanyId.value = id
    void saveCockpitCompany(id)
    messages.value = await loadCockpitHistory(id)
  }

  async function send(text: string): Promise<void> {
    const content = text.trim()
    if (!content || isStreaming.value || !currentCompanyId.value) return
    const companyId = currentCompanyId.value
    messages.value.push({ id: makeId(), role: 'user', content })
    messages.value.push({ id: makeId(), role: 'assistant', content: '', streaming: true, thoughts: [] })
    const assistant = messages.value.at(-1)!
    void saveCockpitHistory(companyId, messages.value)

    isStreaming.value = true
    controller = new AbortController()
    try {
      const res = await fetch('/api/cockpit/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          company: companyId,
          messages: messages.value.filter(m => !m.streaming).map(({ role, content: c }) => ({ role, content: c })),
        }),
        signal: controller.signal,
      })
      if (!res.body) throw new Error('no response stream')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const parse = createSseParser()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (const payload of parse(decoder.decode(value, { stream: true }))) {
          if (payload === '[DONE]') continue
          const ev = JSON.parse(payload) as { k?: string; t?: string; text?: string }
          if (ev.k === 'think' && ev.text) assistant.thoughts!.push(ev.text)
          else if (ev.k === 'tok' && ev.t) assistant.content += ev.t
        }
      }
    }
    catch (err) {
      if ((err as Error).name !== 'AbortError') {
        assistant.content += assistant.content ? '\n\n_(Verbindung unterbrochen.)_' : '_(Verbindung unterbrochen.)_'
      }
    }
    finally {
      assistant.streaming = false
      isStreaming.value = false
      controller = null
      void saveCockpitHistory(companyId, messages.value)
    }
  }

  function stop(): void { controller?.abort() }
  function clear(): void {
    stop()
    messages.value = []
    if (currentCompanyId.value) void saveCockpitHistory(currentCompanyId.value, [])
  }

  return { messages, isStreaming, companies, currentCompany, selectCompany, send, stop, clear }
}
