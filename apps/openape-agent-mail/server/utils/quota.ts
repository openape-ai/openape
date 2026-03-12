import { asc, eq, inArray, sql } from 'drizzle-orm'
import { useDb } from './db'
import { mailboxes, messages } from '../database/schema'

export async function updateQuota(mailboxId: string, addedBytes: number) {
  const db = useDb()

  await db
    .update(mailboxes)
    .set({
      totalSizeBytes: sql`${mailboxes.totalSizeBytes} + ${addedBytes}`,
      messageCount: sql`${mailboxes.messageCount} + 1`,
    })
    .where(eq(mailboxes.id, mailboxId))
}

export async function reduceQuota(mailboxId: string, removedBytes: number) {
  const db = useDb()

  await db
    .update(mailboxes)
    .set({
      totalSizeBytes: sql`MAX(0, ${mailboxes.totalSizeBytes} - ${removedBytes})`,
      messageCount: sql`MAX(0, ${mailboxes.messageCount} - 1)`,
    })
    .where(eq(mailboxes.id, mailboxId))
}

export async function enforceQuota(mailboxId: string) {
  const db = useDb()

  const mailbox = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.id, mailboxId))
    .get()

  if (!mailbox) return
  if ((mailbox.totalSizeBytes ?? 0) <= mailbox.softCapBytes) return

  // Delete oldest messages until under cap
  let currentSize = mailbox.totalSizeBytes ?? 0

  const oldMessages = await db
    .select({ id: messages.id, sizeBytes: messages.sizeBytes })
    .from(messages)
    .where(eq(messages.mailboxId, mailboxId))
    .orderBy(asc(messages.createdAt))
    .all()

  const toDelete: string[] = []
  for (const msg of oldMessages) {
    if (currentSize <= mailbox.softCapBytes) break
    toDelete.push(msg.id)
    currentSize -= msg.sizeBytes
  }

  if (toDelete.length > 0) {
    await db.delete(messages).where(inArray(messages.id, toDelete))

    // Recalculate totals from actual data
    const totals = await db
      .select({
        totalSize: sql<number>`COALESCE(SUM(${messages.sizeBytes}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(messages)
      .where(eq(messages.mailboxId, mailboxId))
      .get()

    await db
      .update(mailboxes)
      .set({
        totalSizeBytes: totals?.totalSize ?? 0,
        messageCount: totals?.count ?? 0,
      })
      .where(eq(mailboxes.id, mailboxId))
  }
}
