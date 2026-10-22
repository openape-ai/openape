import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ human: vi.fn(), initialize: vi.fn(), options: vi.fn(), view: vi.fn() }))
vi.mock('../server/vault/store', () => ({ VaultStore: class { initialize = mocked.initialize } }))
vi.mock('@libsql/client', () => ({ createClient: () => ({}) }))
vi.mock('../server/vault/service', async (actual) => {
  const original = await actual<typeof import('../server/vault/service')>()
  return { VaultError: original.VaultError, VaultService: class { human = mocked.human; setupOptions = mocked.options; view = mocked.view } }
})
vi.mock('h3', () => ({
  defineEventHandler: (fn: unknown) => fn,
  getHeader: (e: { headers: Record<string, string> }, name: string) => e.headers[name],
  getMethod: (e: { method: string }) => e.method,
  getRouterParam: (e: { path: string }) => e.path,
  readBody: async (e: { body: unknown }) => e.body,
  setHeader: vi.fn(),
  createError: (v: { statusCode: number, statusMessage: string }) => Object.assign(new Error(v.statusMessage), v),
}))
const config = { secretsVaultEnabled: true, secretsVaultOrigin: 'https://secrets.example.org', openapeSp: { sessionSecret: 'production-test-secret-of-sufficient-length' }, tursoUrl: 'file::memory:' }
const principal = { subject: 'owner', actor: 'owner', act: 'human', authentication: 'session' }
beforeEach(() => {
  vi.clearAllMocks(); vi.resetModules()
  vi.stubGlobal('useRuntimeConfig', () => ({ ...config }))
  vi.stubGlobal('requireScopedPrincipal', vi.fn(async () => principal))
  vi.stubGlobal('getSpSession', async () => ({ id: 'browser-session' }))
})
async function call(overrides = {}) {
  const handler = (await import('../server/api/v2/[...path]')).default
  return handler({ path: 'setup/options', method: 'POST', headers: { origin: config.secretsVaultOrigin }, body: {}, ...overrides } as never)
}
describe('v2 HTTP guards', () => {
  it('does not initialize a database when the rollout flag is off', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ...config, secretsVaultEnabled: false }))
    await expect(call()).rejects.toHaveProperty('statusCode', 404)
    expect(mocked.initialize).not.toHaveBeenCalled()
  })
  it('rejects cross-origin cookie writes and missing Origin', async () => {
    await expect(call({ headers: { origin: 'https://foreign.example' } })).rejects.toHaveProperty('statusCode', 403)
    await expect(call({ headers: {} })).rejects.toHaveProperty('statusCode', 403)
    expect(mocked.options).not.toHaveBeenCalled()
  })
  it('preserves the verified identity and hashes the browser session for ceremonies', async () => {
    await call()
    expect(mocked.options).toHaveBeenCalledWith(expect.objectContaining({ ...principal, session: expect.any(String) }))
    expect(mocked.options.mock.calls[0]![0].session).not.toBe('browser-session')
  })
  it('maps human-only failures to 403 instead of exposing an internal error', async () => {
    const { VaultError } = await import('../server/vault/service')
    mocked.human.mockImplementationOnce(() => { throw new VaultError(403, 'Human browser session required') })
    await expect(call()).rejects.toHaveProperty('statusCode', 403)
    expect(mocked.options).not.toHaveBeenCalled()
  })
  it('uses the existing request scope for agent endpoints', async () => {
    await expect(call({ path: 'requests/no-such-request', method: 'PATCH' })).rejects.toHaveProperty('statusCode', 404)
    expect(requireScopedPrincipal).toHaveBeenCalledWith(expect.anything(), ['secrets:request'])
  })
  it('rejects insecure production origins, development secrets and oversized bodies', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ...config, secretsVaultOrigin: 'http://localhost:3025' }))
    await expect(call()).rejects.toHaveProperty('statusCode', 503)
    vi.stubGlobal('useRuntimeConfig', () => ({ ...config, openapeSp: { sessionSecret: 'dev-secret' } }))
    await expect(call()).rejects.toHaveProperty('statusCode', 503)
    vi.stubGlobal('useRuntimeConfig', () => config)
    await expect(call({ headers: { origin: config.secretsVaultOrigin, 'content-length': '100001' } })).rejects.toHaveProperty('statusCode', 413)
  })
})
