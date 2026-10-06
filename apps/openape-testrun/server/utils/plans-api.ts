import type { H3Event } from 'h3'
import type { ReportIdentity } from './html-store'
import { getHeader, getMethod, getQuery, getRequestURL, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { HTML_LIMIT, ReportError, invalid, object } from '../../shared/html-publication'
import { verifyPlansBridge } from '../../shared/plans-bridge'
import { useDatabaseClient } from '../database/drizzle'
import { htmlBase, htmlProblem } from './html-api'
import { privateReportHeaders, reportOwner } from './report-auth'
import { limitReportRequests, readReportBody } from './report-request'
import { row, transaction } from './html-store'
import { deletePlan, listPlans, member, readPlan, writePlan } from './plans-store'
import { acceptPlanInvite, listTeams, mutateTeam, previewPlanInvite, teamDetail } from './plans-teams'

async function handle(event: H3Event, teamsOnly = false) {
  privateReportHeaders(event); limitReportRequests(event)
  const config = useRuntimeConfig()
  if (!teamsOnly && String(config.plansConsolidated) !== 'true') throw new ReportError('UNAVAILABLE', 'Plans consolidation is not enabled', 503)
  const url = getRequestURL(event); const prefix = teamsOnly ? '/api' : '/api/plans-compat'; const path = url.pathname.slice(prefix.length) + url.search
  const parts = url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent)
  const [resource, id, action] = parts; const method = getMethod(event); const db = useDatabaseClient(); const query = getQuery(event)
  if (teamsOnly && (!['teams', 'invites'].includes(resource ?? '') || action === 'plans')) throw new ReportError('NOT_FOUND', 'Unknown Reports team operation', 404)
  if (parts.length > 4) invalid('Invalid compatibility path')
  const preview = resource === 'invites' && method === 'GET' && Boolean(id) && parts.length === 2
  let raw = ''; let data: unknown = {}
  if (!['GET', 'HEAD'].includes(method) && (getHeader(event, 'content-length') !== '0') && getHeader(event, 'content-type')) ({ raw, data } = await readReportBody(event, HTML_LIMIT * 2))
  let identity: ReportIdentity | null
  const bridge = getHeader(event, 'x-openape-plans-bridge')
  if (bridge && teamsOnly) throw new ReportError('UNAUTHORIZED', 'Native Reports team routes require Reports authentication', 401)
  if (bridge) {
    try { identity = await verifyPlansBridge(String(config.plansBridgeSecret), bridge, method, path, raw) }
    catch { throw new ReportError('UNAUTHORIZED', 'Invalid Plans compatibility assertion', 401) }
  }
  else {
    identity = preview ? null : await reportOwner(event, method === 'GET' ? 'reports:read' : 'reports:manage')
  }
  if (!identity && !preview) throw new ReportError('UNAUTHORIZED', 'Authentication required', 401)
  if (method !== 'GET' && (String(config.plansWritesFrozen) === 'true' || (teamsOnly && String(config.htmlWritesFrozen) === 'true'))) throw new ReportError('UNAVAILABLE', 'Plans writes are temporarily frozen for reconciliation', 503)
  const secret = String(config.plansInviteSecret); const now = Date.now()
  if (preview) return previewPlanInvite(db, id!, secret, now)
  const caller = identity!
  if (resource === 'plans' && id && parts.length === 2) {
    if (method === 'GET') return (await readPlan(db, id, caller, now)).result
    if (method === 'PATCH') return writePlan(db, caller, data, { id }, now)
    if (method === 'DELETE') {
      const body = object(data, ['expected_version'])
      return transaction(db, tx => deletePlan(tx, id, caller, body.expected_version, now))
    }
  }
  if (resource === 'teams') {
    if (method === 'GET') {
      if (!id) return listTeams(db, caller, ['true', '1'].includes(String(query.include_archived)))
      if (!action) return teamDetail(db, id, caller)
      if (action === 'plans') return listPlans(db, id, caller, now)
      if (action === 'invites') {
        await member(db, id, caller, true)
        return (await db.execute({ sql: 'SELECT * FROM team_invites WHERE team_id=? AND revoked_at IS NULL AND expires_at>? AND used_count<max_uses ORDER BY created_at DESC', args: [id, Math.floor(now / 1000)] })).rows
      }
    }
    if (method === 'POST' && action === 'plans' && id && parts.length === 3) {
      const plan = await writePlan(db, caller, data, { team: id }, now); setResponseStatus(event, 201); return plan
    }
    const result = await mutateTeam(db, caller, method, parts.slice(1), data, ['true', '1'].includes(String(query.force)), secret, 'https://plans.openape.ai', now)
    if (method === 'POST' && (!id || action === 'invites')) setResponseStatus(event, 201)
    return result
  }
  if (resource === 'invites' && parts.length === 2) {
    if (method === 'POST' && id === 'accept') {
      const body = object(data, ['token']); if (typeof body.token !== 'string') invalid('Missing invite token')
      return acceptPlanInvite(db, body.token, secret, caller, now)
    }
    if (method === 'DELETE' && id) {
      return transaction(db, async (tx) => {
        const invite = await row(tx, 'SELECT * FROM team_invites WHERE id=?', [id])
        if (!invite) throw new ReportError('NOT_FOUND', 'Invite not found', 404)
        await member(tx, String(invite.team_id), caller, true)
        await tx.execute({ sql: 'UPDATE team_invites SET revoked_at=COALESCE(revoked_at,?) WHERE id=?', args: [Math.floor(now / 1000), id] })
        return { ok: true }
      })
    }
  }
  throw new ReportError('NOT_FOUND', `Unknown compatibility operation at ${htmlBase(event)}`, 404)
}
export async function plansApi(event: H3Event) {
  try { return await handle(event) }
  catch (error) { htmlProblem(error) }
}

export async function reportsTeamsApi(event: H3Event) {
  try { return await handle(event, true) }
  catch (error) { htmlProblem(error) }
}
