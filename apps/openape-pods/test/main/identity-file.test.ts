// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { InfrastructureError } from '../../src/contracts/infrastructure'
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
    if (fresh) throw new Error('Pod identity connection failed (401)')
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

it('keeps the run when the IdP is only temporarily unavailable for the re-check', async () => {
  const file = await identity(async (fresh = false) => {
    if (fresh) throw new InfrastructureError({ phase: 'authorization', retryAfterMs: 0 })
    return 'token'
  })
  await tick(revocationCheckMs / 15000 * 2)
  expect(file.signal.aborted).toBe(false)
  expect(() => file.assertActive()).not.toThrow()
  await file.close()
})
