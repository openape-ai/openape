import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import type { Conversation, ChatsView } from '../../src/contracts/chats'
import type { AccessProposal, MasterMessage, MasterView } from '../../src/contracts/master'
import type { PodsBridge } from '../../src/contracts/ipc'
import { installWorkspace, podId, pods } from './workspace-fixture'

// Geometry formerly asserted by the packaged `master-ui`, `chat-setup`,
// `prompt-setup` and `chats` E2E files. Behaviour of the same surfaces lives in
// test/master/*; the confined app-server flows in e2e/master-chat.test.ts.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const artifact = (name: string) => `../../.artifacts/${name}`
const reportPod = pods[1]!
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en')
  try { localStorage.clear() }
  catch {}
})

const message = (role: MasterMessage['role'], text: string, at: number, state = 'completed'): MasterMessage => ({ id: crypto.randomUUID(), role, text, state, at })
const proposal = (body: AccessProposal['body']): AccessProposal => ({ id: crypto.randomUUID(), podId, body, state: 'pending' })
function podChat(extra: Partial<MasterView> = {}): MasterView {
  return {
    connected: true, state: 'idle', error: null, scriptState: 'draft',
    messages: [
      message('user', 'Create a synthetic mail knowledge pod and prepare a script. Propose the mailbox access for review.', 1),
      message('tool', '{"action":"validate","result":"native-synthetic-contract"}', 2),
      message('assistant', 'Your pod and validated draft are ready. Microsoft access awaits your review; automatic runs remain disabled.', 3),
    ],
    drafts: [{ id: crypto.randomUUID(), podId, name: 'Mail knowledge', revision: 2, code: 'export async function run() { return { status: "completed", summary: "Synthetic manual run", completedInputIds: [], gapIds: [] } }', capabilities: [], validation: 'native-synthetic-contract · synthetic services only', hash: 'd'.repeat(64) }],
    proposals: [
      proposal({ provider: 'microsoft', account: 'synthetic.mailbox.owner@example.invalid', folders: ['Inbox', 'Sent Items', 'Archive/Customers/Northwind Trading Company'], attachments: true, description: 'Read selected messages and attachments for sourced knowledge.' }),
      proposal({ provider: 'http', origin: 'https://api.telegram.org', methods: ['POST'], description: 'Notify after filing' }),
      proposal({ provider: 'directory', path: '/Users/fixture/Documents/Customers/Northwind Trading Company/Invoices/2026', access: 'readWrite', description: 'Save invoice files' }),
      proposal({ provider: 'variable', alias: 'telegram_chat_id', description: 'Which Telegram chat receives notifications?', instructions: 'Enter the destination chat ID. This is not the bot token.' }),
      proposal({ provider: 'credential', alias: 'telegram_bot_token', description: 'Store the bot token securely' }),
    ],
    ...extra,
  }
}
async function mountApp(overrides: Partial<PodsBridge>) {
  installWorkspace(overrides)
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises(); await frame()
}
async function show(width: number, height: number, scheme: 'light' | 'dark' = 'light') {
  await page.viewport(width, height); document.documentElement.style.colorScheme = scheme; await frame()
}
async function click(selector: string, text?: string) {
  const target = text ? wrapper!.findAll(selector).find(item => item.text().trim() === text) : wrapper!.find(selector)
  if (!target?.exists()) throw new Error(`Missing ${selector} ${text ?? ''}`)
  await target.trigger('click'); await flushPromises(); await frame()
}
function inside(element: Element) {
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.top >= 0 && box.left >= 0 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5
}
function pageFits() { return document.documentElement.scrollWidth <= innerWidth }
async function type(text: string, key?: string) {
  const input = document.querySelector<HTMLTextAreaElement>('.master-compose textarea')!
  input.focus(); input.value = text; input.dispatchEvent(new Event('input')); await flushPromises()
  if (key) { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); await flushPromises() }
  await frame()
}

