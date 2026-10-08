import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { watchInboxBadge } from '../app/inbox/badge'
import { createInbox } from '../app/inbox/client'
import { InboxStore, parsePublication } from '../server/utils/inbox-store'

const cleanup: (() => void)[] = []
afterEach(() => { for (const run of cleanup.splice(0).reverse()) run() })
const alice = { issuer: 'https://id.example', subject: 'alice' }
const bob = { ...alice, subject: 'bob' }
const runtime = randomUUID()
const digest = 'a'.repeat(64)

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return { get length() { return values.size }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) } }
}

// The phone client against the real inbox store behind a minimal stand-in for the v1 routes.
function setup(storage = memoryStorage(), shared?: InboxStore) {
  const store = shared ?? new InboxStore(':memory:')
  if (!shared) cleanup.push(() => store.close())
  const server = { owner: alice as typeof alice | null, offline: false, revoked: false, decide: [] as Record<string, unknown>[], decideFails: null as string | 'network' | null, operation: 'accepted', requests: [] as string[], device: randomUUID(), hang: false }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'https://pods.example')
    const path = url.pathname.replace('/inbox/api/v1/', '')
    server.requests.push(`${init?.method ?? 'GET'} ${path}`)
    if (server.offline) throw new TypeError('Failed to fetch')
    if (server.revoked) return json(401, { code: 'session_revoked' })
    const owner = server.owner
    if (!owner) return json(401, { code: 'authentication_required' })
    if (path === 'session') return json(200, { ...owner, device: server.device, vapidPublicKey: '' })
    if (path === 'changes') return json(200, { ...store.changes(owner, Number(url.searchParams.get('after'))), device: server.device })
    if (path === 'logout') throw new TypeError('Failed to fetch')
    if (/^items\/.+\/decide$/.test(path)) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      server.decide.push(body)
      if (server.hang) return new Promise<Response>(() => {})
      if (server.decideFails === 'network') throw new TypeError('Failed to fetch')
      if (server.decideFails) return json(409, { code: server.decideFails })
      return json(200, { operation: { id: body.requestId, state: 'accepted', error: null } })
    }
    const operation = /^operations\/(.+)$/.exec(path)
    if (operation) return json(200, { operation: { id: operation[1], state: server.operation, error: null } })
    const item = /^items\/(.+)$/.exec(path)
    if (item && init?.method === 'PATCH') return json(200, { item: store.mark(owner, item[1]!, JSON.parse(String(init.body))) })
    if (item) {
      try { return json(200, { item: store.item(owner, item[1]!) }) }
      catch { return json(404, { code: 'not_found' }) }
    }
    return json(404, { code: 'not_found' })
  }
  const timers: { ms: number, run: () => Promise<void>, cancelled: boolean }[] = []
  const later = (ms: number, run: () => Promise<void>) => { const timer = { ms, run, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true } }
  const elapse = async () => {
    for (const timer of timers.splice(0)) {
      if (!timer.cancelled) await timer.run()
    }
  }
  const inbox = createInbox({ fetch, storage, now: () => 1_000, wait: async () => {}, later, navigate: () => {} })
  const message = (owner: typeof alice, eventId: string, title = 'Belege') => store.publish(owner, runtime, parsePublication({ eventId, kind: 'message', title, body: 'Rechnung abgelegt.' })).id
  const decision = (owner: typeof alice, options = [{ key: 'yes', title: 'Ja', input: null }, { key: 'seen', title: 'Gesehen', input: 'evidence' as const }]) => {
    store.syncDecisions(owner, runtime, [{ sourceId: 'effect:1', type: 'effect', digest, podId: null, podName: 'Mail', title: 'Zustellen?', body: 'Eine Mail wartet.', authority: 'pods', options, link: null }])
    return store.list(owner, { kind: 'decision' }).items[0]!.id
  }
  return { store, server, inbox, storage, message, decision, timers, elapse }
}

it('syncs the change feed, removes tombstones and restores read state from the server after a reinstall', async () => {
  const { store, inbox, message } = setup()
  const kept = message(alice, 'a')
  const removed = message(alice, 'b', 'Weg')
  await inbox.start()
  expect(inbox.state.phase).toBe('ready')
  expect(inbox.messages.value.map(item => item.title).sort()).toEqual(['Belege', 'Weg'])
  await inbox.mark(kept, { read: true })
  store.mark(alice, removed, { deleted: true })
  await inbox.sync()
  expect(inbox.messages.value.map(item => item.id)).toEqual([kept])
  expect(inbox.unread.value).toBe(0)

  // A reinstall starts with an empty device store; the account's read state comes back from the server.
  const reinstalled = setup(memoryStorage(), store)
  await reinstalled.inbox.start()
  expect(reinstalled.inbox.messages.value.map(item => [item.id, !!item.read])).toEqual([[kept, true]])
})

