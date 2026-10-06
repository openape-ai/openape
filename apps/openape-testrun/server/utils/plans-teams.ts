import type { Client, Row, Transaction } from '@libsql/client'
import type { ReportIdentity } from './html-store'
import { SignJWT, jwtVerify } from 'jose'
import { ulid } from 'ulid'
import { ReportError, invalid, label, lifetime, object } from '../../shared/html-publication'
import { row, transaction } from './html-store'
import { listPlans, member } from './plans-store'

function inviteSecret(secret: string) {
  if (secret.length < 32) throw new ReportError('UNAVAILABLE', 'Plans invite compatibility is not configured', 503)
  return new TextEncoder().encode(secret)
}
export async function verifyPlanInvite(db: Pick<Client, 'execute'>, token: string, secret: string, now: number) {
  let id: unknown; let team: unknown
  try {
    const { payload } = await jwtVerify(token, inviteSecret(secret), { issuer: 'plans.openape.ai', algorithms: ['HS256'], currentDate: new Date(now) })
    if (payload.typ !== 'team-invite') invalid('Invalid invite type')
    id = payload.kid; team = payload.tid
  }
  catch { throw new ReportError('GONE', 'Invalid or expired invite', 410) }
  if (typeof id !== 'string' || typeof team !== 'string') throw new ReportError('GONE', 'Invalid invite', 410)
  const invite = await row(db, 'SELECT i.*,t.name AS team_name,t.description AS team_description FROM team_invites i JOIN teams t ON t.id=i.team_id WHERE i.id=? AND i.team_id=?', [id, team])
  if (!invite || invite.revoked_at !== null || Number(invite.expires_at) * 1000 <= now) throw new ReportError('GONE', 'Invite expired or revoked', 410)
  return invite
}
function hasUses(invite: Row) {
  if (Number(invite.used_count) >= Number(invite.max_uses)) throw new ReportError('GONE', 'Invite has no uses remaining', 410)
}
export async function previewPlanInvite(client: Client, token: string, secret: string, now = Date.now()) {
  const invite = await verifyPlanInvite(client, token, secret, now); hasUses(invite)
  return { team_id: invite.team_id, team_name: invite.team_name, team_description: invite.team_description, inviter_email: invite.created_by, note: invite.note, expires_at: invite.expires_at, uses_remaining: Number(invite.max_uses) - Number(invite.used_count) }
}
export async function acceptPlanInvite(client: Client, token: string, secret: string, identity: ReportIdentity, now = Date.now()) {
  return transaction(client, async (tx) => {
    const invite = await verifyPlanInvite(tx, token, secret, now)
    const existing = await row(tx, 'SELECT role FROM team_members WHERE team_id=? AND user_email=?', [invite.team_id!, identity.subject])
    if (existing) return { team_id: invite.team_id, team_role: existing.role, already_member: true }
    hasUses(invite)
    await tx.execute({ sql: 'INSERT INTO team_members (team_id,user_email,role,joined_at) VALUES (?,?,?,?)', args: [invite.team_id!, identity.subject, 'editor', Math.floor(now / 1000)] })
    await tx.execute({ sql: 'UPDATE team_invites SET used_count=used_count+1 WHERE id=?', args: [invite.id!] })
    return { team_id: invite.team_id, team_role: 'editor', already_member: false }
  })
}
export async function teamDetail(db: Pick<Client, 'execute'>, id: string, identity: ReportIdentity) {
  const membership = await member(db, id, identity)
  const team = await row(db, 'SELECT * FROM teams WHERE id=?', [id])
  const members = (await db.execute({ sql: 'SELECT user_email AS email,role,joined_at FROM team_members WHERE team_id=? ORDER BY user_email', args: [id] })).rows
  const plans = await listPlans(db, id, identity)
  return { ...team, role: membership.role, members, plans, member_count: members.length, plan_count: plans.length, updated_at: plans[0]?.updated_at ?? team?.created_at }
}
export async function listTeams(db: Client, identity: ReportIdentity, archived: boolean) {
  const teams = (await db.execute({ sql: 'SELECT t.id FROM teams t JOIN team_members m ON m.team_id=t.id WHERE m.user_email=? AND (? OR t.archived_at IS NULL) ORDER BY t.name,t.id', args: [identity.subject, archived ? 1 : 0] })).rows
  const results = []
  for (const team of teams) {
    const { members: _members, plans: _plans, ...summary } = await teamDetail(db, String(team.id), identity)
    results.push(summary)
  }
  return results
}
async function removeTeam(tx: Transaction, id: string, force: boolean, now: number) {
  const active = await row(tx, 'SELECT COUNT(*) AS count FROM html_documents WHERE team_id=? AND legacy_plan_id IS NOT NULL AND purged_at IS NULL AND removed_at IS NULL AND (expires_at IS NULL OR expires_at>?)', [id, now])
  const count = Number(active?.count ?? 0)
  if (count && !force) throw new ReportError('CONFLICT', 'Team has plans; use force=true to remove them', 409)
  await tx.execute({ sql: 'UPDATE html_documents SET removed_at=?,retention_revision=retention_revision+1 WHERE team_id=? AND legacy_plan_id IS NOT NULL AND removed_at IS NULL AND purged_at IS NULL AND (expires_at IS NULL OR expires_at>?)', args: [now, id, now] })
  for (const table of ['team_members', 'team_invites']) await tx.execute({ sql: `DELETE FROM ${table} WHERE team_id=?`, args: [id] })
  await tx.execute({ sql: 'DELETE FROM teams WHERE id=?', args: [id] })
  return { ok: true, cascade_soft_deleted_plans: count }
}
export async function mutateTeam(client: Client, identity: ReportIdentity, method: string, parts: string[], input: unknown, force: boolean, secret: string, origin: string, now = Date.now()) {
  const [id, action, target] = parts
  return transaction(client, async (tx) => {
    const seconds = Math.floor(now / 1000)
    if (!id && method === 'POST') {
      const body = object(input, ['name', 'description']); const name = label(body.name, 120, 'name')
      const description = body.description ? label(body.description, 500, 'description') : null; const team = ulid()
      await tx.execute({ sql: 'INSERT INTO teams (id,name,description,created_by,created_at) VALUES (?,?,?,?,?)', args: [team, name, description, identity.subject, seconds] })
      await tx.execute({ sql: 'INSERT INTO team_members (team_id,user_email,role,joined_at) VALUES (?,?,?,?)', args: [team, identity.subject, 'owner', seconds] })
      return { id: team, name, description, role: 'owner', member_count: 1, plan_count: 0, archived_at: null, created_at: seconds, updated_at: seconds }
    }
    if (!id) invalid('Team is required')
    await member(tx, id, identity, action === 'invites', action !== 'invites' && !(action === 'members' && target === identity.subject))
    if (method === 'DELETE' && !action) return removeTeam(tx, id, force, now)
    if (method === 'DELETE' && action === 'members' && target) {
      await tx.execute({ sql: 'DELETE FROM team_members WHERE team_id=? AND user_email=?', args: [id, target] })
      return { ok: true }
    }
    if (method === 'POST' && ['archive', 'unarchive'].includes(action ?? '')) {
      await tx.execute({ sql: 'UPDATE teams SET archived_at=? WHERE id=?', args: [action === 'archive' ? seconds : null, id] })
      return { ok: true, archived_at: action === 'archive' ? seconds : null }
    }
    if (method === 'PATCH' && !action) {
      const body = object(input, ['name', 'description']); const team = await row(tx, 'SELECT * FROM teams WHERE id=?', [id])
      if (!Object.keys(body).length) invalid('No fields to update')
      const name = body.name === undefined ? team!.name! : label(body.name, 120, 'name')
      const description = body.description === undefined ? team!.description! : body.description ? label(body.description, 500, 'description') : null
      await tx.execute({ sql: 'UPDATE teams SET name=?,description=? WHERE id=?', args: [name, description, id] })
      return { ...team, name, description }
    }
    if (method === 'POST' && action === 'invites') {
      const body = object(input, ['max_uses', 'expires_in', 'note']); const uses = body.max_uses ?? 5
      if (!Number.isSafeInteger(uses) || Number(uses) < 1 || Number(uses) > 100) invalid('max_uses must be 1–100')
      const expiry = lifetime({ expiresIn: body.expires_in ?? '7d' }, now)!
      if (expiry - now < 60000 || expiry - now > 90 * 86400000) invalid('Invite lifetime must be 1m–90d')
      const note = body.note ? label(body.note, 200, 'note') : null; const inviteId = ulid(); const expiresAt = Math.floor(expiry / 1000)
      const token = await new SignJWT({ typ: 'team-invite', kid: inviteId, tid: id, inv: identity.subject }).setProtectedHeader({ alg: 'HS256' }).setIssuer('plans.openape.ai').setIssuedAt(seconds).setExpirationTime(expiresAt).sign(inviteSecret(secret))
      await tx.execute({ sql: 'INSERT INTO team_invites (id,team_id,created_by,note,max_uses,expires_at,created_at) VALUES (?,?,?,?,?,?,?)', args: [inviteId, id, identity.subject, note, Number(uses), expiresAt, seconds] })
      return { id: inviteId, url: `${origin}/invite?t=${token}`, token, expires_at: expiresAt, max_uses: uses, note }
    }
    throw new ReportError('NOT_FOUND', 'Unknown team operation', 404)
  })
}
