import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import CodexReviews from '../../src/renderer/CodexReviews.vue'
import { codexConversationId } from '../../src/contracts/codex'
import type { ChangeSet } from '../../src/contracts/control-api'
import type { MasterView } from '../../src/contracts/master'
import { installWorkspace, podId } from './workspace-fixture'

// Issue 1375: the review of what Codex prepared, with ChangeReview's own CSS.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = '' })
const code = `export default async ({ mail }) => {\n  const messages = await mail.read({ folder: 'Inbox/Customers/Northwind Trading Company/Orders/2026/September' })\n  return messages.map(message => message.subject)\n}`
const set: ChangeSet = { id: '00000000-0000-4000-8000-0000000000c1', conversationId: codexConversationId, contextRevision: 1, revision: 1, kind: 'changes', state: 'pending', error: null, results: [], targets: [{ podId, name: 'Mail knowledge', base: 'x', before: {}, draftHashes: {}, actions: [], review: [{ action: 'activate', before: '', after: code, evidence: '{"validated":true}' }] }] }
const view: MasterView = { changes: [set], conversation: { id: codexConversationId, revision: 1 } as MasterView['conversation'], activeConversationId: null, connected: true, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }

it('stacks before and after in a narrow dark window and keeps them side by side on the desktop', async () => {
  installWorkspace({ master: async () => structuredClone(view) })
  wrapper = mount(CodexReviews, { attachTo: document.body }); await flushPromises()
  for (const details of Array.from(document.querySelectorAll('details'))) details.open = true
  const columns = () => Array.from(document.querySelectorAll('.change-columns section')).map(section => section.getBoundingClientRect())
  await page.viewport(1060, 850); await frame()
  const [before, after] = columns()
  expect(before!.top).toBe(after!.top); expect(after!.left).toBeGreaterThan(before!.right)
  await page.viewport(560, 700); document.documentElement.style.colorScheme = 'dark'; await frame()
  const [narrowBefore, narrowAfter] = columns()
  expect(narrowAfter!.top).toBeGreaterThan(narrowBefore!.bottom - 1)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
  await page.screenshot({ path: '../../.artifacts/codex-reviews-560-dark.png' })
})
