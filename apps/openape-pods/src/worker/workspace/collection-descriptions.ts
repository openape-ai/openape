import type { CollectionDescription, WorkspaceCommand } from '../../contracts/control'
import type { PodDatabase } from '../storage/database'

/** Owner-written descriptions of networks and workflows. They explain; nothing that executes reads them. */
export class CollectionDescriptions {
  constructor(private readonly store: PodDatabase) {}

  view(): CollectionDescription[] {
    return this.store.db.prepare('SELECT id,body AS text,revision FROM collection_descriptions WHERE id IN (SELECT id FROM workflows UNION ALL SELECT id FROM networks) ORDER BY rowid').all() as unknown as CollectionDescription[]
  }

  execute(command: Extract<WorkspaceCommand, { type: 'describeCollection' }>): void {
    this.store.transaction(() => {
      if (!this.store.db.prepare('SELECT 1 FROM workflows WHERE id=? UNION ALL SELECT 1 FROM networks WHERE id=?').get(command.id, command.id)) throw new Error('Network or workflow not found')
      const current = this.store.db.prepare('SELECT revision FROM collection_descriptions WHERE id=?').get(command.id)?.revision as number | undefined
      if ((current ?? 0) !== command.revision) throw new Error('Description changed; reload before saving')
      const text = command.text.trim()
      if (!text) { this.store.db.prepare('DELETE FROM collection_descriptions WHERE id=?').run(command.id); return }
      this.store.db.prepare('INSERT INTO collection_descriptions(id,body,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,revision=excluded.revision,updated_at=excluded.updated_at').run(command.id, text, command.revision + 1, Date.now())
    })
  }
}
