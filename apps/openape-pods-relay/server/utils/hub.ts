import { randomUUID } from 'node:crypto'
import { limits, ProtocolError } from '@openape/pods-protocol'
import type { Capabilities } from '@openape/pods-protocol'
import type { RelayStore, Registration } from './store'

interface Peer { id: string, send: (data: string) => unknown, close: (code: number, reason: string) => unknown }
interface Connection { peer: Peer, token: string, runtime: Registration, connectionId: string, lastSeen: number, capabilities: Capabilities }
export class RuntimeHub {
  private readonly connections = new Map<string, Connection>()
  constructor(private readonly store: RelayStore) {}
  online(id: string): boolean {
    const connection = this.connections.get(id)
    if (!connection || this.store.now() - connection.lastSeen > 45000) return false
    try { this.store.authenticate(connection.token, 'runtime'); return true }
    catch { this.disconnect(id); return false }
  }

  capabilities(id: string): Capabilities | null { return this.online(id) ? this.connections.get(id)!.capabilities : null }

  supports(id: string, direction: string, kind: string): boolean {
    const supported = this.capabilities(id)
    return !!supported && (direction === 'command' ? supported.commands : supported.queries).includes(kind)
  }

  connect(peer: Peer, token: string, capabilities: Capabilities): void {
    const runtime = this.store.authenticate(token, 'runtime')
    this.disconnect(runtime.id)
    const connection = { peer, token, runtime, connectionId: randomUUID(), lastSeen: this.store.now(), capabilities }
    this.connections.set(runtime.id, connection)
    peer.send(JSON.stringify({ type: 'ready', protocol: 1, capabilities, connectionId: connection.connectionId, runtime, devices: this.store.list(runtime, 'mobile'), leaseUntil: this.lease() }))
    this.dispatch(runtime.id)
  }

  private lease(): string { return new Date(this.store.now() + limits.dispatchLeaseMs).toISOString() }
  private current(peerId: string): Connection {
    const connection = [...this.connections.values()].find(item => item.peer.id === peerId)
    if (!connection || !this.online(connection.runtime.id)) throw new ProtocolError('runtime_session_expired', 401)
    return connection
  }

  heartbeat(peerId: string): void {
    const connection = this.current(peerId); connection.lastSeen = this.store.now()
    connection.peer.send(JSON.stringify({ type: 'heartbeat', connectionId: connection.connectionId, leaseUntil: this.lease(), devices: this.store.list(connection.runtime, 'mobile') }))
    this.dispatch(connection.runtime.id)
  }

  dispatch(runtimeId: string): void {
    if (!this.online(runtimeId)) return
    const connection = this.connections.get(runtimeId)!
    for (const envelope of this.store.pending(connection.runtime)) {
      if (!this.supports(runtimeId, envelope.route.direction, envelope.route.kind)) continue
      connection.peer.send(JSON.stringify({ type: 'operation', connectionId: connection.connectionId, leaseUntil: this.lease(), envelope }))
    }
  }

  pair(peerId: string, deviceId: string): void {
    const connection = this.current(peerId)
    this.store.pair(connection.runtime, deviceId)
    connection.peer.send(JSON.stringify({ type: 'paired', deviceId }))
  }

  unpair(peerId: string, deviceId: string): void {
    const connection = this.current(peerId)
    this.store.unpair(connection.runtime, deviceId)
    connection.peer.send(JSON.stringify({ type: 'unpaired', deviceId }))
  }

  deliver(peerId: string, envelope: unknown): void {
    const connection = this.current(peerId)
    const cursor = this.store.deliver(connection.runtime, envelope)
    const id = (envelope as { route: { id: string } }).route.id
    connection.peer.send(JSON.stringify({ type: 'ack', id, cursor }))
  }

  close(peerId: string): void {
    for (const [id, connection] of this.connections) {
      if (connection.peer.id === peerId) this.connections.delete(id)
    }
  }

  disconnect(id: string): void {
    const connection = this.connections.get(id)
    this.connections.delete(id)
    connection?.peer.close(1008, 'Runtime connection replaced or revoked')
  }

  tick(): void {
    for (const id of this.connections.keys()) {
      if (!this.online(id)) this.disconnect(id)
    }
    this.store.purge()
  }
}
