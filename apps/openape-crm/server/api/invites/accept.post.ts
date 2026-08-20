import { and, eq, sql } from 'drizzle-orm'
import { defineEventHandler, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { workspaceInvites, workspaceMembers, workspaces } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { resolveRole } from '../../utils/workspace-access'

/** POST /api/invites/accept — Einladung einlösen. Body: { token: string } */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ token?: string }>(event)
  const token = body?.token?.trim()
  if (!token) throw createProblemError({ status: 400, title: 'token required' })

  const db = useDb()
  const invite = await db.select().from(workspaceInvites).where(eq(workspaceInvites.token, token)).get()
  if (!invite) throw createProblemError({ status: 404, title: 'invite not found' })

  const now = Date.now()
  if (invite.revokedAt) throw createProblemError({ status: 410, title: 'invite revoked' })
  if (invite.expiresAt < now) throw createProblemError({ status: 410, title: 'invite expired' })
  if (invite.usedCount >= invite.maxUses) throw createProblemError({ status: 410, title: 'invite exhausted' })

  const workspace = await db.select().from(workspaces).where(eq(workspaces.id, invite.workspaceId)).get()
  if (!workspace) throw createProblemError({ status: 404, title: 'workspace not found' })

  const existing = await resolveRole(db, invite.workspaceId, caller.email)
  if (existing) return { workspace_id: workspace.id, name: workspace.name, role: existing, already_member: true }

  await db.insert(workspaceMembers).values({
    workspaceId: invite.workspaceId,
    userEmail: caller.email,
    role: invite.grantRole,
    joinedAt: now,
  })
  await db
    .update(workspaceInvites)
    .set({ usedCount: sql`${workspaceInvites.usedCount} + 1` })
    .where(and(eq(workspaceInvites.id, invite.id), eq(workspaceInvites.token, token)))

  return { workspace_id: workspace.id, name: workspace.name, role: invite.grantRole, already_member: false }
})