it('never shows one account’s offline copy to another account', async () => {
  const storage = memoryStorage()
  const first = setup(storage)
  first.message(alice, 'private', 'Nur Alice')
  await first.inbox.start()
  expect(storage.getItem('pods-inbox-cache-v1')).toContain('Nur Alice')

  // Same browser, other account on the next start: the old copy is discarded before anything renders.
  const second = setup(storage)
  second.server.owner = bob
  second.message(bob, 'own', 'Bob')
  await second.inbox.start()
  expect(Object.values(second.inbox.state.items).map(item => item.title)).toEqual(['Bob'])
  expect(storage.getItem('pods-inbox-cache-v1')).not.toContain('Nur Alice')
})

it('reads the stored copy offline without actions, and a revoked session wipes it', async () => {
  const storage = memoryStorage()
  const online = setup(storage)
  const itemId = online.decision(alice)
  await online.inbox.start()

  const offline = setup(storage)
  offline.server.offline = true
  await offline.inbox.start()
  expect(offline.inbox.state.phase).toBe('offline')
  expect(offline.inbox.state.account).toBe('alice · https://id.example')
  expect(offline.inbox.openDecisions.value.map(item => item.title)).toEqual(['Zustellen?'])
  // Offline intent is never queued for later.
  await offline.inbox.decide(offline.inbox.state.items[itemId]!, 'yes')
  expect(offline.server.decide).toEqual([])
  expect(offline.inbox.state.receipts).toEqual({})

  offline.server.offline = false; offline.server.revoked = true
  await offline.inbox.start()
  expect(offline.inbox.state.phase).toBe('signedOut')
  expect(offline.inbox.state.signedOutReason).toBe('revoked')
  expect(offline.inbox.state.items).toEqual({})
  expect(storage.getItem('pods-inbox-cache-v1')).toBeNull()
})

it('sends the displayed digest, never reports acceptance as applied and resends an uncertain request unchanged', async () => {
  const { inbox, server, decision } = setup()
  const itemId = decision(alice)
  await inbox.start()
  const item = inbox.state.items[itemId]!

  server.decideFails = 'network'
  await inbox.decide(item, 'seen', '  Zugestellt  ')
  expect(inbox.state.receipts[itemId]).toMatchObject({ state: 'unsent', option: 'seen' })
  const first = server.decide[0]!
  expect(first).toMatchObject({ option: 'seen', input: 'Zugestellt', digest })
  // While the first outcome is unknown, no other option and no automatic retry goes out.
  await inbox.decide(item, 'yes')
  expect(server.decide).toHaveLength(1)

  server.decideFails = null
  await inbox.decide(item, 'seen')
  expect(server.decide[1]).toEqual(first)

  // The receipt follows the desktop: accepted/started stay "not applied" until the operation says so.
  expect(inbox.state.receipts[itemId]!.state).toBe('accepted')
  server.operation = 'applied'
  await inbox.check(itemId)
  expect(inbox.state.receipts[itemId]!.state).toBe('applied')
})

it('refreshes instead of deciding when the decision changed meanwhile', async () => {
  const { inbox, server, decision } = setup()
  const itemId = decision(alice)
  await inbox.start()
  server.decideFails = 'decision_changed'
  const before = server.requests.filter(request => request.startsWith('GET changes')).length
  await inbox.decide(inbox.state.items[itemId]!, 'yes')
  expect(inbox.state.receipts[itemId]).toMatchObject({ state: 'refused', error: 'decision_changed' })
  expect(server.requests.filter(request => request.startsWith('GET changes')).length).toBe(before + 1)
})

it('stores a send before it leaves, so closing the app midway allows only that request again', async () => {
  const storage = memoryStorage()
  const first = setup(storage)
  const itemId = first.decision(alice)
  await first.inbox.start()
  first.server.hang = true
  void first.inbox.decide(first.inbox.state.items[itemId]!, 'yes')
  await expect.poll(() => first.server.decide.length).toBe(1)

  const second = setup(storage, first.store)
  await second.inbox.start()
  expect(second.inbox.state.receipts[itemId]).toMatchObject({ state: 'unsent', option: 'yes', requestId: first.server.decide[0]!.requestId })
  await second.inbox.decide(second.inbox.state.items[itemId]!, 'seen', 'Zugestellt')
  expect(second.server.decide).toEqual([])
})

it('offers nothing new after an unclear outcome for the version still shown', async () => {
  const { inbox, server, decision } = setup()
  const itemId = decision(alice)
  await inbox.start()
  server.operation = 'unknown'
  await inbox.decide(inbox.state.items[itemId]!, 'yes')
  expect(inbox.state.receipts[itemId]!.state).toBe('unknown')
  await inbox.decide(inbox.state.items[itemId]!, 'seen', 'Zugestellt')
  expect(server.decide).toHaveLength(1)
})

it('starts over when another sign-in in this browser switched the account', async () => {
  const storage = memoryStorage()
  const { inbox, server, message, store } = setup(storage)
  message(alice, 'a', 'Nur Alice')
  await inbox.start()
  store.publish(bob, runtime, parsePublication({ eventId: 'b', kind: 'message', title: 'Bob', body: 'x' }))
  server.owner = bob; server.device = randomUUID()
  await inbox.sync()
  expect(inbox.state.account).toBe('bob · https://id.example')
  expect(Object.values(inbox.state.items).map(item => item.title)).toEqual(['Bob'])
  expect(storage.getItem('pods-inbox-cache-v1')).not.toContain('Nur Alice')
})

