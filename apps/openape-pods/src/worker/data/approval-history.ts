import { parseApprovalAuthority } from '../../contracts/approvals'
import type { ApprovalManifest, ApprovalState, ApprovalView } from '../../contracts/approvals'
import { grantSummary } from '../../contracts/grant-summary'
import type { PodDatabase } from '../storage/database'

/** Historical decisions are inspectable and revocable, never executable or renewable. */
export class ApprovalHistory {
  constructor(private readonly store: PodDatabase) {}

  views(states: ApprovalState[] = ['collecting', 'requested', 'approved', 'unknown']): (ApprovalView & { podId: string })[] {
    return this.store.db.prepare(`SELECT a.*,b.url FROM action_approvals a LEFT JOIN approval_batches b ON b.id=a.batch_id WHERE a.state IN (${states.map(() => '?').join(',')}) ORDER BY a.created_at DESC LIMIT 500`).all(...states).map(row => ({
      id: String(row.id),
      podId: String(row.pod_id),
      action: row.action as ApprovalView['action'],
      object: String(row.object),
      title: String(row.title),
      description: row.description as string | null,
      link: row.link as string | null,
      state: row.state as ApprovalState,
      reason: 'Historical decision; migrate and reconcile in the external tool before any new execution',
      batchId: row.batch_id as string | null,
      batchUrl: null,
      updatedAt: Number(row.updated_at),
    }))
  }

  /** Cutover retires every old grant, including formerly approved grants. This only reduces authority. */
  releasable(limit = 4): { podId: string, manifest: ApprovalManifest, grants: { key: string, id: string }[] }[] {
    return this.store.db.prepare('SELECT DISTINCT b.* FROM approval_batches b JOIN action_approvals a ON a.batch_id=b.id WHERE a.grant_id IS NOT NULL AND a.released_at IS NULL ORDER BY b.created_at LIMIT ?').all(limit).map((batch) => {
      const rows = this.store.db.prepare('SELECT * FROM action_approvals WHERE batch_id=? AND grant_id IS NOT NULL AND released_at IS NULL').all(String(batch.id))
      const items = rows.map(row => ({ key: String(row.id), authority: parseApprovalAuthority(JSON.parse(String(row.authority))), summary: grantSummary(String(row.title), this.store.getPod(String(batch.pod_id)).name) }))
      return { podId: String(batch.pod_id), manifest: { podId: String(batch.pod_id), owner: items[0].authority.owner, batchId: String(batch.id), title: String(batch.title), expiresAt: Number(batch.expires_at), items }, grants: rows.map(row => ({ key: String(row.id), id: String(row.grant_id) })) }
    })
  }

  released(keys: string[]): void {
    for (const key of keys) this.store.db.prepare('UPDATE action_approvals SET released_at=? WHERE id=? AND released_at IS NULL').run(Date.now(), key)
  }
}
