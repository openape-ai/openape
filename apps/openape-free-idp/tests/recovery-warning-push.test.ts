// story: recovery-broadcast
//
// Criteria 1 + 5 at the push-util level: the warning push fans out to EVERY
// subscribed device of the owner, and the payload carries warning + cancel
// only — never a link that could complete the recovery.
//
// Pins the util surface for the green phase:
//   `sendRecoveryWarningPush(email, { cancelUrl })` in server/utils/push.ts
//   (same DB-owning pattern as notifyApproverOfPendingGrant)

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/database/schema'

const EMAIL = 'owner@example.com'
const CANCEL_URL = 'https://id.openape.test/recover/cancel?token=rec-1'

const { sendNotificationMock, dbRef } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(async () => {}),
  dbRef: { db: undefined as unknown },
}))

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: any[]) => sendNotificationMock(...args),
  },
}))

vi.mock('../server/database/drizzle', () => ({
  useDb: () => dbRef.db,
}))

beforeEach(async () => {
  sendNotificationMock.mockClear()
  const db = drizzle(createClient({ url: ':memory:' }), { schema })
  await db.run(sql`CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  await db.insert(schema.pushSubscriptions).values([
    { endpoint: 'https://push.example/phone', userEmail: EMAIL, p256dh: 'p1', auth: 'a1', createdAt: 1 },
    { endpoint: 'https://push.example/laptop', userEmail: EMAIL, p256dh: 'p2', auth: 'a2', createdAt: 2 },
    { endpoint: 'https://push.example/stranger', userEmail: 'other@example.com', p256dh: 'p3', auth: 'a3', createdAt: 3 },
  ])
  dbRef.db = db
  vi.stubGlobal('useRuntimeConfig', () => ({
    public: { vapidPublicKey: 'test-public-key' },
    vapidPrivateKey: 'test-private-key',
    vapidSubject: 'mailto:ops@openape.ai',
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function importWarningPush() {
  const pushUtils = await import('../server/utils/push') as Record<string, unknown>
  const sendRecoveryWarningPush = pushUtils.sendRecoveryWarningPush
  expect(typeof sendRecoveryWarningPush, 'push util must export sendRecoveryWarningPush(email, { cancelUrl })').toBe('function')
  return sendRecoveryWarningPush as (email: string, opts: { cancelUrl: string }) => Promise<void>
}

describe('recovery warning push fan-out (issue #462)', () => {
  // story: recovery-broadcast — criterion 1
  it('delivers the warning to every subscribed device of the owner', async () => {
    const sendRecoveryWarningPush = await importWarningPush()
    await sendRecoveryWarningPush(EMAIL, { cancelUrl: CANCEL_URL })

    expect(sendNotificationMock).toHaveBeenCalledTimes(2)
    const endpoints = sendNotificationMock.mock.calls.map(call => (call[0] as { endpoint: string }).endpoint)
    expect(endpoints.sort()).toEqual(['https://push.example/laptop', 'https://push.example/phone'])
  })

  // story: recovery-broadcast — criterion 5
  it('push payload carries the one-tap cancel but no completion link', async () => {
    const sendRecoveryWarningPush = await importWarningPush()
    await sendRecoveryWarningPush(EMAIL, { cancelUrl: CANCEL_URL })

    expect(sendNotificationMock).toHaveBeenCalled()
    for (const call of sendNotificationMock.mock.calls) {
      const payload = String(call[1])
      expect(payload).toContain('/recover/cancel?token=')
      expect(payload).not.toContain('/recover?token=')
    }
  })
})
