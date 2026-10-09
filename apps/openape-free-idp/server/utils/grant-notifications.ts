import type { OpenApeGrant } from '@openape/core'
import { lte } from 'drizzle-orm'
import type { useDb } from '../database/drizzle'
import { grantNotifications } from '../database/schema'

/*
 * Owner notifications for pending grants wait out a quiet window (#1455).
 * During an owner's Codex session Pods requests a grant and the session
 * approves it with the owner identity a moment later; announcing each of
 * those by push, mail and Telegram would notify the owner continuously about
 * decisions already taken. Only grants still pending after the window are
 * announced, re-read from the grant store right before sending.
 */

/** How often due entries are claimed; the window itself is runtime config. */
export const GRANT_NOTIFICATION_SWEEP_MS = 10_000

/** One delivery channel (push, mail, Telegram). `waiting` counts the due grants of the same approver. */
export type GrantNotificationChannel = (grant: OpenApeGrant, waiting: number) => Promise<void>

const channels: GrantNotificationChannel[] = []

/** Register a delivery channel. Called once per channel from a Nitro plugin. */
export function defineGrantNotificationChannel(channel: GrantNotificationChannel): void {
  channels.push(channel)
}

export function isAwaitingOwner(grant: OpenApeGrant | null): grant is OpenApeGrant {
  return grant?.status === 'pending' && !grant.auto_approval_kind
}

export interface NotifyPendingGrantsDeps {
  approverOf: (grant: OpenApeGrant) => Promise<string | null>
  channels?: GrantNotificationChannel[]
}

/**
 * One notification per approver: the oldest due grant represents the group
 * and `waiting` tells the channel how many it stands for. A failing channel
 * is logged and never silences the others.
 */
export async function notifyPendingGrants(grants: OpenApeGrant[], deps: NotifyPendingGrantsDeps): Promise<void> {
  const ordered = [...grants].sort((a, b) => a.created_at - b.created_at)
  const approvers = await Promise.all(ordered.map(grant => deps.approverOf(grant)))
  const groups = new Map<string, OpenApeGrant[]>()
  ordered.forEach((grant, index) => {
    const key = approvers[index] ?? `grant:${grant.id}`
    groups.set(key, [...groups.get(key) ?? [], grant])
  })
  const run = deps.channels ?? channels
  await Promise.all([...groups.values()].flatMap(([first, ...rest]) => run.map(async (channel) => {
    try {
      await channel(first!, rest.length + 1)
    }
    catch (err) {
      console.error('[grant-notifications] channel failed:', err)
    }
  })))
}

type Database = Pick<ReturnType<typeof useDb>, 'insert' | 'delete'>

export interface GrantNotificationQueue {
  /** Schedules the announcement of a freshly pending grant. */
  enqueue: (grant: OpenApeGrant, now?: number) => Promise<void>
  /** Claims every due entry and returns the grants that still await the owner. */
  sweep: (findGrant: (id: string) => Promise<OpenApeGrant | null>, now?: number) => Promise<OpenApeGrant[]>
}

/**
 * Entries live in the database, so a restart inside the window still
 * announces a grant that stays pending. Claiming deletes the entry in one
 * statement: each grant is announced at most once, even by overlapping sweeps.
 */
export function createGrantNotificationQueue(db: Database, delayMs: number): GrantNotificationQueue {
  return {
    async enqueue(grant, now = Date.now()) {
      await db.insert(grantNotifications)
        .values({ grantId: grant.id, notifyAfter: now + delayMs })
        .onConflictDoNothing()
    },
    async sweep(findGrant, now = Date.now()) {
      const due = await db.delete(grantNotifications)
        .where(lte(grantNotifications.notifyAfter, now))
        .returning({ grantId: grantNotifications.grantId })
      const grants = await Promise.all(due.map(entry => findGrant(entry.grantId)))
      return grants.filter(isAwaitingOwner)
    },
  }
}
