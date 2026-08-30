import { asc, isNull } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../database/drizzle'
import { threadMessages, threads, workspaces } from '../database/schema'
import { createProblemError } from '../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string, firma?: string, email?: string, nachricht?: string }>(event)
  const name = body?.name?.trim()
  const email = body?.email?.trim()
  const nachricht = body?.nachricht?.trim()
  if (!name || !email || !nachricht) {
    throw createProblemError({ status: 400, title: 'name, email and nachricht required' })
  }
  const db = useDb()
  const workspace = await db
    .select()
    .from(workspaces)
    .where(isNull(workspaces.archivedAt))
    .orderBy(asc(workspaces.createdAt))
    .get()
  if (!workspace) throw createProblemError({ status: 503, title: 'Kein Workspace' })
  const now = Date.now()
  const id = ulid()
  const subject = `Anfrage von ${name}${body.firma?.trim() ? ` (${body.firma.trim()})` : ''}`
  await db.insert(threads).values({
    id,
    workspaceId: workspace.id,
    dealId: null,
    subject,
    status: 'neu',
    source: 'webformular',
    createdAt: now,
  })
  await db.insert(threadMessages).values({
    id: ulid(),
    threadId: id,
    fromAddress: email,
    body: nachricht,
    createdAt: now,
  })
  setResponseStatus(event, 201)
  return { id, status: 'neu' }
})
