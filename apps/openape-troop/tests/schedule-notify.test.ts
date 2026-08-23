import { describe, expect, it, vi } from 'vitest'

// A scheduled trigger decides whether its answer rings the owner's phone
// (#1295). Everything below measures the ABSENCE of a push, because that is the
// claim — a silent trigger that still pushed would look identical in the chat.
vi.mock('../server/database/drizzle', async () => {
  const { createClient } = await import('@libsql/client')
  const { drizzle } = await import('drizzle-orm/libsql')
  const schema = await import('../server/database/schema')
  const client = createClient({ url: 'file::memory:?cache=shared' })
  await client.execute(`CREATE TABLE organizations (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, name TEXT NOT NULL, vision_md TEXT NOT NULL DEFAULT '', budget_monthly_eur INTEGER NOT NULL DEFAULT 0, vars TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE cockpit_chat_messages (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT, files TEXT, created_at INTEGER NOT NULL)`)
  const db = drizzle(client, { schema })
  return { useDb: () => db }
})
vi.mock('../server/utils/cockpit/push', () => ({ pushToOwner: vi.fn(async () => {}) }))

const { saveChatMessage } = await import('../server/utils/cockpit/chat-store')
const { pushToOwner } = await import('../server/utils/cockpit/push')
const { enqueue, getTask, restoreTask } = await import('../server/utils/cockpit/queue')
const { useDb } = await import('../server/database/drizzle')
const { organizations } = await import('../server/database/schema')

async function org(id: string, owner: string) {
  await useDb().insert(organizations).values({ id, ownerEmail: owner, name: 'Testfirma', visionMd: '', budgetMonthlyEur: 0, vars: {}, createdAt: Date.now(), updatedAt: Date.now() })
}

describe('a task carries its own notification decision', () => {
  it('defaults to notifying — a trigger stays as loud as it was', () => {
    const { id } = enqueue('org-a', 'sys', 'msg', 'owner@x')
    expect(getTask(id)!.notify).toBe(true)
  })

  it('remembers when a trigger asked for silence', () => {
    const { id } = enqueue('org-a', 'sys', 'msg', 'owner@x', undefined, [], false)
    expect(getTask(id)!.notify).toBe(false)
  })

  it('keeps the silence across a restart', () => {
    // troop restarts on every deploy and re-offers in-flight tasks. Without the
    // persisted flag a deliberately quiet trigger would come back loud — the
    // failure would be a phone ringing weeks later for no visible reason.
    restoreTask({ id: 'restored-1', company: 'org-a', owner: 'owner@x', systemPrompt: 'sys', userMessage: 'msg', createdAt: Date.now(), notify: false })
    expect(getTask('restored-1')!.notify).toBe(false)
  })

  it('a restored task with no stored preference stays loud', () => {
    restoreTask({ id: 'restored-2', company: 'org-a', owner: 'owner@x', systemPrompt: 'sys', userMessage: 'msg', createdAt: Date.now() })
    expect(getTask('restored-2')!.notify).not.toBe(false)
  })
})

describe('saveChatMessage honours the decision', () => {
  it('pushes an assistant answer by default', async () => {
    await org('org-loud', 'loud@x')
    vi.mocked(pushToOwner).mockClear()

    await saveChatMessage('org-loud', 'loud@x', 'assistant', 'Termine von morgen: keine.')

    expect(pushToOwner).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the trigger opted out — but still writes the chat', async () => {
    await org('org-quiet', 'quiet@x')
    vi.mocked(pushToOwner).mockClear()

    const row = await saveChatMessage('org-quiet', 'quiet@x', 'assistant', 'gepusht: mail.inbox=68', undefined, undefined, { notify: false })

    expect(pushToOwner).not.toHaveBeenCalled()
    // The answer is not lost, it just did not ring: this is the whole point.
    expect(row.content).toBe('gepusht: mail.inbox=68')
  })

  it('pushes when notify is explicitly true', async () => {
    await org('org-explicit', 'explicit@x')
    vi.mocked(pushToOwner).mockClear()

    await saveChatMessage('org-explicit', 'explicit@x', 'assistant', 'Erinnerung: Exoscale-Rechnung prüfen.', undefined, undefined, { notify: true })

    expect(pushToOwner).toHaveBeenCalledTimes(1)
  })

  it('never pushes a user message, silent or not', async () => {
    await org('org-user', 'user@x')
    vi.mocked(pushToOwner).mockClear()

    await saveChatMessage('org-user', 'user@x', 'user', 'Was steht heute an?')

    expect(pushToOwner).not.toHaveBeenCalled()
  })

  it('does not store the decision on the row — it is delivery, not conversation', async () => {
    await org('org-meta', 'meta@x')
    const row = await saveChatMessage('org-meta', 'meta@x', 'assistant', 'still', undefined, undefined, { notify: false })
    expect(row.meta).toBeNull()
  })
})
