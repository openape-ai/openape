import type { AutomationDescription, WorkspaceCommand } from '../../contracts/control'
import type { PodDatabase } from '../storage/database'

/** Owner-written descriptions of networks (automations). They explain; nothing that executes reads them. The table keeps its old name until the baseline schema (issue 1455, M8). */
export class AutomationDescriptions {
  constructor(private readonly store: PodDatabase) {}

  view(): AutomationDescription[] {
    return this.store.db.prepare('SELECT id,body AS text,revision FROM collection_descriptions WHERE id IN (SELECT id FROM networks) ORDER BY rowid').all() as unknown as AutomationDescription[]
  }

  execute(command: Extract<WorkspaceCommand, { type: 'describeAutomation' }>): void {
    this.store.transaction(() => {
      if (!this.store.db.prepare('SELECT 1 FROM networks WHERE id=?').get(command.id)) throw new Error('Network not found')
      const current = this.store.db.prepare('SELECT revision FROM collection_descriptions WHERE id=?').get(command.id)?.revision as number | undefined
      if ((current ?? 0) !== command.revision) throw new Error('Description changed; reload before saving')
      const text = command.text.trim()
      if (!text) { this.store.db.prepare('DELETE FROM collection_descriptions WHERE id=?').run(command.id); return }
      this.store.db.prepare('INSERT INTO collection_descriptions(id,body,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,revision=excluded.revision,updated_at=excluded.updated_at').run(command.id, text, command.revision + 1, Date.now())
    })
  }
}
