import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { cliAuthorizationDetailsCover } from '@openape/grants'
import { parsePodGrant } from '../../contracts/grants'
import type { GrantState, PodGrant } from '../../contracts/grants'
import { effectiveSandboxLevel, parseSandboxLevel } from '../../contracts/sandbox'
import type { SandboxLevel, SandboxView } from '../../contracts/sandbox'
import type { PodDatabase } from '../storage/database'

export type GrantLedgerCommand
  = | { type: 'list', podId?: string, networkId?: string }
    | { type: 'find', podId: string, issuer: string, subject: string, detail: OpenApeCliAuthorizationDetail }
    | { type: 'same', podId: string, issuer: string, subject: string, details: OpenApeCliAuthorizationDetail[] }
    | { type: 'observed', podId: string, issuer: string, subject: string, cliId: string }
    | { type: 'record', grant: PodGrant }
    | { type: 'state', podId: string, id: string, state: GrantState, approvedInSession?: boolean }
    | { type: 'released' }
    | { type: 'level', podId: string, source: string, revision: number | null, level: SandboxLevel }
    | { type: 'sandbox', podId: string }
    | { type: 'networkResource', networkId: string, revision: number, podId: string, resourceId: string }
    | { type: 'resourceReleased', networkId: string, resourceId: string }

function row(value: Record<string, unknown>): PodGrant {
  return parsePodGrant({ id: value.id, podId: value.pod_id, issuer: value.issuer, subject: value.subject, cliId: value.cli_id, details: JSON.parse(value.details as string), display: value.display, grantType: value.grant_type, state: value.state, origin: value.network_id ? { networkId: value.network_id, revision: value.network_revision } : null, approvedInSession: value.approved_in_session === 1, createdAt: value.created_at, updatedAt: value.updated_at })
}
function canonical(details: OpenApeCliAuthorizationDetail[]): string {
  return JSON.stringify(details.map(detail => detail.permission).sort())
}

/**
 * The Pod grants as Pods requested them at the IdP. The IdP stays authoritative: a matched grant is read there
 * before every use, and the token it mints must cover the command. This ledger only selects which grant to use,
 * keeps pending requests reusable across runs and records the network a fanned-out grant came from.
 */
export class GrantLedger {
  constructor(private readonly store: PodDatabase) {}

  execute(command: GrantLedgerCommand): unknown {
    if (command.type === 'list') return this.list(command.podId, command.networkId)
    if (command.type === 'find') return this.find(command.podId, command.issuer, command.subject, command.detail)
    if (command.type === 'same') return this.same(command.podId, command.issuer, command.subject, command.details)
    if (command.type === 'observed') return this.observed(command.podId, command.issuer, command.subject, command.cliId)
    if (command.type === 'record') { this.record(command.grant); return true }
    if (command.type === 'state') { this.state(command.podId, command.id, command.state, command.approvedInSession); return true }
    if (command.type === 'released') return this.released()
    if (command.type === 'level') { this.level(command.podId, command.source, command.revision, command.level); return this.sandbox(command.podId) }
    if (command.type === 'sandbox') return this.sandbox(command.podId)
    if (command.type === 'networkResource') { this.store.getPod(command.podId); this.store.db.prepare('INSERT INTO network_sandbox_resources VALUES(?,?,?,?) ON CONFLICT(network_id,resource_id) DO NOTHING').run(command.networkId, command.revision, command.podId, command.resourceId); return true }
    this.store.db.prepare('DELETE FROM network_sandbox_resources WHERE network_id=? AND resource_id=?').run(command.networkId, command.resourceId)
    return true
  }

  list(podId?: string, networkId?: string): PodGrant[] {
    const rows = podId
      ? this.store.db.prepare('SELECT * FROM pod_grants WHERE pod_id=? ORDER BY created_at DESC, rowid DESC').all(podId)
      : networkId
        ? this.store.db.prepare('SELECT * FROM pod_grants WHERE network_id=? ORDER BY created_at DESC, rowid DESC').all(networkId)
        : this.store.db.prepare('SELECT * FROM pod_grants ORDER BY created_at DESC, rowid DESC LIMIT 1024').all()
    return rows.map(row)
  }

  /** The newest grant of this Pod identity whose details cover the call; used up and expired grants never match. */
  find(podId: string, issuer: string, subject: string, detail: OpenApeCliAuthorizationDetail): string | null {
    const candidates = this.store.db.prepare('SELECT * FROM pod_grants WHERE pod_id=? AND cli_id=? AND issuer=? AND subject=? AND state NOT IN (\'used\',\'expired\') ORDER BY created_at DESC, rowid DESC').all(podId, detail.cli_id, issuer, subject).map(row)
    return candidates.find(grant => cliAuthorizationDetailsCover(grant.details, [detail]))?.id ?? null
  }

