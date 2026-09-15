import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from './registry'
import type { ProgramAssignment } from '../../contracts/programs'
import type { PodResource } from '../../contracts/resources'

export type ProgramInternal =
  | { type: 'save', podId: string, id: string, epoch: number, configuration: ProgramAssignment }
  | { type: 'reserve', podId: string, applicationId: string, epoch: number, sessionId: string }
  | { type: 'check', podId: string, sessionId: string }
  | { type: 'release', podId: string, sessionId: string }
  | { type: 'recover' }

export class ProgramControl {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry) {}
  execute(command: ProgramInternal): PodResource | boolean {
    if (command.type === 'recover') { this.store.db.prepare('DELETE FROM program_leases').run(); return true }
    const pod = this.store.getPod(command.podId)
    if (command.type === 'release') { this.store.db.prepare('DELETE FROM program_leases WHERE pod_id=? AND session_id=?').run(pod.id, command.sessionId); return true }
    if (pod.lifecycle === 'archived') throw new Error('Archived pods cannot run or configure applications')
    if (command.type === 'check') {
      const lease = this.store.db.prepare('SELECT * FROM program_leases WHERE pod_id=? AND session_id=?').get(pod.id, command.sessionId)
      if (!lease || lease.epoch !== this.resources.epoch(pod.id) || lease.assignment_revision !== pod.bindingRevision) throw new Error('Terminal permission or script binding changed')
      return true
    }
    this.resources.assertCurrent(pod.id, command.epoch)
    if (command.type === 'save') {
      this.resources.assignProgram(pod.id, command.id, command.configuration, command.epoch)
      return this.resources.list(pod.id).find(item => item.id === command.id)!
    }
    return this.store.transaction(() => {
      if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(pod.id) || this.store.db.prepare('SELECT 1 FROM program_leases WHERE pod_id=?').get(pod.id)) throw new Error('Finish or recover the current pod run or terminal first')
      const resource = this.resources.list(pod.id).find(item => item.id === command.applicationId && item.state === 'ready' && item.configuration.type === 'program')
      if (!resource) throw new Error('Application is not assigned to this pod')
      this.store.db.prepare('INSERT INTO program_leases VALUES(?,?,?,?,?)').run(pod.id, command.sessionId, command.applicationId, command.epoch, pod.bindingRevision)
      this.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(pod.id)
      return resource
    })
  }
}
