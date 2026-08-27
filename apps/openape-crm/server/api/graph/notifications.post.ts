import { eq } from 'drizzle-orm'
import { defineEventHandler, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { graphAccounts, workspaceMembers } from '../../database/schema'
import { listInbox } from '../../utils/graph'
import { requireGraphAccess } from '../../utils/graph-account'
import { ingestInboxMessages } from '../../utils/inbox'

interface Notification {
  clientState?: string
  resource?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ value?: Notification[] }>(event)
  const items = body?.value ?? []
  const db = useDb()
  for (const note of items) {
    if (note.clientState && note.clientState !== 'openape-crm') continue
    const accounts = await db.select().from(graphAccounts).all()
    for (const account of accounts) {
      try {
        const graph = await requireGraphAccess(account.userEmail)
        const messages = await listInbox(graph.accessToken)
        const memberships = await db
          .select({ workspaceId: workspaceMembers.workspaceId })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.userEmail, account.userEmail))
          .all()
        for (const m of memberships) {
          await ingestInboxMessages(db, {
            workspaceId: m.workspaceId,
            selfMail: graph.mail || account.mail || account.userEmail,
            messages,
          })
        }
      }
      catch {
        continue
      }
    }
  }
  return { ok: true }
})