it('drops the local copy on sign-out even when the confirmation is lost', async () => {
  const storage = memoryStorage()
  const { inbox, message } = setup(storage)
  message(alice, 'a')
  await inbox.start()
  await expect(inbox.logout()).rejects.toThrow()
  expect(inbox.state.phase).toBe('signedOut')
  expect(storage.getItem('pods-inbox-cache-v1')).toBeNull()
})

it('sends a tapped answer only after the undo window, with the version that was shown', async () => {
  const { inbox, server, decision, timers, elapse, store } = setup()
  const itemId = decision(alice)
  await inbox.start()
  await inbox.answer(inbox.state.items[itemId]!, 'yes')
  expect(inbox.state.pending[itemId]).toMatchObject({ option: 'yes', title: 'Ja' })
  expect(timers.map(timer => timer.ms)).toEqual([5000])
  expect(inbox.deciding.value).toBe(true)
  // A second tap during the window changes nothing; undo cancels without any request.
  await inbox.answer(inbox.state.items[itemId]!, 'seen', 'x')
  inbox.undo(itemId)
  await elapse()
  expect(server.decide).toEqual([])
  expect(inbox.state.pending).toEqual({})

  await inbox.answer(inbox.state.items[itemId]!, 'yes')
  store.syncDecisions(alice, runtime, [{ sourceId: 'effect:1', type: 'effect', digest: 'b'.repeat(64), podId: null, podName: 'Mail', title: 'Geändert', body: 'Neu', authority: 'pods', options: [{ key: 'yes', title: 'Ja', input: null }], link: null }])
  await inbox.sync()
  await elapse()
  // The desktop checks the digest the owner saw, so a change during the window is refused instead of applied.
  expect(server.decide).toHaveLength(1)
  expect(server.decide[0]).toMatchObject({ option: 'yes', digest })
})

it('badges open decisions plus unread messages and clears on resolution or sign-out', async () => {
  const { inbox, store, server, message, decision } = setup()
  const navigator = { setAppBadge: vi.fn(async (_count: number) => {}), clearAppBadge: vi.fn(async () => {}) }
  cleanup.push(watchInboxBadge(inbox, navigator))
  const pending = decision(alice)
  const unread = message(alice, 'unread')
  const archived = message(alice, 'archived')
  store.mark(alice, archived, { archived: true })
  message(bob, 'private')
  await inbox.start()
  await nextTick()
  expect(navigator.setAppBadge).toHaveBeenLastCalledWith(2)
  expect(inbox.badgeCount.value).toBe(store.badgeCount(alice))

  await inbox.mark(pending, { read: true })
  await nextTick()
  expect(inbox.badgeCount.value).toBe(2)
  await inbox.mark(unread, { read: true })
  await nextTick()
  expect(navigator.setAppBadge).toHaveBeenLastCalledWith(1)
  await inbox.mark(unread, { read: false })
  await nextTick()
  expect(navigator.setAppBadge).toHaveBeenLastCalledWith(2)
  await inbox.mark(unread, { archived: true })
  await nextTick()
  expect(navigator.setAppBadge).toHaveBeenLastCalledWith(1)
  store.syncDecisions(alice, runtime, [])
  await inbox.sync()
  await nextTick()
  expect(inbox.badgeCount.value).toBe(store.badgeCount(alice))
  expect(navigator.clearAppBadge).toHaveBeenCalledTimes(1)

  message(alice, 'new')
  await inbox.sync()
  await nextTick()
  server.revoked = true
  await inbox.sync()
  await nextTick()
  expect(navigator.clearAppBadge).toHaveBeenCalledTimes(2)
})

it('waits for complete synchronization and never overwrites a badge from an offline cache', async () => {
  const { inbox, server, message } = setup()
  const navigator = { setAppBadge: vi.fn(async (_count: number) => {}), clearAppBadge: vi.fn(async () => {}) }
  cleanup.push(watchInboxBadge(inbox, navigator))
  for (let index = 0; index < 55; index++) message(alice, `message-${index}`)
  await inbox.start()
  await nextTick()
  expect(navigator.setAppBadge.mock.calls).toEqual([[55]])
  expect(navigator.clearAppBadge).not.toHaveBeenCalled()
  server.offline = true
  await inbox.sync()
  await nextTick()
  expect(navigator.setAppBadge.mock.calls).toEqual([[55]])
})

it('keeps inbox actions usable when badging is unsupported or rejected', async () => {
  const { inbox, message } = setup()
  cleanup.push(watchInboxBadge(inbox, {}))
  const error = new Error('Not allowed')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  cleanup.push(() => log.mockRestore())
  cleanup.push(watchInboxBadge(inbox, { setAppBadge: async () => { throw error }, clearAppBadge: async () => {} }))
  const id = message(alice, 'unread')
  await inbox.start()
  await nextTick()
  expect(log).toHaveBeenCalledWith('Inbox badge update failed', error)
  await inbox.mark(id, { read: true })
  expect(inbox.unread.value).toBe(0)
  expect(inbox.state.phase).toBe('ready')
})
