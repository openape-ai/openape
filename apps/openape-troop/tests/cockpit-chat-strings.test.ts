// @vitest-environment happy-dom
import type { ChatMessage } from '../app/utils/cockpit/types'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import CockpitBubble from '../app/components/cockpit/CockpitBubble.vue'
import { useCockpitChat } from '../app/composables/useCockpitChat'
import de from '../i18n/locales/de.json'
import en from '../i18n/locales/en.json'

// The company pick is persisted in IndexedDB — irrelevant here and unavailable
// in this environment.
vi.mock('../app/utils/cockpit/store', () => ({
  loadCockpitCompany: async () => undefined,
  saveCockpitCompany: async () => {},
}))

// The shipped German catalog, so every assertion below is on a string a user
// actually sees — a renamed or missing key fails the test.
const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de, en } })
vi.stubGlobal('useI18n', () => i18n.global)
vi.stubGlobal('useDateFormat', () => ({ fmtDate: () => '', fmtTime: () => '12:00' }))

const apiFetch = vi.fn()
const dollarFetch = vi.fn()
const streamFetch = vi.fn()
vi.stubGlobal('apiFetch', apiFetch)
vi.stubGlobal('$fetch', dollarFetch)
vi.stubGlobal('fetch', streamFetch)

function sseResponse(events: object[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return { body } as Response
}

// Drives one send against a scripted stream and hands back the live assistant
// bubble. `stop()` ends the persisted-answer poll the composable falls back to.
async function streamInto(events: object[], settled: (m: ChatMessage) => boolean): Promise<ChatMessage> {
  streamFetch.mockResolvedValue(sseResponse(events))
  const chat = useCockpitChat()
  chat.companies.value.push({ id: 'acme', name: 'Acme', short: 'A', accent: '#000' })
  await chat.selectCompany('acme')
  const sent = chat.send('hallo')
  await vi.waitFor(() => expect(settled(chat.messages.value.at(-1)!)).toBe(true))
  const assistant = chat.messages.value.at(-1)!
  chat.stop()
  await sent
  return assistant
}

beforeEach(() => {
  apiFetch.mockReset()
  dollarFetch.mockReset()
  streamFetch.mockReset()
  dollarFetch.mockResolvedValue([])
})

describe('cockpit chat — server codes become the user\'s language', () => {
  it('translates a known code and keeps the countdown', async () => {
    const assistant = await streamInto([{ k: 'wait', code: 'operator.asleep', sec: 42 }], m => !!m.waiting)
    expect(assistant.waiting).toBe('💤 Operator im Ruhemodus · Antwort in ~42 s')
  })

  it('falls back to a readable line for a code it does not know', async () => {
    const assistant = await streamInto([{ k: 'think', code: 'operator.fromTheFuture' }], m => (m.thoughts?.length ?? 0) > 0)
    expect(assistant.thoughts).toEqual(['🧠 Dein Operator arbeitet …'])
    expect(assistant.thoughts?.[0]).not.toContain('operator.fromTheFuture')
  })

  it('reads English in an English session — the whole point of the codes', async () => {
    i18n.global.locale.value = 'en'
    try {
      const assistant = await streamInto([{ k: 'wait', code: 'operator.asleep', sec: 42 }], m => !!m.waiting)
      expect(assistant.waiting).toBe('💤 Operator asleep · answer in ~42s')
    }
    finally {
      i18n.global.locale.value = 'de'
    }
  })

  it('still renders the free-text progress the worker sends', async () => {
    const assistant = await streamInto([{ k: 'think', text: 'lese die Mails' }], m => (m.thoughts?.length ?? 0) > 0)
    expect(assistant.thoughts).toEqual(['lese die Mails'])
  })
})

function bubble(message: Partial<ChatMessage>) {
  return mount(CockpitBubble, {
    props: { message: { id: 'm', role: 'assistant', content: '', createdAt: Date.now(), ...message } as ChatMessage },
    global: { plugins: [i18n] },
  })
}

describe('cockpit bubble — nothing renders empty', () => {
  it('shows the translated waiting line', () => {
    expect(bubble({ streaming: true, waiting: '💤 Operator im Ruhemodus · Antwort in ~42 s' }).text()).toContain('💤 Operator im Ruhemodus')
  })

  it('labels an attachment-only message the owner sent', () => {
    const wrapper = bubble({ role: 'user', files: [{ id: 'f1', mime: 'image/png', name: 'shot.png' }] })
    expect(wrapper.text()).toContain('(Anhang)')
  })

  it('labels an attachment-only answer', () => {
    const wrapper = bubble({ files: [{ id: 'f2', mime: 'application/pdf', name: 'report.pdf' }] })
    expect(wrapper.text()).toContain('(Anhang)')
  })
})
