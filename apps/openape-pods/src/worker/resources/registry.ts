import type { ProgramAssignment } from '../../contracts/programs'
import { parseHttpPermission } from '../../contracts/http'
import type { ProgramAuthority } from '../../main/programs/grants'
import { parseCredentialAlias } from '../../contracts/credentials'
import type { PodResource } from '../../contracts/resources'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { PodDatabase } from '../storage/database'
import { createSnapshotSet } from './snapshots'
import type { FileAssignment, SnapshotSet } from './snapshots'

export class ResourceRegistry {
  constructor(private readonly store: PodDatabase, private readonly revokeActive: (podId: string) => void) {}

  list(podId: string): PodResource[] {
    this.store.getPod(podId)
    return this.store.db.prepare('SELECT * FROM resources WHERE pod_id=? ORDER BY rowid').all(podId).map(row => ({ id: row.id as string, podId: row.pod_id as string, revision: row.revision as number, kind: row.kind as PodResource['kind'], state: row.state as PodResource['state'], name: row.name as string, configuration: JSON.parse(row.configuration as string) }))
  }

  epoch(podId: string): number {
    this.store.getPod(podId)
    return this.store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(podId)?.epoch as number ?? 0
  }

  private advance(podId: string): void {
    this.store.db.prepare('INSERT INTO resource_epochs VALUES(?,1) ON CONFLICT(pod_id) DO UPDATE SET epoch=epoch+1').run(podId)
  }

  assignReference(podId: string, name: string, path: string): PodResource {
    this.store.getPod(podId)
    if (!name.trim() || name.length > 255 || !path.startsWith('/') || /[\0\r\n]/.test(path)) throw new Error('Invalid reference assignment')
    const id = randomUUID()
    this.store.transaction(() => {
      this.store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(id, podId, 'reference', 'ready', name, JSON.stringify({ path }))
      this.advance(podId)
    })
    this.revokeActive(podId)
    return this.list(podId).find(resource => resource.id === id) as PodResource
  }

  assignCredential(podId: string, value: string, credentialId: string, expectedEpoch: number): void {
    const alias = parseCredentialAlias(value)
    if (!/^[a-f0-9-]{36}$/.test(credentialId)) throw new Error('Invalid credential record identity')
    this.store.transaction(() => {
      const pod = this.store.getPod(podId)
      if (pod.lifecycle === 'archived' || this.epoch(podId) !== expectedEpoch) throw new Error('Pod or resources changed; reload before assigning credentials')
      const current = this.list(podId).filter(resource => resource.kind === 'credential' && resource.state !== 'revoked')
      if (!current.some(resource => resource.configuration.alias === alias) && current.length >= 32) throw new Error('This pod already has 32 named credentials')
      for (const resource of current.filter(resource => resource.configuration.alias === alias)) this.store.db.prepare('UPDATE resources SET state=\'revoked\',revision=revision+1 WHERE id=?').run(resource.id)
      this.store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(randomUUID(), podId, 'credential', 'ready', alias, JSON.stringify({ alias, credentialId }))
      this.advance(podId)
      this.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(podId)
    })
    this.revokeActive(podId)
  }

  assignProgram(podId: string, id: string, configuration: ProgramAssignment, expectedEpoch: number): void {
    this.store.transaction(() => {
      if (this.store.getPod(podId).lifecycle === 'archived' || this.epoch(podId) !== expectedEpoch) throw new Error('Pod or application permissions changed; reload before assigning access')
      const owner = this.store.db.prepare('SELECT pod_id FROM resources WHERE id=?').get(id)
      if (owner && owner.pod_id !== podId) throw new Error('Application belongs to another pod')
      const current = this.list(podId).find(item => item.id === id)
      if (current && current.configuration.type !== 'program') throw new Error('Resource is not an application')
      if (!current && this.list(podId).filter(item => item.kind === 'tool' && item.state === 'ready').length >= 16) throw new Error('This pod already has 16 tools')
      this.store.db.prepare('INSERT INTO resources VALUES(?,?,1,\'tool\',\'ready\',?,?) ON CONFLICT(id) DO UPDATE SET revision=revision+1,state=\'ready\',name=excluded.name,configuration=excluded.configuration').run(id, podId, configuration.name, JSON.stringify(configuration))
      this.advance(podId)
      this.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(podId)
    })
    this.revokeActive(podId)
  }

  assignHttp(podId: string, permission: unknown, authority: ProgramAuthority, expectedEpoch: number): void {
    const scope = parseHttpPermission(permission)
    this.store.transaction(() => {
      const pod = this.store.getPod(podId)
      if (pod.lifecycle === 'archived' || this.epoch(podId) !== expectedEpoch || authority.identity.podId !== podId) throw new Error('Pod or HTTP permissions changed; reload before assigning access')
      const current = this.list(podId).filter(item => item.kind === 'tool' && item.state === 'ready')
      if (!current.some(item => item.configuration.type === 'http' && item.configuration.origin === scope.origin) && current.length >= 16) throw new Error('This pod already has 16 tools')
      for (const item of this.list(podId).filter(item => item.kind === 'tool' && item.configuration.type === 'http' && item.configuration.origin === scope.origin && item.state !== 'revoked')) this.store.db.prepare('UPDATE resources SET state=\'revoked\',revision=revision+1 WHERE id=?').run(item.id)
      const id = randomUUID()
      const configuration = { type: 'http', ...scope, authority, capability: `tool.http_${id.replaceAll('-', '')}.request` }
      this.store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(id, podId, 'tool', 'ready', scope.origin, JSON.stringify(configuration))
      this.advance(podId)
      this.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(podId)
    })
    this.revokeActive(podId)
  }

  revoke(podId: string, id: string, revision: number): void {
    this.store.transaction(() => {
      const result = this.store.db.prepare('UPDATE resources SET state=\'revoked\',revision=revision+1 WHERE pod_id=? AND id=? AND revision=? AND state!=\'revoked\'').run(podId, id, revision)
      if (result.changes !== 1) throw new Error('Stale or unavailable resource')
      this.advance(podId)
    })
    this.revokeActive(podId)
  }

  replaceMail(podId: string, resources: { kind: 'tool' | 'connection', name: string, configuration: Record<string, unknown> }[]): void {
    this.store.getPod(podId)
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE resources SET state=\'revoked\',revision=revision+1 WHERE pod_id=? AND (json_extract(configuration,\'$.capability\')=\'mail.read\' OR kind=\'connection\') AND state!=\'revoked\'').run(podId)
      for (const resource of resources) this.store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(randomUUID(), podId, resource.kind, 'ready', resource.name, JSON.stringify(resource.configuration))
      this.advance(podId)
      this.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(podId)
    })
    this.revokeActive(podId)
  }

  assertCurrent(podId: string, epoch: number): void {
    if (this.epoch(podId) !== epoch) throw new Error('Resource permissions changed; stop this run')
  }

  async capture(podId: string, helper: string): Promise<SnapshotSet> {
    const epoch = this.epoch(podId)
    const assigned = this.list(podId).filter(resource => resource.kind === 'reference' && resource.state === 'ready')
    const files: FileAssignment[] = assigned.map(resource => ({ id: resource.id, revision: resource.revision, path: resource.configuration.path as string }))
    const set = await createSnapshotSet(helper, join(this.store.root, 'snapshots', podId), files)
    this.store.transaction(() => {
      this.assertCurrent(podId, epoch)
      this.store.db.prepare('INSERT INTO snapshot_sets VALUES(?,?,?,?)').run(set.id, podId, epoch, JSON.stringify(set))
    })
    return set
  }
}
