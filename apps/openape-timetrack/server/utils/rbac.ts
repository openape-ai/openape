import { and, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { companyMembers, projectMembers, projects } from '../database/schema'
import type { CompanyRole, ProjectRole } from './visibility'

type Db = ReturnType<typeof useDb>

export async function resolveCompanyRole(
  db: Db,
  companyId: string,
  email: string,
): Promise<CompanyRole | undefined> {
  const row = await db
    .select({ role: companyMembers.role })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userEmail, email)))
    .get()
  return row?.role
}

export async function resolveProjectRole(
  db: Db,
  projectId: string,
  email: string,
): Promise<ProjectRole | undefined> {
  const row = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userEmail, email)))
    .get()
  return row?.role
}

export interface ProjectContext {
  companyId: string
  companyRole?: CompanyRole
  projectRole?: ProjectRole
}

/**
 * Resolve both the company- and project-role of `email` for the given
 * project (loads the project's company first). Returns null if the project
 * does not exist.
 */
export async function resolveProjectContext(
  db: Db,
  projectId: string,
  email: string,
): Promise<ProjectContext | null> {
  const proj = await db
    .select({ companyId: projects.companyId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!proj) return null
  const [companyRole, projectRole] = await Promise.all([
    resolveCompanyRole(db, proj.companyId, email),
    resolveProjectRole(db, projectId, email),
  ])
  return { companyId: proj.companyId, companyRole, projectRole }
}

export interface CallerRoleMaps {
  companyRoles: Map<string, CompanyRole>
  projectRoles: Map<string, ProjectRole>
}

/** Preload all of the caller's company- and project-roles in two queries. */
export async function loadCallerRoleMaps(db: Db, email: string): Promise<CallerRoleMaps> {
  const cm = await db
    .select({ companyId: companyMembers.companyId, role: companyMembers.role })
    .from(companyMembers)
    .where(eq(companyMembers.userEmail, email))
    .all()
  const pm = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userEmail, email))
    .all()
  return {
    companyRoles: new Map(cm.map(r => [r.companyId, r.role])),
    projectRoles: new Map(pm.map(r => [r.projectId, r.role])),
  }
}

/**
 * Company-IDs the caller can see: every company they are a company-member
 * of, PLUS every company that owns a project they are a project-member of.
 */
export async function listVisibleCompanyIds(db: Db, email: string): Promise<Set<string>> {
  const cm = await db
    .select({ companyId: companyMembers.companyId })
    .from(companyMembers)
    .where(eq(companyMembers.userEmail, email))
    .all()
  const pm = await db
    .select({ companyId: projects.companyId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userEmail, email))
    .all()
  return new Set([...cm.map(r => r.companyId), ...pm.map(r => r.companyId)])
}
