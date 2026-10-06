import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGrantStore } from '../src/runtime/server/utils/grant-store'

// In-memory storage — the store itself is the unit, not the persistence.
const mem = new Map<string, any>()
vi.mock('../src/runtime/server/utils/grant-storage', () => ({
  useGrantStorage: () => ({
    getKeys: async (prefix: string) => [...mem.keys()].filter(k => k.startsWith(prefix)),
    getItems: async (keys: string[]) => keys.map(key => ({ key, value: mem.get(key) })),
    getItem: async (key: string) => mem.get(key) ?? null,
    setItem: async (key: string, value: any) => { mem.set(key, value) },
  }),
}))

const HOUR = 3600
const now = Math.floor(Date.now() / 1000)

function grant(id: string, status: string, ageHours: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: null,
    status,
    created_at: now - ageHours * HOUR,
    request: { requester: 'op@example.com', grant_type: 'once' },
    ...extra,
  }
}

describe('pending-Request-TTL (48h)', () => {
  beforeEach(() => mem.clear())

  it('eine 49h alte pending-Anfrage verschwindet aus der Inbox und wird expired', async () => {
    mem.set('grants:old', grant('old', 'pending', 49))
    mem.set('grants:fresh', grant('fresh', 'pending', 47))
    const store = createGrantStore()
    const pending = await store.findPending()
    expect(pending.map(g => g.id)).toEqual(['fresh'])
    expect(mem.get('grants:old').status).toBe('expired')
  })

  it('approved-Grants altern nicht weg — TTL gilt nur für unbeantwortete Anfragen', async () => {
    mem.set('grants:standing', grant('standing', 'approved', 200))
    const store = createGrantStore()
    await store.findPending()
    expect(mem.get('grants:standing').status).toBe('approved')
  })

  it('findById kippt eine stale pending-Anfrage ebenfalls — Approve über einen alten Link scheitert damit am Status', async () => {
    mem.set('grants:old', grant('old', 'pending', 72))
    const store = createGrantStore()
    const g = await store.findById('old')
    expect(g?.status).toBe('expired')
  })

  it('listGrants(status=pending) liefert die stale Anfrage nicht mehr', async () => {
    mem.set('grants:old', grant('old', 'pending', 49))
    const store = createGrantStore()
    const { data } = await store.listGrants({ status: 'pending' as any })
    expect(data).toEqual([])
  })
})