describe('pod chat with the production stylesheet', () => {
  it.each(['en', 'de'] as const)('keeps messages, setup cards and the composer inside desktop and narrow windows (%s)', async (language) => {
    applyLanguage(language)
    await mountApp({ master: async () => podChat() })
    await click('[role="tab"]', 'Chat')
    // Guard: the seeded conversation and every setup card are rendered.
    expect(document.querySelectorAll('.master-message.user')).toHaveLength(1)
    expect(document.querySelectorAll('.chat-access').length).toBeGreaterThanOrEqual(5)
    for (const details of Array.from(document.querySelectorAll<HTMLDetailsElement>('details.chat-access'))) details.open = true
    for (const [width, height, scheme] of [[1100, 850, 'light'], [760, 700, 'light'], [560, 760, 'dark'], [560, 560, 'dark']] as const) {
      await show(width, height, scheme)
      const label = `${language} ${width}x${height} ${scheme}`
      expect(pageFits(), `${label}: page overflow`).toBe(true)
      expect(inside(document.querySelector('.master-compose')!), `${label}: composer`).toBe(true)
      const user = document.querySelector('.master-message.user')!.getBoundingClientRect()
      const assistant = document.querySelector('.master-message.assistant')!.getBoundingClientRect()
      expect(user.left, `${label}: own messages align right`).toBeGreaterThan(assistant.left)
      if (width === 1100 && language === 'de') { document.querySelector('.chat-scroll')!.scrollTop = 0; await page.screenshot({ path: artifact('chat-conversation-de.png') }) }
    }
    if (language === 'de') {
      await show(560, 760, 'dark')
      document.querySelector('.chat-access')!.scrollIntoView()
      await page.screenshot({ path: artifact('chat-setup-resolved-de-dark.png') })
    }
  })

  it('shows the reviewed HTTP destination without widening the chat', async () => {
    await mountApp({ master: async () => podChat() })
    await click('[role="tab"]', 'Chat')
    await show(1060, 850)
    const card = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.chat-access')).find(item => item.textContent!.includes('Notify after filing'))!
    card.open = true; await frame()
    const review = Array.from(card.querySelectorAll('button')).find(button => button.textContent!.trim() === 'Review resources')!
    review.click(); await flushPromises(); await frame()
    expect(card.querySelector<HTMLInputElement>('input[type="url"]')!.value).toBe('https://api.telegram.org')
    expect(pageFits()).toBe(true)
    card.scrollIntoView()
    await page.screenshot({ path: artifact('chat-setup-http.png') })
    await show(560, 760, 'dark')
    expect(pageFits(), 'narrow review form').toBe(true)
  })

  it('opens the command palette and model picker inside the composer area, also in a narrow German window', async () => {
    await mountApp({ master: async () => podChat({ messages: [], proposals: [], drafts: [] }) })
    await click('[role="tab"]', 'Chat')
    await show(1060, 850)
    await type('/')
    expect(inside(document.querySelector('.composer-palette')!), 'command palette').toBe(true)
    await page.screenshot({ path: artifact('chats-slash-command.png') })
    await type('/model', 'Enter')
    expect(document.querySelector('[role="combobox"]')).not.toBeNull()
    expect(inside(document.querySelector('.composer-palette')!), 'model picker').toBe(true)
    await page.screenshot({ path: artifact('chats-model-picker.png') })
    wrapper!.unmount(); applyLanguage('de')
    await mountApp({ master: async () => podChat() })
    await click('[role="tab"]', 'Chat')
    await show(560, 560, 'dark')
    await type('Ein Entwurf bleibt erhalten')
    await click('.composer-model')
    const palette = document.querySelector('.composer-palette')!
    expect(inside(palette), `model picker 560: ${JSON.stringify(palette.getBoundingClientRect())}`).toBe(true)
    expect(pageFits()).toBe(true)
    await page.screenshot({ path: artifact('chats-model-picker-560.png') })
    expect(document.querySelector<HTMLTextAreaElement>('.master-compose textarea')!.value).toBe('Ein Entwurf bleibt erhalten')
  })

  it('follows new replies only while the owner reads the end of the conversation', async () => {
    const view = podChat({ proposals: [], drafts: [], messages: [message('user', 'Explain the pending setup.', 1), message('assistant', 'A long synthetic response. '.repeat(150), 2)] })
    await mountApp({ master: async () => structuredClone(view) })
    await click('[role="tab"]', 'Chat')
    await show(1060, 700)
    const scroll = document.querySelector<HTMLElement>('.chat-scroll')!
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight)
    const arrive = async (text: string) => {
      view.messages.push(message('assistant', text, view.messages.length + 1))
      await expect.poll(() => scroll.textContent!.includes(text), { timeout: 3000 }).toBe(true)
      await frame()
    }
    scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll'))
    await arrive('This arrived while you were reading earlier messages.')
    expect(scroll.scrollTop, 'reading position kept').toBe(0)
    scroll.scrollTop = scroll.scrollHeight; scroll.dispatchEvent(new Event('scroll'))
    await arrive('This reply should remain visible at the end of the conversation.')
    expect(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight, 'latest reply followed').toBeLessThan(2)
    expect(inside(document.querySelector('.master-compose')!)).toBe(true)
  })
})

