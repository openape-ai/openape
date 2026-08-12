// A QR-transferred session lives on a machine the user does not control.
// getAppSession is the chokepoint every handler goes through, so this is
// where its two extra constraints are enforced: the shortened expiry, and
// the server-side record whose deletion revokes the kiosk remotely.

import { createStorage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: { storageKey: 'idp', sessionSecret: 's'.repeat(32) },
    openapeGrants: { storageKey: 'grants' },
  }),
  useEvent: () => undefined,
  useStorage: (key: string) => {
    if (!storages.has(key)) storages.set(key, createStorage())
    return storages.get(key)!
  },
}))

let sessionData: Record<string, unknown> = {}

vi.mock('h3', () => ({
  useSession: async () => ({
    data: sessionData,
    update: async (data: Record<string, unknown>) => Object.assign(sessionData, data),
    clear: async () => {
      for (const key of Object.keys(sessionData)) delete sessionData[key]
    },
  }),
}))

const CHANNEL = 'c'.repeat(64)

async function getSession() {
  const { getAppSession } = await import('../src/runtime/server/utils/session')
  return getAppSession({} as any)
}

function grantStorage() {
  if (!storages.has('grants')) storages.set('grants', createStorage())
  return storages.get('grants')!
}

describe('qr session enforcement', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
    vi.restoreAllMocks()
    sessionData = {
      userId: 'human@example.com',
      qrChannelId: CHANNEL,
      qrExpiresAt: Date.now() + 60_000,
    }
  })

  it('keeps a live QR session intact', async () => {
    await grantStorage().setItem(`qr-session:${CHANNEL}`, { userId: 'human@example.com' })
    const session = await getSession()
    expect(session.data.userId).toBe('human@example.com')
  })

  it('clears the session once its shortened expiry passed', async () => {
    await grantStorage().setItem(`qr-session:${CHANNEL}`, { userId: 'human@example.com' })
    sessionData.qrExpiresAt = Date.now() - 1
    const session = await getSession()
    expect(session.data).toEqual({})
  })

  it('clears the session when the record was revoked from another device', async () => {
    const session = await getSession()
    expect(session.data).toEqual({})
  })

  it('leaves ordinary sessions alone without a storage lookup', async () => {
    sessionData = { userId: 'human@example.com' }
    const session = await getSession()
    expect(session.data).toEqual({ userId: 'human@example.com' })
  })
})
