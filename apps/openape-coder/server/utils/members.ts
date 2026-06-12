// story: coder-invite-members (#585).
//
// Permission model (v1): a member's base right is read-only. Each writable
// capability is an explicit, per-member grant an admin toggles. Admins always
// hold every capability implicitly. `act:'human'` is enforced for inviting and
// permission changes — agent tokens may never administer a project.

import type { H3Event } from 'h3'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { and, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm'
import { invites, projectMembers, projects } from '../database/schema'
import { createAuditLog } from './audit'
import { resolveCaller } from './auth'
import { useDb } from '../database/drizzle'

/** Per-member, individually toggleable write capabilities. Read is the base right (not listed). */
export type WriteCapability = 'editScope' | 'writeStories'

export const WRITE_CAPABILITIES: readonly WriteCapability[] = ['editScope', 'writeStories']

export interface Membership {
  projectId: string
  email: string
  role: 'admin' | 'member'
  /** Granted write capabilities. Empty for a freshly invited member (read-only base right). */
  capabilities: WriteCapability[]
}

export interface Invite {
  projectId: string
  email: string
  invitedBy: string
  createdAt: number
  /** Set once the invited identity signs in and the membership is realised. */
  acceptedAt: number | null
}

/** One "you were added to a project" notification in a member's inbox. */
export interface InboxNotification {
  projectId: string
  projectName: string
  /** The admin who added this member. */
  invitedBy: string
  /** When the membership was realised (= when it landed in the inbox). */
  at: number
}

export interface MembershipStore {
  invite: (input: { projectId: string, email: string, invitedBy: string }) => Promise<Invite>
  acceptInvite: (projectId: string, email: string) => Promise<Membership>
  /** Realises every pending invite of an identity into a membership — run on first sign-in. */
  acceptPendingInvites: (email: string) => Promise<void>
  getMembership: (projectId: string, email: string) => Promise<Membership | null>
  /** Every member of a project (admins + members) with their role and grants. */
  list: (projectId: string) => Promise<Membership[]>
  /** Accepted-but-undismissed "you were added" notifications for a member, newest first. */
  listInbox: (email: string) => Promise<InboxNotification[]>
  /** Dismisses a member's inbox notification for a project so it does not recur. */
  markInboxSeen: (projectId: string, email: string) => Promise<void>
  hasCapability: (projectId: string, email: string, capability: WriteCapability) => Promise<boolean>
  setCapability: (input: {
    projectId: string
    email: string
    capability: WriteCapability
    granted: boolean
    actorEmail: string
  }) => Promise<Membership>
}

/** Maximum invites a single inviter may send inside {@link INVITE_RATE_WINDOW_MS} before being throttled. */
export const INVITE_RATE_LIMIT = 10
export const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000

type Db = LibSQLDatabase<Record<string, never>>

function rowToMembership(row: typeof projectMembers.$inferSelect): Membership {
  return {
    projectId: row.projectId,
    email: row.email,
    role: row.role,
    capabilities: JSON.parse(row.capabilities) as WriteCapability[],
  }
}

export function createMembershipStore(db: Db): MembershipStore {
  const audit = createAuditLog(db)

  async function loadMembership(projectId: string, email: string): Promise<Membership | null> {
    const rows = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.email, email)))
      .limit(1)
    const row = rows[0]
    return row ? rowToMembership(row) : null
  }

  return {
    async invite({ projectId, email, invitedBy }) {
      const windowStart = Date.now() - INVITE_RATE_WINDOW_MS
      const recent = await db
        .select()
        .from(invites)
        .where(and(eq(invites.invitedBy, invitedBy), gte(invites.createdAt, windowStart)))
      if (recent.length >= INVITE_RATE_LIMIT) {
        throw createError({ statusCode: 429, statusMessage: 'Too many invitations — please wait before sending more' })
      }

      const createdAt = Date.now()
      await db
        .insert(invites)
        .values({ projectId, email, invitedBy, createdAt, acceptedAt: null })
        .onConflictDoUpdate({
          target: [invites.projectId, invites.email],
          set: { invitedBy, createdAt },
        })
      return { projectId, email, invitedBy, createdAt, acceptedAt: null }
    },

    async acceptInvite(projectId, email) {
      const now = Date.now()
      await db
        .update(invites)
        .set({ acceptedAt: now })
        .where(and(eq(invites.projectId, projectId), eq(invites.email, email)))
      await db
        .insert(projectMembers)
        .values({ projectId, email, role: 'member', capabilities: '[]', joinedAt: now })
        .onConflictDoNothing()
      const membership = await loadMembership(projectId, email)
      if (!membership) throw createError({ statusCode: 500, statusMessage: 'membership not realised' })
      return membership
    },

    async acceptPendingInvites(email) {
      const pending = await db
        .select()
        .from(invites)
        .where(and(eq(invites.email, email), isNull(invites.acceptedAt)))
      for (const row of pending) {
        await this.acceptInvite(row.projectId, email)
      }
    },

    getMembership(projectId, email) {
      return loadMembership(projectId, email)
    },

    async list(projectId) {
      const rows = await db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.projectId, projectId))
      return rows.map(rowToMembership)
    },

    async listInbox(email) {
      const rows = await db
        .select({
          projectId: invites.projectId,
          projectName: projects.name,
          invitedBy: invites.invitedBy,
          at: invites.acceptedAt,
        })
        .from(invites)
        .innerJoin(projects, eq(invites.projectId, projects.id))
        .where(and(eq(invites.email, email), isNotNull(invites.acceptedAt), isNull(invites.seenAt)))
        .orderBy(desc(invites.acceptedAt))
      return rows.map(r => ({
        projectId: r.projectId,
        projectName: r.projectName,
        invitedBy: r.invitedBy,
        at: r.at ?? 0,
      }))
    },

    async markInboxSeen(projectId, email) {
      await db
        .update(invites)
        .set({ seenAt: Date.now() })
        .where(and(eq(invites.projectId, projectId), eq(invites.email, email)))
    },

    async hasCapability(projectId, email, capability) {
      const membership = await loadMembership(projectId, email)
      if (!membership) return false
      return membership.role === 'admin' || membership.capabilities.includes(capability)
    },

    async setCapability({ projectId, email, capability, granted, actorEmail }) {
      const membership = await loadMembership(projectId, email)
      if (!membership) throw createError({ statusCode: 404, statusMessage: 'member not found' })

      const next = new Set(membership.capabilities)
      if (granted) next.add(capability)
      else next.delete(capability)

      await db
        .update(projectMembers)
        .set({ capabilities: JSON.stringify([...next]) })
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.email, email)))

      await audit.record({
        projectId,
        action: granted ? 'capability.grant' : 'capability.revoke',
        actorEmail,
        subject: email,
        detail: capability,
      })

      const updated = await loadMembership(projectId, email)
      if (!updated) throw createError({ statusCode: 500, statusMessage: 'membership lost' })
      return updated
    },
  }
}

export function useMembershipStore(): MembershipStore {
  return createMembershipStore(useDb() as unknown as Db)
}

export interface HumanCaller {
  email: string
  act: 'human'
}

/**
 * Resolves the signed-in caller and asserts a human session. Inviting and
 * permission changes are humans-only (criterion 5); an agent token (act!='human')
 * is rejected with 403 before any store mutation runs.
 */
export async function requireHuman(event: H3Event): Promise<HumanCaller> {
  const caller = await resolveCaller(event)
  if (caller.act !== 'human') {
    throw createError({ statusCode: 403, statusMessage: 'Human session required' })
  }
  return { email: caller.email, act: 'human' }
}