describe('central chats with the production stylesheet', () => {
  const id = '00000000-0000-4000-8000-0000000000c1'
  const conversation: Conversation = { id, title: 'Mail filter and short report', scope: `chat:${id}`, revision: 2, originPodId: null, updatedAt: 1, context: { pods: [{ id: podId, name: 'Mail knowledge' }, { id: reportPod.id, name: reportPod.name }], podIds: [podId, reportPod.id], workflow: null }, workflowChanged: false, unavailablePodIds: [], relatedPodIds: [podId, reportPod.id], relatedWorkflowIds: [] }
  const chats: ChatsView = { conversations: [conversation], activeConversationId: null }
  const review = (name: string, target: string) => ({ podId: target, name, base: 'a'.repeat(64), before: null, actions: [], draftHashes: {}, review: [{ action: 'activate', before: '', after: 'export async function run(context) {\n  return { status: "completed", summary: "Synthetic chat run", completedInputIds: [], gapIds: [] }\n}', evidence: 'native-synthetic-contract · synthetic services only' }] })
  const central: MasterView = {
    conversation, connected: true, state: 'idle', error: null, drafts: [], proposals: [],
    messages: [message('user', 'FILTER_PRIVATE_CONTEXT: Prepare both scripts together.', 1), message('assistant', 'Review ready: prepare.', 2)],
    changes: [{ id: crypto.randomUUID(), conversationId: id, contextRevision: 2, revision: 1, kind: 'changes', state: 'pending', error: null, results: [], targets: [review('Mail knowledge', podId), review(reportPod.name, reportPod.id)] }],
  }

  it('keeps the context header, reviews and composer reachable at 1060, 760 and 560 pixels', async () => {
    await mountApp({ chats: async () => structuredClone(chats), master: async () => structuredClone(central) })
    await click('.nav-button', 'Chats')
    await click('button', conversation.title)
    expect(wrapper!.text()).toContain('Apply changes together')
    for (const details of Array.from(document.querySelectorAll<HTMLDetailsElement>('.change-diff'))) details.open = true
    for (const [width, scheme] of [[1060, 'light'], [760, 'light'], [560, 'dark']] as const) {
      await show(width, 840, scheme)
      expect(pageFits(), `${width}: page overflow`).toBe(true)
      expect(inside(document.querySelector('.master-compose')!), `${width}: composer`).toBe(true)
      if (width === 1060) {
        document.querySelector('.change-diff')!.scrollIntoView()
        await page.screenshot({ path: artifact('chats-review.png') })
        await type('Keep this unsent note.')
        await click('.composer-model')
        expect(inside(document.querySelector('.composer-palette')!)).toBe(true)
        await page.screenshot({ path: artifact('chats-central-model-picker.png') })
        await click('.composer-model')
        await type('')
      }
      await page.screenshot({ path: artifact(`chats-${width}.png`) })
    }
    await show(1060, 840)
    await click('button[aria-label="Add context"]')
    const dialog = document.querySelector('dialog')!
    expect(inside(dialog)).toBe(true)
    await page.screenshot({ path: artifact('chats-plus-context.png') })
  })
})
