import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Isolate HOME so CONFIG_DIR + LOCK_FILE resolve inside tmpdir
const testHome = join(tmpdir(), `apes-lock-${process.pid}-${Date.now()}`)

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

describe('auth-lock', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true })
    mkdirSync(join(testHome, '.config', 'apes'), { recursive: true })
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true })
  })

  it('acquires and releases a lock', async () => {
    const { acquireAuthLock, releaseAuthLock } = await import('../src/auth-lock')

    const lock = await acquireAuthLock()
    expect(lock).not.toBeNull()
    expect(existsSync(join(testHome, '.config', 'apes', 'auth.json.lock'))).toBe(true)

    await releaseAuthLock(lock!)
    expect(existsSync(join(testHome, '.config', 'apes', 'auth.json.lock'))).toBe(false)
  })

  it('serializes two concurrent acquires — second one waits for the first', async () => {
    const { acquireAuthLock, releaseAuthLock } = await import('../src/auth-lock')

    const first = await acquireAuthLock({ timeoutMs: 1000 })
    expect(first).not.toBeNull()

    // Start the second acquire in the background; it must NOT succeed until we release.
    let firstReleased = false
    let secondResolvedEarly = false
    const secondPromise = acquireAuthLock({ timeoutMs: 3000 }).then((l) => {
      secondResolvedEarly = !firstReleased
      return l
    })

    await new Promise(r => setTimeout(r, 300))
    expect(secondResolvedEarly).toBe(false)

    firstReleased = true
    await releaseAuthLock(first!)

    const second = await secondPromise
    expect(second).not.toBeNull()
    await releaseAuthLock(second!)
  })

  it('returns null on acquire timeout while another holder keeps the lock', async () => {
    const { acquireAuthLock, releaseAuthLock } = await import('../src/auth-lock')

    const first = await acquireAuthLock()
    expect(first).not.toBeNull()

    const second = await acquireAuthLock({ timeoutMs: 500 })
    expect(second).toBeNull()

    await releaseAuthLock(first!)
  })

  it('evicts a stale lock older than 30 seconds', async () => {
    const { acquireAuthLock, releaseAuthLock } = await import('../src/auth-lock')

    // Create a stale lock file manually
    const lockPath = join(testHome, '.config', 'apes', 'auth.json.lock')
    writeFileSync(lockPath, '', { mode: 0o600 })
    // Backdate it 60 seconds
    const past = new Date(Date.now() - 60_000)
    await utimes(lockPath, past, past)
    const statBefore = await stat(lockPath)
    expect(Date.now() - statBefore.mtimeMs).toBeGreaterThan(30_000)

    const fresh = await acquireAuthLock({ timeoutMs: 2000 })
    expect(fresh).not.toBeNull()
    await releaseAuthLock(fresh!)
  })
})
