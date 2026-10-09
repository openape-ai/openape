import type { PodDatabase } from '../storage/database'

export class MasterSetup {
  constructor(private readonly store: PodDatabase) {}

  scriptState(podId: string): 'missing' | 'draft' | 'active' {
    const pod = this.store.getPod(podId)
    const draft = this.store.db.prepare('SELECT script_hash FROM script_drafts WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(podId)
    if (draft && (!draft.script_hash || draft.script_hash !== pod.activeScript)) return 'draft'
    return pod.activeScript ? 'active' : 'missing'
  }
}
