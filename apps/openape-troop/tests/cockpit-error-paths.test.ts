// @vitest-environment happy-dom
import type { ChatMessage } from '../app/utils/cockpit/types'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import CockpitComposer from '../app/components/cockpit/CockpitComposer.vue'
import { useCockpitChat } from '../app/composables/useCockpitChat'
import de from '../i18n/locales/de.json'

// idb-keyval needs a real IndexedDB; the selected company is not what these
// tests are about.
vi.mock('../app/utils/cockpit/store', () => ({
  loadCockpitCompany: async () => undefined,
  saveCockpitCompany: async () => {},
}))

const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de } })
vi.stubGlobal('useI18n', () => i18n.global)

const apiFetch = vi.fn()
const apiPost = vi.fn()
vi.stubGlobal('apiFetch', apiFetch)
vi.stubGlobal('$fetch', apiPost)

function sseStream(...events: string[]): { body: ReadableStream<Uint8Array> } {
  const encoder = new TextEncoder()
  return {
    body: new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(`data: ${event}\n\n`))
        controller.close()
      },
    }),
  }
}

async function chatOnCompany() {
  const chat = useCockpitChat()
  chat.companies.value.push({ id: 'c1', name: 'Delta Mind', short: 'DM', accent: '#6d5efc' })
  apiPost.mockResolvedValueOnce([])
  await chat.selectCompany('c1')
  return chat
}

beforeEach(() => {
  apiFetch.mockReset()
  apiPost.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// The progress endpoint answering 200 with a body that is not shaped like a
// progress record (deploy skew, a proxy's error page) throws inside the send
// flow. Before the fix that rejection escaped `send()` unhandled: the bubble
// just stopped streaming and stayed blank.
describe('cockpit send', () => {
  it('shows a system notice when the task re-attach blows up', async () => {
    const chat = await chatOnCompany()
    vi.stubGlobal('fetch', vi.fn(async () => sseStream('{"k":"id","id":"task-1"}')))
    apiFetch.mockResolvedValue({ state: 'running', answer: '' })

    await chat.send('Wie ist der Stand?')

    const assistant = chat.messages.value.at(-1)!
    expect(assistant.system).toBe('Die Nachricht konnte nicht zu Ende verarbeitet werden — Details stehen in der Browser-Konsole.')
    expect(assistant.streaming).toBe(false)
    expect(chat.isStreaming.value).toBe(false)
  })
})

describe('cockpit answer', () => {
  it('shows a system notice when resuming the task blows up', async () => {
    const chat = await chatOnCompany()
    chat.messages.value.push({ id: 'm1', role: 'assistant', content: 'Deployen?', ask: { taskId: 'task-9', options: ['ja', 'nein'] } } as ChatMessage)
    const question = chat.messages.value.at(-1)!
    apiPost.mockResolvedValueOnce({ ok: true })
    apiFetch.mockResolvedValue({ state: 'running', answer: '' })

    await chat.answer(question, 'ja')

    const assistant = chat.messages.value.at(-1)!
    expect(assistant.system).toBe('Deine Auswahl konnte nicht zu Ende verarbeitet werden — Details stehen in der Browser-Konsole.')
    expect(assistant.streaming).toBe(false)
    expect(chat.isStreaming.value).toBe(false)
  })
})

// Not a silent path — this test passes with and without the fix and is here to
// hold that line: the composer's own catch already names the failed file, and
// nothing else inside its try/finally can throw.
describe('cockpit composer upload', () => {
  it('names the file the upload failed for and re-enables the picker', async () => {
    apiPost.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(CockpitComposer, {
      props: { streaming: false, company: 'c1' },
      global: { plugins: [i18n] },
    })
    const input = wrapper.find('input[type=file]').element as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'plan.pdf', { type: 'application/pdf' })], configurable: true })

    await wrapper.find('input[type=file]').trigger('change')
    await flushPromises()

    expect(wrapper.text()).toContain('Upload fehlgeschlagen: plan.pdf')
    expect(wrapper.find('button.attach').attributes('disabled')).toBeUndefined()
  })
})
