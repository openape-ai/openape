import { computed, reactive, toRaw } from 'vue'
import type { CentralOperation } from '../../../openape-pods/src/contracts/central'
import type { InboxDevice, InboxItem } from '../../shared/inbox-types'

export type { InboxDevice, InboxItem }
export interface InboxSession { issuer: string, subject: string, device: string, vapidPublicKey: string }
/** What this phone sent for a decision. `accepted`/`started` are never shown as applied; `unsent` may only be resent with the same request ID. */
export interface Receipt { option: string, title: string, digest: string, requestId: string, input?: string, state: 'sending' | 'unsent' | 'refused' | CentralOperation['state'], error: string | null, at: number }
export type Phase = 'loading' | 'signedOut' | 'ready' | 'offline' | 'error'

class InboxError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}
const network = (error: unknown) => error instanceof TypeError
const uuid = /^[0-9a-f-]{36}$/
export const isItemId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)
const storageKey = 'pods-inbox-cache-v1'
interface Cache { version: 1, account: string, cursor: number, syncedAt: number | null, items: InboxItem[], receipts: Record<string, Receipt> }
export const running = (receipt: Receipt | undefined) => !!receipt && ['sending', 'accepted', 'started'].includes(receipt.state)
/**
 * Whether this phone's earlier answer still rules out a new one: while it runs, after a send with unknown outcome
 * (only the same request may go again), and while an applied or unclear outcome refers to the version still shown.
 */
export function blocking(receipt: Receipt | undefined, item: InboxItem): boolean {
  if (!receipt) return false
  if (running(receipt) || receipt.state === 'unsent') return true
  return ['applied', 'unknown'].includes(receipt.state) && item.state === 'open' && receipt.digest === item.decision?.digest
}

export interface InboxEnvironment { fetch: (input: string, init: RequestInit) => Promise<Response>, storage: Storage | null, now: () => number, wait: (ms: number) => Promise<void>, later: (ms: number, run: () => Promise<void>) => () => void, navigate: (url: string) => void }
/** An answer the owner just tapped; it leaves only after the undo window, with the version that was shown. */
export interface PendingAnswer { option: string, title: string, until: number }
export const undoMs = 5000

