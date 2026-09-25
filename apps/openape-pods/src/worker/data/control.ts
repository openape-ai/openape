import type { DataCommand, DataView } from '../../contracts/data'
import type { PodDatabase } from '../storage/database'
import { schemaVersion } from '../storage/database'
import { assertDataIdle, createBackup, restoreBackup } from './backup'
import { DataRetention } from './retention'

export type DataInternal = Exclude<DataCommand, { type: 'status' | 'backup' | 'restore' | 'cleanup' | 'update' }> | { type: 'status' | 'cleanup' | 'jobs' } | { type: 'finishDeletion', podId: string } | { type: 'backup', parent: string } | { type: 'restore', source: string, parent: string }
export class DataControl {
  readonly retention: DataRetention
  private result?: DataView['result']
  constructor(private readonly store: PodDatabase, helper: string) { this.retention = new DataRetention(store, helper) }
  async execute(command: DataInternal): Promise<unknown> {
    if (command.type === 'jobs') return this.retention.jobs()
    if (command.type === 'finishDeletion') this.retention.finishDeletion(command.podId)
    if (command.type === 'limit') this.retention.limit(command.bytes)
    if (command.type === 'deletePod') await this.retention.deletePod(command.podId, command.revision, command.name)
    if (command.type === 'cleanup') await this.retention.cleanup()
    if (command.type === 'backup') this.result = { kind: 'backup', path: await createBackup(this.store, command.parent) }
    if (command.type === 'restore') { assertDataIdle(this.store); this.result = { kind: 'restore', path: await restoreBackup(command.source, command.parent, schemaVersion) } }
    return { ...await this.retention.view(), ...(this.result ? { result: this.result } : {}) }
  }
}
