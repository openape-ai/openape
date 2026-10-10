import type { OpenApeGrant } from '@openape/core'
import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/database/schema'
import { createGrantNotificationQueue, notifyPendingGrants } from '../server/utils/grant-notifications'

const WINDOW_MS = 60_000
const T0 = 1_000_000

function grant(id: string, overrides: Partial<OpenApeGrant> = {}): OpenApeGrant {
  return {
    id,
    status: 'pending',
    type: 'command',
    created_at: T0 / 1000,
    request: { requester: 'pods@example.test', target_host: 'h', audience: 'ape-shell', grant_type: 'once', command: ['git', 'status'] },
    ...overrides,
  } as OpenApeGrant
}

let directory: string
let url: string
const clients: Client[] = []

/** A fresh connection to the same file stands in for the IdP after a restart. */
async function connect() {
  const client = createClient({ url })
  clients.push(client)
  const db = drizzle(client, { schema })
  return createGrantNotificationQueue(db, WINDOW_MS)
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'idp-grant-notifications-'))
  url = `file:${join(directory, 'idp.sqlite')}`
  const client = createClient({ url })
  clients.push(client)
  const db = drizzle(client, { schema })
  vi.doMock('../server/database/drizzle', () => ({ useDb: () => db }))
  vi.doMock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ tursoUrl: url }) }))
  vi.stubEnv('OPENAPE_E2E', '0')
  vi.stubGlobal('defineNitroPlugin', (initialize: () => Promise<void>) => initialize())
  // The production startup DDL, so schema and table cannot drift apart.
  await (await import('../server/plugins/02.database')).default
})

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.doUnmock('../server/database/drizzle'); vi.doUnmock('nitropack/runtime'); vi.resetModules()
  rmSync(directory, { recursive: true, force: true })
})

describe('grant notification quiet window', () => {
  it('announces nothing for a grant approved within the window', async () => {
    const queue = await connect()
    const grants = new Map([['g', grant('g')]])
    await queue.enqueue(grants.get('g')!, T0)
    grants.set('g', grant('g', { status: 'approved', decided_by: 'owner@example.test' }))

    expect(await queue.sweep(async id => grants.get(id) ?? null, T0 + WINDOW_MS)).toEqual([])
  })

  it('announces nothing for a grant denied or revoked within the window', async () => {
    const queue = await connect()
    const grants = new Map([['d', grant('d')], ['r', grant('r')]])
    await queue.enqueue(grants.get('d')!, T0)
    await queue.enqueue(grants.get('r')!, T0)
    grants.set('d', grant('d', { status: 'denied' }))
    grants.set('r', grant('r', { status: 'revoked' }))

    expect(await queue.sweep(async id => grants.get(id) ?? null, T0 + WINDOW_MS)).toEqual([])
  })

  it('announces a grant still pending after the window exactly once', async () => {
    const queue = await connect()
    const pending = grant('p')
    const find = async () => pending
    await queue.enqueue(pending, T0)
    await queue.enqueue(pending, T0 + 5_000)

    expect(await queue.sweep(find, T0 + WINDOW_MS - 1)).toEqual([])
    expect(await queue.sweep(find, T0 + WINDOW_MS)).toEqual([pending])
    expect(await queue.sweep(find, T0 + 10 * WINDOW_MS)).toEqual([])
  })

  it('still announces once when the IdP restarts inside the window', async () => {
    const pending = grant('p')
    await (await connect()).enqueue(pending, T0)
    clients.splice(0).forEach(client => client.close())

    const restarted = await connect()
    expect(await restarted.sweep(async () => pending, T0 + WINDOW_MS)).toEqual([pending])
    expect(await restarted.sweep(async () => pending, T0 + 2 * WINDOW_MS)).toEqual([])
  })

  it('sends one notification per approver for grants that fall due together', async () => {
    const channel = vi.fn(async () => {})
    const first = grant('a1', { created_at: 1 })
    const second = grant('a2', { created_at: 2 })
    const other = grant('b1', { request: { ...first.request, requester: 'other@example.test' } })
    const approvers: Record<string, string> = { 'pods@example.test': 'owner@example.test', 'other@example.test': 'someone@example.test' }

    await notifyPendingGrants([second, other, first], { approverOf: async g => approvers[g.request.requester]!, channels: [channel] })

    expect(channel).toHaveBeenCalledTimes(2)
    expect(channel).toHaveBeenCalledWith(first, 2)
    expect(channel).toHaveBeenCalledWith(other, 1)
  })

  it('keeps the other channels running when one fails', async () => {
    const failing = vi.fn(async () => { throw new Error('mail down') })
    const working = vi.fn(async () => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await notifyPendingGrants([grant('p')], { approverOf: async () => 'owner@example.test', channels: [failing, working] })

    expect(working).toHaveBeenCalledOnce()
  })
})
