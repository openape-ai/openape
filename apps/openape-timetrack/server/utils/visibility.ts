// Reine RBAC-Auflösung — keine Nitro/DB-Imports, damit unit-testbar.
// Spec: docs/superpowers/specs/2026-05-15-timetrack-design.md §4.
//
// Rechte = Maximum aus Company-Rolle (für die Company des Eintrags) und
// Projekt-Rolle (für das Projekt des Eintrags). Der Aufrufer löst die
// Mitgliedschaften vorher auf und übergibt sie hier.

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
 * Darf der Betrachter Einträge auf ein Projekt loggen?
 * Projekt-Rolle (manager|member) ODER Company-owner. Company-manager NICHT
 * (reines Reporting), Company-member nur via Projekt-Rolle.
 */
export function canLogToProject(ctx: RoleContext): boolean {
  if (ctx.projectRole === 'manager' || ctx.projectRole === 'member') return true
  if (ctx.companyRole === 'owner') return true
  return false
}

/**
 * Sicht-/Editierrechte des Betrachters auf einen konkreten Eintrag E.
 *
 * canView:
 *  - Autor sieht eigene Einträge immer
 *  - Company owner|manager: alle Einträge der Company
 *  - Projekt manager: alle Einträge des Projekts
 *  - Projekt member: nur eigene Einträge des Projekts
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
