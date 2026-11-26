// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { InfrastructureError } from '../../src/contracts/infrastructure'
import { PodIdentityRefusedError } from '../../src/main/connections/agent'
import { podIdentityFile, revocationCheckMs } from '../../src/main/connections/identity-file'

let root: string | undefined
afterEach(async () => { vi.useRealTimers(); if (root) await rm(root, { recursive: true, force: true }); root = undefined })

// Only the interval and clock are fake; each step lets the real token file write finish before the next tick.
async function tick(times = 1) {
  for (let i = 0; i < times; i++) { await vi.advanceTimersByTimeAsync(15000); await new Promise(resolve => setTimeout(resolve, 50)) }
}

async function identity(accessToken: (fresh?: boolean) => Promise<string>) {
  root = await mkdtemp(join(tmpdir(), 'pods-identity-'))
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  return podIdentityFile(root, { issuer: 'https://id.example.test', subject: 'agent@example.test', owner: 'owner@example.test', keyId: 'key', accessToken: vi.fn(accessToken) })
}

it('re-authenticates at the IdP every minute and aborts the run signal when the identity is refused', async () => {
  const calls: boolean[] = []
  const file = await identity(async (fresh = false) => {
    calls.push(fresh)
    if (fresh) throw new PodIdentityRefusedError('Pod identity refused by the IdP (401)')
    return 'token'
  })
  await tick(revocationCheckMs / 15000 - 1)
  expect(calls).toEqual([false, false, false, false])
  expect(file.signal.aborted).toBe(false)
  await tick()
  expect(calls).toEqual([false, false, false, false, true])
  expect(file.signal.aborted).toBe(true)
  expect(() => file.assertActive()).toThrow('401')
  await file.close()
})

it('keeps the run and its identity file current while the IdP is unreachable or fails otherwise', async () => {
  const failures = [new InfrastructureError({ phase: 'authorization', retryAfterMs: 0 }), Object.assign(new Error('fetch failed'), { cause: { code: 'ENETUNREACH' } }), new Error('Pod identity connection failed (400)')]
  const fresh: boolean[] = []
  const file = await identity(async (isFresh = false) => {
    if (isFresh) { fresh.push(true); throw failures[(fresh.length - 1) % failures.length] }
    return 'token'
  })
  await tick(revocationCheckMs / 15000 * 3)
  expect(fresh.length).toBeGreaterThan(3)
  expect(file.signal.aborted).toBe(false)
  expect(() => file.assertActive()).not.toThrow()
  const written = JSON.parse(await readFile(file.path, 'utf8')) as { access_token: string, expires_at: number }
  expect(written.access_token).toBe('token')
  expect(written.expires_at).toBeGreaterThan(Date.now() / 1000 + 45)
  await file.close()
})

it('rewrites the identity file while a slow IdP check is still running', async () => {
  let release: (() => void) | undefined; let cached = 'token'
  const file = await identity(async (fresh = false) => {
    if (fresh) { await new Promise<void>((resolve) => { release = resolve }); cached = 'fresh-token' }
    return cached
  })
  await tick(revocationCheckMs / 15000)
  const before = JSON.parse(await readFile(file.path, 'utf8')) as { expires_at: number }
  await tick(2)
  const during = JSON.parse(await readFile(file.path, 'utf8')) as { access_token: string, expires_at: number }
  expect(during.access_token).toBe('token')
  expect(during.expires_at).toBe(before.expires_at + 30)
  release?.(); await tick()
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toMatchObject({ access_token: 'fresh-token' })
  expect(file.secrets).toContain('fresh-token')
  await file.close()
})
