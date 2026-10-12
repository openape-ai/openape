import type { ItemTags, WorkspaceCommand } from '../../contracts/control'
import type { PodDatabase } from '../storage/database'

const parse = (value: unknown): string[] => JSON.parse(String(value)) as string[]

/** Free owner tags of Pods (issue 1459). They label; nothing that executes reads them. */
export class ItemTagStore {
  constructor(private readonly store: PodDatabase) {}

  view(): ItemTags[] {
    return this.store.db.prepare(`SELECT id,tags,revision FROM item_tags WHERE id IN (SELECT id FROM pods WHERE lifecycle!='archived') ORDER BY rowid`).all().map(row => ({ id: row.id as string, tags: parse(row.tags), revision: Number(row.revision) }))
  }

  /** What the inbox shows for a Pod (issue 1461). */
  podTags(podId: string): string[] {
    return this.own(podId)
  }

  /** One Pod's tags; portable export carries exactly these. */
  own(id: string): string[] {
    const row = this.store.db.prepare('SELECT tags FROM item_tags WHERE id=?').get(id)
    return row ? parse(row.tags) : []
  }

  execute(command: Extract<WorkspaceCommand, { type: 'tag' }>): void {
    this.store.transaction(() => {
      if (!this.store.db.prepare('SELECT 1 FROM pods WHERE id=?').get(command.id)) throw new Error('Pod not found')
      const current = this.store.db.prepare('SELECT revision FROM item_tags WHERE id=?').get(command.id)?.revision as number | undefined
      if ((current ?? 0) !== command.revision) throw new Error('Tags changed; reload before saving')
      if (!command.tags.length) { this.store.db.prepare('DELETE FROM item_tags WHERE id=?').run(command.id); return }
      this.store.db.prepare('INSERT INTO item_tags(id,tags,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET tags=excluded.tags,revision=excluded.revision,updated_at=excluded.updated_at').run(command.id, JSON.stringify(command.tags), command.revision + 1, Date.now())
    })
  }
}
