import type { ItemTags, WorkspaceCommand } from '../../contracts/control'
import type { PodDatabase } from '../storage/database'

const parse = (value: unknown): string[] => JSON.parse(String(value)) as string[]

/** Free owner tags of Pods and networks (issue 1459). They label; nothing that executes reads them. */
export class ItemTagStore {
  constructor(private readonly store: PodDatabase) {}

  /** Own tags of every tagged Pod and network, plus the tags each network member inherits from its network. */
  view(): ItemTags[] {
    const own = new Map(this.store.db.prepare(`SELECT id,tags,revision FROM item_tags WHERE id IN (SELECT id FROM pods WHERE lifecycle!='archived' UNION SELECT id FROM networks WHERE state!='archived') ORDER BY rowid`).all().map(row => [row.id as string, { tags: parse(row.tags), revision: Number(row.revision) }]))
    const inherited = new Map<string, string[]>()
    for (const row of this.store.db.prepare(`SELECT member.pod_id,tag.tags FROM network_members member JOIN networks network ON network.id=member.network_id JOIN item_tags tag ON tag.id=network.id WHERE network.state!='archived'`).all()) inherited.set(row.pod_id as string, parse(row.tags))
    return Array.from(new Set([...own.keys(), ...inherited.keys()]), id => ({ id, tags: own.get(id)?.tags ?? [], revision: own.get(id)?.revision ?? 0, inherited: inherited.get(id) ?? [] }))
  }

  execute(command: Extract<WorkspaceCommand, { type: 'tag' }>): void {
    this.store.transaction(() => {
      if (!this.store.db.prepare('SELECT 1 FROM pods WHERE id=? UNION ALL SELECT 1 FROM networks WHERE id=?').get(command.id, command.id)) throw new Error('Pod or network not found')
      const current = this.store.db.prepare('SELECT revision FROM item_tags WHERE id=?').get(command.id)?.revision as number | undefined
      if ((current ?? 0) !== command.revision) throw new Error('Tags changed; reload before saving')
      if (!command.tags.length) { this.store.db.prepare('DELETE FROM item_tags WHERE id=?').run(command.id); return }
      this.store.db.prepare('INSERT INTO item_tags(id,tags,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET tags=excluded.tags,revision=excluded.revision,updated_at=excluded.updated_at').run(command.id, JSON.stringify(command.tags), command.revision + 1, Date.now())
    })
  }
}

/** A network's display name; its revisions, members and history keep their identity (issue 1459). */
export function renameNetwork(store: PodDatabase, command: Extract<WorkspaceCommand, { type: 'renameNetwork' }>): void {
  if (store.db.prepare('UPDATE networks SET name=? WHERE id=? AND state!=\'archived\'').run(command.name, command.id).changes !== 1) throw new Error('Network not found')
}
