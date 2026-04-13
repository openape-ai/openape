import type { AuthData } from '../src/config.js'
import type { PtyBridge } from '../src/shell/pty-bridge.js'
import type { MetaDeps } from '../src/shell/meta-commands.js'
import type { ShellSession } from '../src/shell/session.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMetaCommandHandler } from '../src/shell/meta-commands.js'

/**
 * Build a MetaDeps fixture with default-happy values plus any overrides the
 * test needs. Captured `writes` array contains every string the handler
 * emitted via `deps.write`, in order.
 */
function buildDeps(overrides: Partial<MetaDeps> = {}): {
  deps: MetaDeps
  writes: string[]
  output: () => string
  resetBridge: ReturnType<typeof vi.fn>
  bridge: { pid: number, kill: ReturnType<typeof vi.fn> }
} {
  const writes: string[] = []
  const bridge = { pid: 12345, kill: vi.fn() }
  const resetBridge = vi.fn(async () => {
    bridge.pid = 67890
  })
  const session = {
    id: 'fake-session',
    startedAt: Date.now() - 60_000,
  } as unknown as ShellSession
  const auth: AuthData = {
    idp: 'https://id.openape.at',
    access_token: 'token',
    email: 'alice@example.com',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }

  const deps: MetaDeps = {
    getBridge: () => bridge as unknown as PtyBridge,
    resetBridge,
    session,
    getAuth: () => auth,
    targetHost: 'lappy.local',
    isPending: () => false,
    write: (s) => { writes.push(s) },
    ...overrides,
  }

  return {
    deps,
    writes,
    output: () => writes.join(''),
    resetBridge,
    bridge,
  }
}

describe('createMetaCommandHandler', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it(':help lists available meta-commands', async () => {
    const { deps, output } = buildDeps()
    const handler = createMetaCommandHandler(deps)
    const handled = await handler(':help')
    expect(handled).toBe(true)
    const text = output()
    expect(text).toContain(':help')
    expect(text).toContain(':status')
    expect(text).toContain(':reset')
  })

  it(':status with valid auth prints session, bash, host, email, IdP, valid until', async () => {
    const { deps, output } = buildDeps()
    const handler = createMetaCommandHandler(deps)
    await handler(':status')
    const text = output()
    expect(text).toContain('fake-session')
    expect(text).toContain('pid 12345')
    expect(text).toContain('lappy.local')
    expect(text).toContain('alice@example.com')
    expect(text).toContain('https://id.openape.at')
    expect(text).toContain('valid until')
  })

  it(':status with expired auth prints EXPIRED', async () => {
    const { deps, output } = buildDeps({
      getAuth: () => ({
        idp: 'https://id.openape.at',
        access_token: 'token',
        email: 'alice@example.com',
        expires_at: Math.floor(Date.now() / 1000) - 120,
      }),
    })
    const handler = createMetaCommandHandler(deps)
    await handler(':status')
    expect(output()).toContain('EXPIRED')
  })

  it(':status with missing auth does not throw and indicates logged-out state', async () => {
    const { deps, output } = buildDeps({ getAuth: () => null })
    const handler = createMetaCommandHandler(deps)
    await expect(handler(':status')).resolves.toBe(true)
    expect(output().toLowerCase()).toContain('not logged in')
  })

  it(':reset when not pending calls resetBridge and prints new pid', async () => {
    const { deps, output, resetBridge } = buildDeps()
    const handler = createMetaCommandHandler(deps)
    const handled = await handler(':reset')
    expect(handled).toBe(true)
    expect(resetBridge).toHaveBeenCalledOnce()
    expect(output()).toContain('Bash reset')
    expect(output()).toContain('67890')
  })

  it(':reset while pending refuses and does not call resetBridge', async () => {
    const { deps, output, resetBridge } = buildDeps({ isPending: () => true })
    const handler = createMetaCommandHandler(deps)
    const handled = await handler(':reset')
    expect(handled).toBe(true)
    expect(resetBridge).not.toHaveBeenCalled()
    expect(output()).toContain('Cannot reset while a command is running')
  })

  it('unknown meta-command prints a helpful message and returns true', async () => {
    const { deps, output } = buildDeps()
    const handler = createMetaCommandHandler(deps)
    const handled = await handler(':bogus')
    expect(handled).toBe(true)
    expect(output()).toContain('Unknown meta-command')
    expect(output()).toContain(':bogus')
  })
})