  /** A still usable request with exactly these details, so a repeated declaration never asks twice. */
  same(podId: string, issuer: string, subject: string, details: OpenApeCliAuthorizationDetail[]): PodGrant | null {
    const wanted = canonical(details)
    return this.list(podId).find(grant => grant.issuer === issuer && grant.subject === subject && grant.grantType === 'always' && ['pending', 'approved'].includes(grant.state) && canonical(grant.details) === wanted) ?? null
  }

  /**
   * Grant ids of one program that this Pod identity's runs waited for or used (their approval events) and that the
   * ledger does not hold, newest first. Grants kept before schema 43 are known only here; the IdP decides whether one is
   * still usable.
   */
  observed(podId: string, issuer: string, subject: string, cliId: string): string[] {
    return this.store.db.prepare(`SELECT json_extract(e.data,'$.grantId') AS grant_id,max(e.at) AS seen FROM run_events e JOIN runs r ON r.id=e.run_id
      WHERE r.pod_id=? AND e.type='approval' AND json_extract(e.data,'$.issuer')=? AND json_extract(e.data,'$.subject')=? AND substr(json_extract(e.data,'$.permission'),1,?)=?
      AND json_extract(e.data,'$.grantId') NOT IN (SELECT id FROM pod_grants WHERE pod_id=?) GROUP BY grant_id ORDER BY seen DESC LIMIT 16`)
      .all(podId, issuer, subject, cliId.length + 1, `${cliId}.`, podId)
      .map(row => String(row.grant_id))
  }

  /** Records a grant or its new state; the origin is kept from the first record, so a network never adopts a Pod's own grant. */
  record(value: PodGrant): void {
    const grant = parsePodGrant(value)
    this.store.getPod(grant.podId)
    this.store.transaction(() => {
      const existing = this.store.db.prepare('SELECT pod_id,subject FROM pod_grants WHERE id=?').get(grant.id)
      if (existing && (existing.pod_id !== grant.podId || existing.subject !== grant.subject)) throw new Error('Grant belongs to another Pod identity')
      this.store.db.prepare(`INSERT INTO pod_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,
        approved_in_session=max(approved_in_session,excluded.approved_in_session)`)
        .run(grant.id, grant.podId, grant.issuer, grant.subject, grant.cliId, JSON.stringify(grant.details), grant.display.slice(0, 4096), grant.grantType, grant.state, grant.origin?.networkId ?? null, grant.origin?.revision ?? null, grant.approvedInSession ? 1 : 0, grant.createdAt, grant.updatedAt)
    })
  }

  state(podId: string, id: string, state: GrantState, approvedInSession = false): void {
    this.store.db.prepare('UPDATE pod_grants SET state=?,updated_at=?,approved_in_session=max(approved_in_session,?) WHERE pod_id=? AND id=?').run(state, Date.now(), approvedInSession ? 1 : 0, podId, id)
  }

  /**
   * What an archived network handed to its members: grants to revoke at the IdP and sandbox resources to remove.
   * Its sandbox levels need no IdP call and end here, including a level recorded after the archive.
   */
  released(): { grants: PodGrant[], resources: { networkId: string, podId: string, resourceId: string }[] } {
    const archived = 'SELECT id FROM networks WHERE state=\'archived\''
    this.store.db.prepare(`DELETE FROM pod_sandbox WHERE source IN (SELECT 'network:' || id FROM networks WHERE state='archived')`).run()
    const grants = this.store.db.prepare(`SELECT * FROM pod_grants WHERE network_id IN (${archived}) AND state IN ('pending','approved') ORDER BY rowid LIMIT 64`).all().map(row)
    const resources = this.store.db.prepare(`SELECT network_id,pod_id,resource_id FROM network_sandbox_resources WHERE network_id IN (${archived}) ORDER BY rowid LIMIT 64`).all().map(item => ({ networkId: item.network_id as string, podId: item.pod_id as string, resourceId: item.resource_id as string }))
    return { grants, resources }
  }

  level(podId: string, source: string, revision: number | null, level: SandboxLevel): void {
    this.store.getPod(podId)
    if (source !== 'pod' && !/^network:[a-f0-9-]{36}$/.test(source)) throw new Error('Invalid sandbox source')
    parseSandboxLevel(level)
    this.store.db.prepare('INSERT INTO pod_sandbox VALUES(?,?,?,?) ON CONFLICT(pod_id,source) DO UPDATE SET level=excluded.level,network_revision=excluded.network_revision').run(podId, source, revision, level)
  }

  /** A network's level counts only while that network is not archived and still at the revision that declared it. */
  sandbox(podId: string): SandboxView {
    this.store.getPod(podId)
    const sources = this.store.db.prepare(`SELECT s.source,s.level FROM pod_sandbox s LEFT JOIN networks n ON n.id=substr(s.source,9) AND s.source LIKE 'network:%'
      WHERE s.pod_id=? AND (s.source='pod' OR (n.state!='archived' AND n.revision=s.network_revision)) ORDER BY s.source`).all(podId).map(item => ({ source: item.source as string, level: parseSandboxLevel(item.level) }))
    return { level: effectiveSandboxLevel(sources.map(item => item.level)), sources }
  }
}
