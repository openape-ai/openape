import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireCockpitAgent } from '../server/utils/cockpit/auth'
import { TROOP_SCOPES } from '../server/utils/scope-catalog'

// requireCaller comes from @openape/nuxt-auth-sp as a Nitro auto-import; outside
// Nuxt it resolves via globalThis, so each test stubs the caller it needs.
interface Caller { email: string, act: 'human' | 'agent', scope?: string[] }
function stubCaller(caller: Caller) {
  vi.stubGlobal('requireCaller', vi.fn(async () => caller))
}

const event = {} as H3Event

afterEach(() => vi.unstubAllGlobals())

describe('requireCockpitAgent scope enforcement (#1033)', () => {
  it('lets a first-party caller through unchanged (no scope claim)', async () => {
    // Baseline: today's worker path — the owner's own exchanged token carries
    // no scope claim and must keep working exactly as before.
    stubCaller({ email: 'patrick@example.test', act: 'human' })
    await expect(requireCockpitAgent(event)).resolves.toBe('patrick@example.test')
  })

  it('lets a first-party agent caller through (IdP agent token, no scope claim)', async () => {
    stubCaller({ email: 'operator@id.openape.ai', act: 'agent' })
    await expect(requireCockpitAgent(event)).resolves.toBe('operator@id.openape.ai')
  })

  it('lets a delegated caller with troop:cockpit-serve through', async () => {
    stubCaller({ email: 'patrick@example.test', act: 'agent', scope: ['troop:cockpit-serve'] })
    await expect(requireCockpitAgent(event)).resolves.toBe('patrick@example.test')
  })

  it('rejects a delegated caller without troop:cockpit-serve with 403', async () => {
    stubCaller({ email: 'patrick@example.test', act: 'agent', scope: ['troop:read-agents', 'troop:spawn-agent'] })
    await expect(requireCockpitAgent(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a delegated caller with an empty scope list with 403', async () => {
    stubCaller({ email: 'patrick@example.test', act: 'agent', scope: [] })
    await expect(requireCockpitAgent(event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('troop:cockpit-serve catalog entry (#1033)', () => {
  // TROOP_SCOPES feeds BOTH /.well-known/openape.json and the /api/cli/exchange
  // catalog check (openapeSp.manifest.scopes in nuxt.config.ts) — one assertion
  // covers discovery and exchange.
  it('is published in TROOP_SCOPES with the cockpit-agent routes as grants', () => {
    const scope = TROOP_SCOPES.find(s => s.id === 'troop:cockpit-serve')
    expect(scope).toBeDefined()
    expect(scope!.description.length).toBeGreaterThan(10)
    expect(scope!.grants).toContain('POST /api/cockpit/agent/tasks/next')
    expect(scope!.grants).toContain('POST /api/cockpit/agent/tasks/resolve')
  })

  // #1075: serving the owner's services starts with discovering them. Without
  // this route the catalog check rejects the listing, the worker's services
  // loop sees an empty list and spins — silently, because the caller swallows
  // the error. Cost the zaz service a full day of unserved tasks.
  it('covers the service discovery its own description promises', () => {
    const scope = TROOP_SCOPES.find(s => s.id === 'troop:cockpit-serve')
    expect(scope!.description).toContain('services')
    expect(scope!.grants).toContain('GET /api/cockpit/services')
  })
})
