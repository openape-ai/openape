import { computed, onScopeDispose, ref } from 'vue'
import type { ChatMessage } from '../utils/cockpit/types'
import { createSseParser } from '../utils/cockpit/sse'
import { loadCockpitCompany, saveCockpitCompany } from '../utils/cockpit/store'

export interface Company { id: string, name: string, short: string, accent: string }
interface ServerMsg { id: string, role: 'user' | 'assistant', content: string, meta?: { taskId: string, options?: string[], answered?: boolean, progress?: boolean }, files?: { id: string, mime: string, name: string }[], createdAt: number }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const POLL_EVERY_MS = 2000
const POLL_MAX_MS = 5 * 60_000

let seq = 0
function makeId(): string { seq += 1; return `${Date.now()}-${seq}` }

export function useCockpitChat() {
  const { t, te } = useI18n()

  // The stream carries stable codes, not sentences, so an English session reads
  // English. A code this client does not know (older client, newer server) still
  // says something — the bubble is never left blank.
  function streamText(code: string): string {
    const key = `cockpit.chat.stream.${code}`
    return te(key) ? t(key) : t('cockpit.chat.streamFallback')
  }

  const messages = ref<ChatMessage[]>([])
  const isStreaming = ref(false)
  const companies = ref<Company[]>([])
  const currentCompanyId = ref('')
  const authRequired = ref(false)
  const currentCompany = computed(() => companies.value.find(c => c.id === currentCompanyId.value) ?? companies.value[0])
  let controller: AbortController | null = null
  let pollAbort = false

  // The conversation lives on the server — load it (so leaving and returning
  // shows everything, incl. answers that arrived while disconnected).
  async function loadFromServer(companyId: string): Promise<void> {
    try {
      const rows = await $fetch<ServerMsg[]>('/api/cockpit/messages', { query: { company: companyId } })
      messages.value = rows.map(m => ({ id: m.id, role: m.role, content: m.content, ask: m.meta?.progress ? undefined : (m.meta ? { taskId: m.meta.taskId, options: m.meta.options ?? [], answered: m.meta.answered } : undefined), progress: m.meta?.progress, files: m.files ?? undefined, createdAt: m.createdAt }))
    }
    catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 401) authRequired.value = true
    }
  }
  async function refresh(): Promise<void> {
    if (currentCompanyId.value && !isStreaming.value) await loadFromServer(currentCompanyId.value)
  }

  if (import.meta.client) {
    void (async () => {
      try {
        const list = await $fetch<Company[]>('/api/cockpit/companies')
        if (Array.isArray(list)) companies.value = list
      }
      catch (error) {
        if ((error as { statusCode?: number })?.statusCode === 401) authRequired.value = true
      }
      const saved = await loadCockpitCompany()
      currentCompanyId.value = saved && companies.value.some(c => c.id === saved)
        ? saved
        : (companies.value[0]?.id ?? '')
      if (currentCompanyId.value) await loadFromServer(currentCompanyId.value)
    })()
    // Returning to the tab re-syncs the conversation from the server.
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    onScopeDispose(() => window.removeEventListener('focus', onFocus))
  }

  async function selectCompany(id: string): Promise<void> {
    if (id === currentCompanyId.value || !companies.value.some(c => c.id === id)) return
    stop()
    currentCompanyId.value = id
    void saveCockpitCompany(id)
    await loadFromServer(id)
  }

  // The answer is persisted on the server; if the live stream drops or the Operator
  // is asleep, poll for it instead of showing a dead-end error.
  async function pollForAnswer(companyId: string, sinceMs: number): Promise<string | null> {
    const deadline = Date.now() + POLL_MAX_MS
    // eslint-disable-next-line no-unmodified-loop-condition -- pollAbort is flipped by stop()/selectCompany
    while (Date.now() < deadline && !pollAbort) {
      await sleep(POLL_EVERY_MS)
      if (pollAbort) break
      try {
        const rows = await $fetch<ServerMsg[]>('/api/cockpit/messages', { query: { company: companyId, since: sinceMs } })
        const ans = rows.find(m => m.role === 'assistant')
        if (ans) return ans.content
      }
      catch { /* transient — keep polling */ }
    }
    return null
  }

  // After a dropped stream, re-attach to the still-running task: resume its live
  // progress and pick up the answer when it completes. Returns when the task is
  // terminal, gone from memory (404 → caller polls the persisted answer), or the
  // window elapses. Same in-memory task the SSE stream was reading — no answer lost.
  async function reattachProgress(taskId: string, assistant: ChatMessage): Promise<void> {
    const deadline = Date.now() + POLL_MAX_MS
    // eslint-disable-next-line no-unmodified-loop-condition -- pollAbort is flipped by stop()/selectCompany
    while (Date.now() < deadline && !pollAbort) {
      let task: { state: string, progress: string[], answer: string }
      try { task = await apiFetch(`/api/cockpit/tasks/${taskId}/progress`) }
      catch (error) {
        // Only a 404 means the task left memory — then the caller falls back to
        // the messages poll. A 5xx or a dropped connection is transient: the task
        // still runs, so keep re-attaching until the window closes.
        if ((error as { statusCode?: number })?.statusCode === 404) return
        console.warn('[cockpit] reading task progress failed — retrying', error)
        await sleep(POLL_EVERY_MS)
        continue
      }
      assistant.thoughts = [...task.progress]
      assistant.waiting = assistant.waiting ?? t('cockpit.chat.reconnecting')
      if (task.state === 'completed' || task.state === 'failed') {
        if (task.answer.trim()) { assistant.content = task.answer; assistant.system = undefined; assistant.waiting = undefined }
        return
      }
      await sleep(POLL_EVERY_MS)
    }
  }

  async function send(text: string, files: { id: string, mime: string, name: string }[] = []): Promise<void> {
    // An attachment-only turn stays empty here and on the server — the bubble
    // renders the placeholder, so it follows the reader's language.
    const content = text.trim()
    if ((!content && !files.length) || isStreaming.value || !currentCompanyId.value) return
    const companyId = currentCompanyId.value
    const sinceMs = Date.now() - 1000
    messages.value.push({ id: makeId(), role: 'user', content, files: files.length ? files : undefined, createdAt: Date.now() })
    messages.value.push({ id: makeId(), role: 'assistant', content: '', createdAt: Date.now(), streaming: true, thoughts: [] })
    const assistant = messages.value.at(-1)!

    isStreaming.value = true
    controller = new AbortController()
    pollAbort = false
    let taskId = ''
    try {
      // Live overlay via SSE (best effort).
      try {
        const res = await fetch('/api/cockpit/message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            company: companyId,
            messages: messages.value.filter(m => !m.streaming).map(({ role, content: c }) => ({ role, content: c })),
            files: files.map(f => f.id),
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
            const ev = JSON.parse(payload) as { k?: string, t?: string, code?: string, text?: string, sec?: number, id?: string, options?: string[], taskId?: string }
            // `code` = one of our own states; `text` = free-form worker progress.
            const line = ev.code ? streamText(ev.code) : ev.text
            if (ev.k === 'id' && ev.id) { taskId = ev.id }
            else if (ev.k === 'tok' && ev.t) { assistant.content += ev.t; assistant.waiting = undefined; assistant.system = undefined }
            else if (ev.k === 'think' && line) { assistant.thoughts!.push(line); assistant.waiting = undefined }
            else if (ev.k === 'wait' && line) { assistant.waiting = ev.sec != null ? t('cockpit.chat.waitSeconds', { text: line, sec: ev.sec }) : line }
            else if (ev.k === 'offline' && ev.text) { assistant.system = ev.text; assistant.waiting = undefined }
            // The Operator paused on a question — the bubble settles into chips.
            else if (ev.k === 'ask' && ev.text) { assistant.content = ev.text; assistant.ask = { taskId: ev.taskId ?? taskId, options: ev.options ?? [] }; assistant.waiting = undefined; assistant.system = undefined }
          }
        }
      }
      catch (err) {
        if ((err as Error).name === 'AbortError') pollAbort = true
        // else: the connection dropped — the answer is persisted; we poll below.
      }

      // No real answer streamed (dropped / offline / asleep). First try to re-attach
      // to the live task (restores progress + the answer while it still runs); only
      // if it's gone from memory fall back to the persisted-answer poll.
      if (!assistant.content.trim() && !pollAbort) {
        if (!assistant.system) assistant.waiting = assistant.waiting ?? t('cockpit.chat.reconnecting')
        if (taskId) await reattachProgress(taskId, assistant)
        if (!assistant.content.trim() && !pollAbort) {
          const ans = await pollForAnswer(companyId, sinceMs)
          if (ans) { assistant.content = ans; assistant.system = undefined; assistant.waiting = undefined }
          else if (!assistant.system) {
            assistant.system = t('cockpit.chat.answerPending')
          }
        }
      }
    }
    catch (error) {
      console.error('[cockpit] send failed', error)
      assistant.system = t('cockpit.chat.sendFailed')
    }
    finally {
      assistant.streaming = false
      isStreaming.value = false
      controller = null
    }
  }

  // Chip tap: resume the SAME task with the choice. If the task is gone
  // (restart + prune) the choice degrades to a normal message carrying the
  // question as context — never a dead end.
  async function answer(msg: ChatMessage, choice: string): Promise<void> {
    if (!msg.ask || msg.ask.answered || isStreaming.value) return
    const ask = msg.ask
    ask.answered = true
    try {
      await $fetch(`/api/cockpit/tasks/${ask.taskId}/answer`, { method: 'POST', body: { choice } })
    }
    catch {
      await send(t('cockpit.chat.answerFallback', { question: msg.content, choice }))
      return
    }
    messages.value.push({ id: makeId(), role: 'user', content: choice, createdAt: Date.now() })
    const assistant: ChatMessage = { id: makeId(), role: 'assistant', content: '', createdAt: Date.now(), streaming: true, thoughts: [] }
    messages.value.push(assistant)
    isStreaming.value = true
    pollAbort = false
    try {
      await reattachProgress(ask.taskId, assistant)
      if (!assistant.content.trim() && !pollAbort) {
        const ans = await pollForAnswer(currentCompanyId.value, Date.now() - 1000)
        if (ans) assistant.content = ans
        else if (!assistant.system) assistant.system = t('cockpit.chat.answerPending')
      }
    }
    catch (error) {
      console.error('[cockpit] answering the question failed', error)
      assistant.system = t('cockpit.chat.choiceFailed')
    }
    finally {
      assistant.streaming = false
      isStreaming.value = false
    }
  }

  function stop(): void { controller?.abort(); pollAbort = true }
  async function clear(): Promise<void> {
    stop()
    messages.value = []
    if (currentCompanyId.value) {
      try { await $fetch('/api/cockpit/messages', { method: 'DELETE', query: { company: currentCompanyId.value } }) }
      catch { /* best effort */ }
    }
  }

  return { messages, isStreaming, companies, currentCompany, authRequired, selectCompany, send, answer, stop, clear, refresh }
}
