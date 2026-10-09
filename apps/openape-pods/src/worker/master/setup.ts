import type { AccessProposal } from '../../contracts/master'
import { parseSetupRequest } from '../../contracts/setup'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'

export class MasterSetup {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry) {}

  // Historical proposals of the legacy chat; only its inspect result still lists them (removed with master/control.ts, issue 1455 M6).
  proposals(podId: string): AccessProposal[] {
    return this.store.db.prepare('SELECT * FROM access_proposals WHERE (?=\'\' OR pod_id=?) ORDER BY rowid DESC LIMIT 100').all(podId, podId).map((row) => {
      const body = parseSetupRequest(JSON.parse(row.body as string))
      let state = row.state as AccessProposal['state']
      if (body.provider === 'credential' && state !== 'declined') state = this.resources.list(row.pod_id as string).some(resource => resource.kind === 'credential' && resource.state === 'ready' && resource.configuration.alias === body.alias) ? 'approved' : 'pending'
      return { id: row.id as string, podId: row.pod_id as string, body, state }
    })
  }

  scriptState(podId: string): 'missing' | 'draft' | 'active' {
    const pod = this.store.getPod(podId)
    const draft = this.store.db.prepare('SELECT script_hash FROM script_drafts WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(podId)
    if (draft && (!draft.script_hash || draft.script_hash !== pod.activeScript)) return 'draft'
    return pod.activeScript ? 'active' : 'missing'
  }
}
