import { describe, expect, it } from 'vitest'
import { canLogToProject, resolveEntryRights } from './visibility'
import type { RoleContext } from './visibility'

const VIEWER = 'viewer@example.com'
const AUTHOR = 'author@example.com'

// E gehört AUTHOR; Betrachter ist VIEWER (≠ Autor) sofern nicht anders.
function rights(ctx: RoleContext, authoredByViewer = false) {
  return resolveEntryRights(VIEWER, { userEmail: authoredByViewer ? VIEWER : AUTHOR }, ctx)
}

describe('resolveEntryRights — Spec §4 Matrix (fremder Eintrag)', () => {
  it('Company owner: sieht + editiert alle', () => {
    expect(rights({ companyRole: 'owner' })).toEqual({ canView: true, canEdit: true })
  })

  it('Company manager: sieht alle, read-only', () => {
    expect(rights({ companyRole: 'manager' })).toEqual({ canView: true, canEdit: false })
  })

  it('Company member (ohne Projekt-Rolle): sieht nichts Fremdes', () => {
    expect(rights({ companyRole: 'member' })).toEqual({ canView: false, canEdit: false })
  })

  it('Projekt manager: sieht + editiert alle im Projekt', () => {
    expect(rights({ projectRole: 'manager' })).toEqual({ canView: true, canEdit: true })
  })

  it('Projekt member: sieht fremden Eintrag NICHT (Negativfall)', () => {
    expect(rights({ projectRole: 'member' })).toEqual({ canView: false, canEdit: false })
  })

  it('Keinerlei Rolle: keine Rechte', () => {
    expect(rights({})).toEqual({ canView: false, canEdit: false })
  })
})

describe('resolveEntryRights — Autor & Maximum-Kombinationen', () => {
  it('Autor sieht + editiert eigene Einträge immer (ohne Rolle)', () => {
    expect(rights({}, true)).toEqual({ canView: true, canEdit: true })
  })

  it('Projekt member auf EIGENEM Eintrag: sieht + editiert', () => {
    expect(rights({ projectRole: 'member' }, true)).toEqual({ canView: true, canEdit: true })
  })

  it('Maximum: Company member + Projekt manager → manager gewinnt', () => {
    expect(rights({ companyRole: 'member', projectRole: 'manager' }))
      .toEqual({ canView: true, canEdit: true })
  })

  it('Maximum: Company manager + Projekt member auf fremdem Eintrag → sieht (manager), kein Edit', () => {
    expect(rights({ companyRole: 'manager', projectRole: 'member' }))
      .toEqual({ canView: true, canEdit: false })
  })

  it('Company owner + Projekt member: owner-Edit gewinnt', () => {
    expect(rights({ companyRole: 'owner', projectRole: 'member' }))
      .toEqual({ canView: true, canEdit: true })
  })
})

describe('canLogToProject — Spec §4 Loggen-Spalte', () => {
  it('Projekt manager darf loggen', () => {
    expect(canLogToProject({ projectRole: 'manager' })).toBe(true)
  })
  it('Projekt member darf loggen', () => {
    expect(canLogToProject({ projectRole: 'member' })).toBe(true)
  })
  it('Company owner darf loggen (alle Projekte)', () => {
    expect(canLogToProject({ companyRole: 'owner' })).toBe(true)
  })
  it('Company manager darf NICHT loggen (read-only)', () => {
    expect(canLogToProject({ companyRole: 'manager' })).toBe(false)
  })
  it('Company member ohne Projekt-Rolle darf NICHT loggen', () => {
    expect(canLogToProject({ companyRole: 'member' })).toBe(false)
  })
  it('Keine Rolle: darf nicht loggen', () => {
    expect(canLogToProject({})).toBe(false)
  })
})
