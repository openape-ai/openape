// story: coder-sign-in, coder-projects (#585).
//
// Project store over the projects + project_members tables. A member's
// overview lists exactly the projects they belong to (admin or member);
// `getForMember` returns null both for "does not exist" and "not a member"
// so non-membership never leaks a project's existence.

import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { and, eq } from 'drizzle-orm'
import { projectMembers, projects } from '../database/schema'
import type { ProjectRow } from '../database/schema'
import { useDb } from '../database/drizzle'

export interface Project {
  id: string
  name: string
  visionMd: string
  repos: string[]
  createdAt: number
  updatedAt: number
}

export interface ProjectMembership {
  role: 'admin' | 'member'
  /** Scope = vision + repos. Admins always may edit; members need the explicit grant. */
  canEditScope: boolean
}

export interface ProjectStore {
  listForMember: (email: string) => Promise<Project[]>
  create: (input: { name: string, creatorEmail: string, visionMd?: string, repos?: string[] }) => Promise<Project>
  /** Returns null for "does not exist" and "not a member" alike — no existence leak. */
  getForMember: (id: string, email: string) => Promise<Project | null>
  getMembership: (id: string, email: string) => Promise<ProjectMembership | null>
  addMember: (id: string, email: string, membership: { role: ProjectMembership['role'], canEditScope?: boolean }) => Promise<void>
  updateScope: (id: string, patch: Partial<Pick<Project, 'visionMd' | 'repos'>>) => Promise<Project>
}

type Db = LibSQLDatabase<Record<string, never>>

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    visionMd: row.visionMd,
    repos: JSON.parse(row.repos) as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** `editScope` is the per-member capability that unlocks vision/repos editing. */
function capabilitiesAllowScope(role: string, capabilities: string[]): boolean {
  return role === 'admin' || capabilities.includes('editScope')
}

export function createProjectStore(db: Db): ProjectStore {
  async function getRow(id: string): Promise<ProjectRow | null> {
    const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
    return rows[0] ?? null
  }

  return {
    async listForMember(email) {
      const rows = await db
        .select({ project: projects })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(eq(projectMembers.email, email))
      return rows.map(r => rowToProject(r.project))
    },

    async create({ name, creatorEmail, visionMd = '', repos = [] }) {
      const now = Date.now()
      const id = crypto.randomUUID()
      await db.insert(projects).values({
        id,
        name,
        visionMd,
        repos: JSON.stringify(repos),
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(projectMembers).values({
        projectId: id,
        email: creatorEmail,
        role: 'admin',
        capabilities: '[]',
        joinedAt: now,
      })
      return { id, name, visionMd, repos, createdAt: now, updatedAt: now }
    },

    async getForMember(id, email) {
      const membership = await this.getMembership(id, email)
      if (!membership) return null
      const row = await getRow(id)
      return row ? rowToProject(row) : null
    },

    async getMembership(id, email) {
      const rows = await db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, id), eq(projectMembers.email, email)))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      const capabilities = JSON.parse(row.capabilities) as string[]
      return { role: row.role, canEditScope: capabilitiesAllowScope(row.role, capabilities) }
    },

    async addMember(id, email, membership) {
      const capabilities = membership.canEditScope ? ['editScope'] : []
      await db.insert(projectMembers).values({
        projectId: id,
        email,
        role: membership.role,
        capabilities: JSON.stringify(capabilities),
        joinedAt: Date.now(),
      })
    },

    async updateScope(id, patch) {
      const set: Partial<ProjectRow> = { updatedAt: Date.now() }
      if (patch.visionMd !== undefined) set.visionMd = patch.visionMd
      if (patch.repos !== undefined) set.repos = JSON.stringify(patch.repos)
      await db.update(projects).set(set).where(eq(projects.id, id))
      const row = await getRow(id)
      if (!row) throw createError({ statusCode: 404, statusMessage: 'project not found' })
      return rowToProject(row)
    },
  }
}

export function useProjectStore(): ProjectStore {
  return createProjectStore(useDb() as unknown as Db)
}
