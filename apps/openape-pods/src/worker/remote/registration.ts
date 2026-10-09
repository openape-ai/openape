import { parseOwner, ProtocolError, sameOwner, uuid } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import type { PodDatabase } from '../storage/database'

export interface RemoteRegistration { id: string, generation: string, owner: Owner }
export type RemoteInternal =
  | { type: 'configure', registration: RemoteRegistration }
  | { type: 'disable' }
  | { type: 'status' }
  | { type: 'provision', podId: string, identity: unknown, error: string | null }
  | { type: 'claim', podId: string, owner: Owner, identity: unknown }

export class DesktopRegistration {
  constructor(private readonly store: PodDatabase) {}

  private registration(): RemoteRegistration {
    const row = this.store.db.prepare('SELECT body FROM remote_registration WHERE id=1').get()
    if (!row) throw new ProtocolError('remote_access_disabled', 403)
    return JSON.parse(row.body as string)
  }

  private ownerPod(owner: Owner, podId: string): void {
    const binding = this.store.db.prepare('SELECT owner FROM remote_pods WHERE pod_id=?').get(podId)
    if (!binding || !sameOwner(owner, JSON.parse(binding.owner as string))) throw new ProtocolError('not_found', 404)
  }

  execute(command: RemoteInternal): unknown {
    if (command.type === 'status') {
      const row = this.store.db.prepare('SELECT body,enabled FROM remote_registration WHERE id=1').get()
      return { registration: row ? JSON.parse(row.body as string) : null, enabled: row?.enabled === 1 }
    }
    if (command.type === 'disable') { this.store.db.prepare('UPDATE remote_registration SET enabled=0').run(); return { enabled: false } }
    if (command.type === 'configure') return this.configure(command.registration)
    const registration = this.registration()
    if (command.type === 'claim') return this.claim(registration, command.podId, command.owner, command.identity)
    this.ownerPod(registration.owner, command.podId)
    const prior = this.store.db.prepare('SELECT identity FROM remote_pods WHERE pod_id=?').get(command.podId)!
    if (prior.identity && prior.identity !== JSON.stringify(command.identity)) throw new ProtocolError('pod_identity_conflict', 409)
    this.store.db.prepare('UPDATE remote_pods SET phase=?,identity=?,error=? WHERE pod_id=?').run(command.error ? 'needs_desktop_action' : 'ready', command.identity ? JSON.stringify(command.identity) : null, command.error, command.podId)
    return { saved: true }
  }

  private configure(registration: RemoteRegistration) {
    uuid(registration.id); uuid(registration.generation); parseOwner(registration.owner)
    const existing = this.store.db.prepare('SELECT body FROM remote_registration WHERE id=1').get()
    const previous = existing ? JSON.parse(existing.body as string) as RemoteRegistration : null
    if (previous && !sameOwner(previous.owner, registration.owner)) throw new ProtocolError('runtime_owner_conflict', 409)
    this.store.transaction(() => {
      if (previous && (previous.id !== registration.id || previous.generation !== registration.generation)) {
        this.store.db.prepare('UPDATE remote_pods SET runtime_id=?,generation=? WHERE owner=?').run(registration.id, registration.generation, JSON.stringify(registration.owner))
      }
      this.store.db.prepare('INSERT INTO remote_registration VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body,enabled=1').run(JSON.stringify(registration))
    })
    return { enabled: true }
  }

  private claim(registration: RemoteRegistration, podId: string, owner: Owner, identity: unknown) {
    if (!sameOwner(registration.owner, owner)) throw new ProtocolError('wrong_owner', 403)
    this.store.getPod(podId)
    const existing = this.store.db.prepare('SELECT owner,identity FROM remote_pods WHERE pod_id=?').get(podId)
    if (existing && !sameOwner(JSON.parse(existing.owner as string), owner)) throw new ProtocolError('pod_owner_conflict', 409)
    if (existing?.identity && existing.identity !== JSON.stringify(identity)) throw new ProtocolError('pod_identity_conflict', 409)
    this.store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,\'ready\',?,NULL) ON CONFLICT(pod_id) DO UPDATE SET runtime_id=excluded.runtime_id,generation=excluded.generation WHERE runtime_id IS NOT excluded.runtime_id OR generation IS NOT excluded.generation').run(podId, JSON.stringify(owner), registration.id, registration.generation, JSON.stringify(identity))
    return { claimed: true }
  }
}
