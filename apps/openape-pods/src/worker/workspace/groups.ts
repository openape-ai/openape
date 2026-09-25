import { randomUUID } from 'node:crypto'
import type { PodDatabase } from '../storage/database'
import { parseGroupCommand } from '../../contracts/groups'
import type { Organization } from '../../contracts/groups'

export class PodGroups {
  constructor(private readonly store: PodDatabase) {}
  view(): Organization {
    const revision = this.store.db.prepare('SELECT revision FROM pod_organization WHERE id=1').get()!.revision as number
    const groups = this.store.db.prepare('SELECT * FROM pod_groups ORDER BY rowid').all().map(row => ({ id: row.id as string, name: row.name as string, collapsed: !!row.collapsed, podIds: this.store.db.prepare('SELECT pod_id FROM pod_memberships WHERE group_id=?').all(row.id as string).map(member => member.pod_id as string) }))
    return { revision, groups }
  }

  execute(input: unknown): void {
    const command = parseGroupCommand(input)
    this.store.transaction(() => {
      const state = this.view()
      if (command.revision !== state.revision) throw new Error('Groups changed. Refresh and try again.')
      if ('id' in command && !state.groups.some(group => group.id === command.id)) throw new Error('Group no longer exists')
      if ('name' in command && state.groups.some(group => group.name.toLowerCase() === command.name.toLowerCase() && (!('id' in command) || group.id !== command.id))) throw new Error('A group with this name already exists')
      if (command.action === 'create') {
        if (state.groups.length >= 50) throw new Error('The workspace supports up to 50 groups')
        this.store.db.prepare('INSERT INTO pod_groups(id,name,collapsed) VALUES(?,?,0)').run(randomUUID(), command.name)
      }
      if (command.action === 'rename') this.store.db.prepare('UPDATE pod_groups SET name=? WHERE id=?').run(command.name, command.id)
      if (command.action === 'remove') this.store.db.prepare('DELETE FROM pod_groups WHERE id=?').run(command.id)
      if (command.action === 'collapse') this.store.db.prepare('UPDATE pod_groups SET collapsed=? WHERE id=?').run(Number(command.collapsed), command.id)
      if (command.action === 'move') {
        this.store.getPod(command.podId)
        if (command.groupId !== null && !state.groups.some(group => group.id === command.groupId)) throw new Error('Group no longer exists')
        this.store.db.prepare('DELETE FROM pod_memberships WHERE pod_id=?').run(command.podId)
        if (command.groupId !== null) this.store.db.prepare('INSERT INTO pod_memberships VALUES(?,?)').run(command.podId, command.groupId)
      }
      this.store.db.prepare('UPDATE pod_organization SET revision=revision+1 WHERE id=1').run()
    })
  }
}