// The owner inbox (plan issue 1446, M4). The server stays authoritative: the phone syncs the account's change feed,
// keeps a disposable copy for offline reading under its account, and never queues or replays owner intent.
export function createInbox(environment: InboxEnvironment) {
  const state = reactive({
    phase: 'loading' as Phase,
    session: null as InboxSession | null,
    account: null as string | null,
    items: {} as Record<string, InboxItem>,
    receipts: {} as Record<string, Receipt>,
    checking: {} as Record<string, boolean>,
    pending: {} as Record<string, PendingAnswer>,
    cursor: 0,
    syncedAt: null as number | null,
    syncing: false,
    syncError: null as string | null,
    signedOutReason: null as 'revoked' | null,
    cacheAvailable: true,
    error: null as string | null,
  })
  let syncing: Promise<void> | null = null
  const timers = new Map<string, () => void>()

  async function api<T>(path: string, init: { method?: string, body?: unknown } = {}): Promise<T> {
    const response = await environment.fetch(`/inbox/api/v1/${path}`, { method: init.method ?? 'GET', cache: 'no-store', credentials: 'same-origin', ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }) })
    const result = await response.json().catch(() => ({})) as T & { code?: string }
    if (response.status === 401) { expire(result.code === 'session_revoked' ? 'revoked' : null); throw new InboxError(result.code ?? 'authentication_required', 401) }
    if (!response.ok) throw new InboxError(result.code ?? `http_${response.status}`, response.status)
    return result
  }

  function readCache(): Cache | null {
    try {
      const value = JSON.parse(environment.storage?.getItem(storageKey) ?? 'null') as Cache | null
      return value?.version === 1 && typeof value.account === 'string' && Array.isArray(value.items) ? value : null
    }
    catch { return null }
  }
  function clearCache(): void {
    try { environment.storage?.removeItem(storageKey) }
    catch { state.cacheAvailable = false }
  }
  // ponytail: localStorage holds a few MB; a quota failure drops the copy and the next start syncs from zero. Upgrade path: IndexedDB.
  function persist(): void {
    if (!state.account || !environment.storage) return
    const cache: Cache = { version: 1, account: state.account, cursor: state.cursor, syncedAt: state.syncedAt, items: Object.values(state.items), receipts: state.receipts }
    try { environment.storage.setItem(storageKey, JSON.stringify(cache)); state.cacheAvailable = true }
    catch { clearCache(); state.cacheAvailable = false }
  }
  function restore(cache: Cache): void {
    state.account = cache.account
    state.cursor = cache.cursor
    state.syncedAt = cache.syncedAt
    state.items = Object.fromEntries(cache.items.map(item => [item.id, item]))
    // A send interrupted by closing the app has an unknown outcome; it may only be resent with its request ID.
    state.receipts = Object.fromEntries(Object.entries(cache.receipts ?? {}).map(([itemId, receipt]) => [itemId, receipt.state === 'sending' ? { ...receipt, state: 'unsent', error: 'network' } : receipt]))
  }
  function reset(): void {
    for (const cancel of timers.values()) cancel()
    timers.clear()
    Object.assign(state, { session: null, account: null, items: {}, receipts: {}, checking: {}, pending: {}, cursor: 0, syncedAt: null, syncError: null })
  }

  // Any 401 ends the local copy: an expired or revoked device must not keep showing account content.
  function expire(reason: 'revoked' | null): void {
    clearCache(); reset()
    state.signedOutReason = reason
    state.phase = 'signedOut'
  }

  async function start(): Promise<void> {
    state.phase = 'loading'; state.error = null
    let session: InboxSession
    try { session = await api<InboxSession>('session') }
    catch (error) {
      if (error instanceof InboxError && error.status === 401) return
      if (network(error)) {
        const cache = readCache()
        if (cache) restore(cache)
        state.phase = 'offline'
        return
      }
      state.error = error instanceof InboxError ? error.code : String(error)
      state.phase = 'error'
      return
    }
    const account = `${session.subject} · ${session.issuer}`
    const cache = readCache()
    reset()
    if (cache?.account === account) restore(cache)
    else clearCache()
    state.session = session; state.account = account; state.signedOutReason = null
    state.phase = 'ready'
    await sync()
  }

  function apply(items: InboxItem[]): void {
    for (const item of items) {
      if (item.deleted) {
        delete state.items[item.id]
        delete state.receipts[item.id]
      }
      else { state.items[item.id] = item }
    }
  }

  // Pulls every change after the stored cursor, tombstones included, so the copy never resurrects deleted items.
  function sync(): Promise<void> {
    if (!state.session) return start()
    syncing ??= (async () => {
      state.syncing = true
      try {
        let more = true
        while (more) {
          const page = await api<{ items: InboxItem[], cursor: number, more: boolean, device: string }>(`changes?after=${state.cursor}`)
          // A sign-in in another tab replaced this browser's device session, possibly for another account: start over.
          if (page.device !== state.session?.device) { syncing = null; state.syncing = false; return await start() }
          apply(page.items)
          state.cursor = page.cursor; more = page.more
        }
        state.syncedAt = environment.now(); state.syncError = null
        if (state.phase === 'offline') state.phase = 'ready'
        persist()
      }
      catch (error) {
        if (error instanceof InboxError && error.status === 401) return
        if (network(error)) { state.phase = 'offline'; persist(); return }
        state.syncError = error instanceof InboxError ? error.code : String(error)
      }
      finally { state.syncing = false; syncing = null }
    })()
    return syncing
  }

  /** The item from the synced copy, or fetched directly for a link that arrived before the next sync. */
  async function load(itemId: string): Promise<InboxItem | null> {
    if (state.items[itemId]) return state.items[itemId]
    if (state.phase !== 'ready') return null
    try { const { item } = await api<{ item: InboxItem }>(`items/${itemId}`); state.items[item.id] = item; return item }
    catch (error) {
      if (error instanceof InboxError && error.status === 404) return null
      throw error
    }
  }

  async function mark(itemId: string, change: { read?: boolean, archived?: boolean }): Promise<void> {
    const { item } = await api<{ item: InboxItem }>(`items/${itemId}`, { method: 'PATCH', body: change })
    state.items[item.id] = item
    persist()
  }

  // Sends the digest the phone displayed. After a send with unknown outcome only that exact request may go out again,
  // by the owner's tap and under the same request ID; another option could otherwise act twice.
  async function decide(item: InboxItem, optionKey: string, input?: string): Promise<void> {
    const option = item.decision?.options.find(entry => entry.key === optionKey)
    const previous = state.receipts[item.id]
    if (!item.decision || !option || state.phase !== 'ready') return
    if (blocking(previous, item) && !(previous?.state === 'unsent' && previous.option === option.key)) return
    const text = input?.trim()
    const receipt: Receipt = previous?.state === 'unsent'
      ? { ...previous, state: 'sending', error: null }
      : { option: option.key, title: option.title, digest: item.decision.digest, requestId: crypto.randomUUID(), ...(text ? { input: text } : {}), state: 'sending', error: null, at: environment.now() }
    // Stored before it leaves: if the app is closed meanwhile, the restart offers only this exact request again.
    state.receipts[item.id] = receipt
    persist()
    try {
      const { operation } = await api<{ operation: CentralOperation }>(`items/${item.id}/decide`, { method: 'POST', body: { option: receipt.option, digest: receipt.digest, requestId: receipt.requestId, ...(receipt.input ? { input: receipt.input } : {}) } })
      state.receipts[item.id] = { ...receipt, state: operation.state, error: operation.error }
      persist()
    }
    catch (error) {
      if (error instanceof InboxError && error.status === 401) return
      state.receipts[item.id] = { ...receipt, state: network(error) || (error instanceof InboxError && error.status >= 500) ? 'unsent' : 'refused', error: error instanceof InboxError ? error.code : 'network' }
      persist()
      if (error instanceof InboxError && ['decision_changed', 'decision_resolved'].includes(error.code)) await sync()
      return
    }
    await check(item.id)
  }

  // Follows the desktop's receipt for about a minute; afterwards the owner checks again explicitly.
  async function check(itemId: string): Promise<void> {
    if (state.checking[itemId]) return
    state.checking[itemId] = true
    try { await follow(itemId) }
    finally { delete state.checking[itemId] }
  }
  async function follow(itemId: string): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const receipt = state.receipts[itemId]
      if (!receipt || !['accepted', 'started'].includes(receipt.state)) break
      if (attempt) await environment.wait(1500)
      try {
        const { operation } = await api<{ operation: CentralOperation }>(`operations/${receipt.requestId}`)
        state.receipts[itemId] = { ...receipt, state: operation.state, error: operation.error }
        persist()
      }
      catch (error) {
        // An operation the service no longer knows has an outcome only the desktop can tell.
        if (error instanceof InboxError && error.code === 'workspace_operation_not_found') { state.receipts[itemId] = { ...receipt, state: 'unknown', error: null }; persist(); break }
        if (!(error instanceof InboxError && error.status === 401)) state.syncError = error instanceof InboxError ? error.code : 'network'
        return
      }
    }
    if (!running(state.receipts[itemId])) await sync()
  }

  // A tap starts the undo window instead of sending; nothing is stored, so closing the app in the window sends nothing.
  // Resending an uncertain request is the same request again and needs no window.
  async function answer(item: InboxItem, optionKey: string, input?: string): Promise<void> {
    if (state.receipts[item.id]?.state === 'unsent') { await decide(item, optionKey, input); return }
    const option = item.decision?.options.find(entry => entry.key === optionKey)
    if (!option || state.pending[item.id] || state.phase !== 'ready' || blocking(state.receipts[item.id], item)) return
    const shown = structuredClone(toRaw(item))
    state.pending[item.id] = { option: option.key, title: option.title, until: environment.now() + undoMs }
    timers.set(item.id, environment.later(undoMs, async () => {
      timers.delete(item.id)
      delete state.pending[item.id]
      await decide(shown, option.key, input)
    }))
  }
  function undo(itemId: string): void {
    timers.get(itemId)?.()
    timers.delete(itemId)
    delete state.pending[itemId]
  }

  async function login(email: string): Promise<void> {
    clearCache(); reset()
    const target = new URL(window.location.href)
    target.searchParams.delete('login')
    const response = await environment.fetch('/workspace-auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), returnTo: target.pathname + target.search }), redirect: 'error' })
    const result = await response.json().catch(() => ({})) as { redirectUrl?: string, statusMessage?: string, code?: string }
    if (!response.ok || !result.redirectUrl) throw new Error(result.statusMessage || result.code || `HTTP ${response.status}`)
    environment.navigate(result.redirectUrl)
  }

  // The local copy goes even if the service's confirmation is lost; the next start shows whether a session remains.
  async function logout(): Promise<void> {
    try { await api('logout', { method: 'POST' }) }
    finally { expire(null) }
  }

  const devices = () => api<{ current: string, devices: InboxDevice[] }>('devices')
  async function revoke(deviceId: string): Promise<void> {
    await api(`devices/${deviceId}/revoke`, { method: 'POST' })
    if (deviceId === state.session?.device) expire('revoked')
  }

  const pushSubscribe = (subscription: PushSubscriptionJSON) => api('push/subscribe', { method: 'POST', body: { subscription } })
  const pushUnsubscribe = () => api('push/unsubscribe', { method: 'POST' })

  const list = computed(() => Object.values(state.items))
  const openDecisions = computed(() => list.value.filter(item => item.kind === 'decision' && item.state === 'open' && !item.archived).sort((a, b) => b.created - a.created))
  const completedDecisions = computed(() => list.value.filter(item => item.kind === 'decision' && item.state !== 'open').sort((a, b) => b.sequence - a.sequence).slice(0, 30))
  const messages = computed(() => list.value.filter(item => item.kind === 'message' && !item.archived).sort((a, b) => b.created - a.created))
  const archivedMessages = computed(() => list.value.filter(item => item.kind === 'message' && item.archived).sort((a, b) => b.created - a.created))
  const unread = computed(() => messages.value.filter(item => !item.read).length)
  const badgeCount = computed(() => openDecisions.value.length + unread.value)
  // Only answers to decisions that are still open hold back an app update; resolved ones need no reconciliation.
  const deciding = computed(() => Object.keys(state.pending).length > 0 || Object.entries(state.receipts).some(([itemId, receipt]) => running(receipt) && state.items[itemId]?.state === 'open'))

  return { state, start, sync, load, mark, decide, answer, undo, check, login, logout, devices, revoke, pushSubscribe, pushUnsubscribe, openDecisions, completedDecisions, messages, archivedMessages, unread, badgeCount, deciding }
}
export type Inbox = ReturnType<typeof createInbox>

// Storage access throws in some private modes; the inbox then works online only.
function browserStorage(): Storage | null {
  try { return localStorage }
  catch { return null }
}

let instance: Inbox | undefined
export function useInbox(): Inbox {
  instance ??= createInbox({
    fetch: (input, init) => fetch(input, init),
    storage: browserStorage(),
    now: Date.now,
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    later: (ms, run) => { const timer = setTimeout(run, ms); return () => clearTimeout(timer) },
    navigate: url => window.location.assign(url),
  })
  return instance
}
