import type { useDb } from '../database/drizzle'
import { and, eq } from 'drizzle-orm'
import { workspaceMembers } from '../database/schema'
import { createProblemError } from './problem'

export type Role = 'owner' | 'manager' | 'member'

const RANK: Record<Role, number> = { member: 1, manager: 2, owner: 3 }

/** Reicht `role` für die geforderte Mindestrolle? Nicht-Mitglied = nein. */
export function atLeast(role: Role | undefined, min: Role): boolean {
  return role !== undefined && RANK[role] >= RANK[min]
}

type Db = ReturnType<typeof useDb>

export async function resolveRole(db: Db, workspaceId: string, email: string): Promise<Role | undefined> {
  const row = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userEmail, email)))
    .get()
  return row?.role
}

/**
 * Der einzige Weg, an einen Workspace zu kommen: Mitgliedschaft aus der DB,
 * niemals eine Angabe aus dem Request-Body. Ohne Mitgliedschaft antwortet die
 * API mit 404 — ein Fremder erfährt nicht, ob es den Workspace gibt.
 */
export async function requireRole(db: Db, workspaceId: string, email: string, min: Role = 'member'): Promise<Role> {
  const role = await resolveRole(db, workspaceId, email)
  if (!role) throw createProblemError({ status: 404, title: 'workspace not found' })
  if (!atLeast(role, min)) {
    throw createProblemError({ status: 403, title: 'insufficient role', detail: `requires ${min}` })
  }
  return role
}
