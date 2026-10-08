import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

function worker(count: unknown = 3, status = 200, supported = true) {
  const handlers = new Map<string, (event: unknown) => void>()
  const setAppBadge = vi.fn(async (_count: number) => {})
  const clearAppBadge = vi.fn(async () => {})
  const showNotification = vi.fn(async () => {})
  const fetch = vi.fn(async () => new Response(JSON.stringify({ count }), { status }))
  const error = vi.fn()
  runInNewContext(readFileSync(new URL('../public/inbox/sw.js', import.meta.url), 'utf8'), {
    addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    navigator: supported ? { setAppBadge, clearAppBadge } : {},
    registration: { showNotification },
    fetch, console: { error },
  })
  async function push() {
    let pending: Promise<unknown> | undefined
    handlers.get('push')!({ data: { json: () => ({ notification: { title: 'New decision' } }) }, waitUntil: (value: Promise<unknown>) => { pending = value } })
    await pending
  }
  return { push, setAppBadge, clearAppBadge, showNotification, fetch, error }
}

it('shows the notification and sets the current account total, including a zero clear', async () => {
  const app = worker(7)
  await app.push()
  expect(app.showNotification).toHaveBeenCalledWith('New decision', expect.any(Object))
  expect(app.fetch).toHaveBeenCalledWith('/inbox/api/v1/badge', { credentials: 'same-origin', cache: 'no-store' })
  expect(app.setAppBadge).toHaveBeenCalledWith(7)
  const empty = worker(0)
  await empty.push()
  expect(empty.clearAppBadge).toHaveBeenCalledOnce()
})

it('clears for a revoked session and preserves notifications when badging is unavailable', async () => {
  const revoked = worker(0, 401)
  await revoked.push()
  expect(revoked.clearAppBadge).toHaveBeenCalledOnce()
  const unsupported = worker(1, 200, false)
  await unsupported.push()
  expect(unsupported.fetch).not.toHaveBeenCalled()
  expect(unsupported.showNotification).toHaveBeenCalledOnce()
})

it.each([[3, 503], ['wrong', 200], [-1, 200]])('keeps the previous badge and visible push when the count fails: %s/%s', async (count, status) => {
  const app = worker(count, Number(status))
  await app.push()
  expect(app.setAppBadge).not.toHaveBeenCalled()
  expect(app.clearAppBadge).not.toHaveBeenCalled()
  expect(app.showNotification).toHaveBeenCalledOnce()
  expect(app.error).toHaveBeenCalledOnce()
})
