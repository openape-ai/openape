import { createHash, randomUUID } from 'node:crypto'
import { ProtocolError, sameOwner, uuid } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import type { ProgramDefinition } from '../../contracts/programs'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { verifyExecutable } from '../runtime/sandbox'

export interface ProgramReview { id: string, podId: string, catalogId: string, owner: Owner, revision: number, podRevision: number, resourceEpoch: number, hash: string, expiresAt: number, state: 'pending' | 'approved' | 'denied', program: { name: string, executable: string, executableHash: string, adapterHash: string, networkHosts: string[] }, applicationId: string }
export interface RemoteProgramState { create: (podId: string, applicationId: string) => Promise<string>, discard: (podId: string, stateId: string) => Promise<void> }
export class RemotePrograms {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly now = Date.now) {}
  offer(owner: Owner, definition: ProgramDefinition): string {
    if (Object.keys(definition.environment).length || definition.bundlePath) throw new ProtocolError('desktop_action_required', 409)
    const id = randomUUID(); const body = JSON.stringify(definition)
    this.store.db.prepare('INSERT INTO remote_program_catalog VALUES(?,?,?,?,0)').run(id, JSON.stringify(owner), body, createHash('sha256').update(body).digest('hex'))
    return id
  }

  list(owner: Owner) {
    return this.store.db.prepare('SELECT id,definition,hash FROM remote_program_catalog WHERE owner=? AND revoked=0').all(JSON.stringify(owner)).map(row => ({ id: row.id, hash: row.hash, program: this.visible(JSON.parse(row.definition as string)) }))
  }

  revoke(owner: Owner, id: string): void {
    if (!this.store.db.prepare('UPDATE remote_program_catalog SET revoked=1 WHERE id=? AND owner=?').run(uuid(id), JSON.stringify(owner)).changes) throw new ProtocolError('not_found', 404)
  }

  private visible(program: ProgramDefinition) { return { name: program.name, executable: program.executable, executableHash: program.executableHash, adapterHash: program.adapterHash, networkHosts: program.networkHosts } }
  prepare(owner: Owner, podId: string, catalogId: string): ProgramReview {
    const row = this.store.db.prepare('SELECT definition,hash FROM remote_program_catalog WHERE id=? AND owner=? AND revoked=0').get(uuid(catalogId), JSON.stringify(owner))
    if (!row) throw new ProtocolError('not_found', 404)
    const review: ProgramReview = { id: randomUUID(), podId, catalogId, owner, revision: 1, podRevision: this.store.getPod(podId).revision, resourceEpoch: this.resources.epoch(podId), hash: row.hash as string, expiresAt: this.now() + 300000, state: 'pending', program: this.visible(JSON.parse(row.definition as string)), applicationId: randomUUID() }
    this.store.db.prepare('INSERT INTO remote_program_reviews VALUES(?,?,?)').run(review.id, podId, JSON.stringify(review))
    return review
  }

  reviews(owner: Owner, podId: string): ProgramReview[] {
    return this.store.db.prepare('SELECT body FROM remote_program_reviews WHERE pod_id=? ORDER BY rowid DESC LIMIT 20').all(podId).map(row => JSON.parse(row.body as string) as ProgramReview).filter(review => sameOwner(review.owner, owner))
  }

  async decide(owner: Owner, podId: string, id: string, revision: number, epoch: number, decision: 'approve' | 'deny', state: RemoteProgramState, authorize: () => void, commit: (value: unknown) => unknown): Promise<unknown> {
    const review = this.reviews(owner, podId).find(item => item.id === id)
    if (!review || review.revision !== revision || review.state !== 'pending' || review.expiresAt <= this.now() || review.resourceEpoch !== epoch || this.resources.epoch(podId) !== epoch || review.podRevision !== this.store.getPod(podId).revision) throw new ProtocolError('revision_conflict', 409)
    if (decision === 'deny') return this.store.transaction(() => { review.state = 'denied'; this.save(review); return commit({ review }) })
    const definition = this.definition(review)
    await Promise.all([verifyExecutable(definition.executable, definition.executableHash), verifyExecutable(definition.adapterPath, definition.adapterHash), ...definition.entryFiles.map(file => verifyExecutable(file.path, file.hash))])
    const stateId = await state.create(podId, review.applicationId)
    try {
      authorize(); this.definition(review)
      const current = this.store.db.prepare('SELECT body FROM remote_program_reviews WHERE id=?').get(review.id)
      if (!current || current.body !== JSON.stringify(review)) throw new ProtocolError('revision_conflict', 409)
      if (review.expiresAt <= this.now() || review.podRevision !== this.store.getPod(podId).revision) throw new ProtocolError('revision_conflict', 409)
      return this.store.transaction(() => {
        this.resources.assignProgram(podId, review.applicationId, { ...definition, type: 'program', stateId: uuid(stateId), capability: `tool.app_${review.applicationId.replaceAll('-', '')}.invoke`, grants: [] }, epoch)
        review.state = 'approved'; this.save(review)
        return commit({ review, resourceEpoch: this.resources.epoch(podId) })
      })
    }
    catch (error) { await state.discard(podId, stateId); throw error }
  }

  private definition(review: ProgramReview): ProgramDefinition {
    const row = this.store.db.prepare('SELECT definition,hash FROM remote_program_catalog WHERE id=? AND owner=? AND revoked=0').get(review.catalogId, JSON.stringify(review.owner))
    if (!row || row.hash !== review.hash) throw new ProtocolError('revision_conflict', 409)
    return JSON.parse(row.definition as string)
  }

  private save(review: ProgramReview): void { this.store.db.prepare('UPDATE remote_program_reviews SET body=? WHERE id=?').run(JSON.stringify(review), review.id) }
}
