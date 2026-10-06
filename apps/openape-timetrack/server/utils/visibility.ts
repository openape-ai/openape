// Pure RBAC resolution — no Nitro/DB imports, so it stays unit-testable.
// Spec: docs/superpowers/specs/2026-05-15-timetrack-design.md §4.
//
// Rights = the maximum of the company role (for the entry's company) and the
// project role (for the entry's project). The caller resolves the memberships
// beforehand and passes them in here.

export type CompanyRole = 'owner' | 'manager' | 'member'
export type ProjectRole = 'manager' | 'member'

export interface RoleContext {
  /** Rolle des Betrachters in der Company des Eintrags (falls Mitglied). */
  companyRole?: CompanyRole
  /** Rolle des Betrachters im Projekt des Eintrags (falls Mitglied). */
  projectRole?: ProjectRole
}

export interface EntryRef {
  /** Autor des Eintrags (E.user_email). */
  userEmail: string
}

export interface EntryRights {
  canView: boolean
  canEdit: boolean
}

/**
 * May the viewer log entries against a project?
 * Project role (manager|member) OR company owner. Company manager does NOT
 * (reines Reporting), Company-member nur via Projekt-Rolle.
 */
export function canLogToProject(ctx: RoleContext): boolean {
  if (ctx.projectRole === 'manager' || ctx.projectRole === 'member') return true
  if (ctx.companyRole === 'owner') return true
  return false
}

/**
 * The viewer's view/edit rights on one concrete entry E.
 *
 * canView:
 *  - the author always sees their own entries
 *  - company owner|manager: every entry of the company
 *  - project manager: every entry of the project
 *  - project member: only their own entries in the project
 *
 * canEdit (Spec §10-Annahme, Least-Privilege):
 *  - Autor (eigene) | Projekt-manager | Company-owner
 *  - Company-manager bewusst read-only
 */
export function resolveEntryRights(
  viewerEmail: string,
  entry: EntryRef,
  ctx: RoleContext,
): EntryRights {
  const isAuthor = viewerEmail === entry.userEmail

  const canView
    = isAuthor
      || ctx.companyRole === 'owner'
      || ctx.companyRole === 'manager'
      || ctx.projectRole === 'manager'
      || (ctx.projectRole === 'member' && isAuthor)

  const canEdit
    = isAuthor
      || ctx.projectRole === 'manager'
      || ctx.companyRole === 'owner'

  return { canView, canEdit }
}
