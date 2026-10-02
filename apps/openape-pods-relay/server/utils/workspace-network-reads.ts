import { randomUUID } from 'node:crypto'
import { ProtocolError } from '@openape/pods-protocol'
import { centralReadLifetime, parseCentralNetworkRead, parseCentralNetworkResult } from '../../../openape-pods/src/contracts/central-networks'
import type { CentralNetworkRead } from '../../../openape-pods/src/contracts/central-networks'
import type { NetworkView } from '../../../openape-pods/src/contracts/networks'

interface Read {
  id: string
  runtimeId: string
  owner: string
  lease: string
  expires: number
  command: CentralNetworkRead
  claimed: boolean
  result?: { value: NetworkView | null, error: string | null }
}

export class WorkspaceNetworkReads {
  private readonly pending = new Map<string, Read>()
  constructor(private readonly now: () => number) {}

  private prune(): void {
    for (const [id, query] of this.pending) {
      if (query.expires <= this.now()) this.pending.delete(id)
    }
  }

  submit(owner: string, runtimeId: string, lease: string, command: unknown): string {
    this.prune()
    if (this.pending.size >= 64 || [...this.pending.values()].filter(query => query.owner === owner).length >= 32 || [...this.pending.values()].filter(query => query.runtimeId === runtimeId).length >= 16) throw new ProtocolError('workspace_read_busy', 429)
    const parsed = parseCentralNetworkRead(command)
    const id = randomUUID()
    this.pending.set(id, { id, owner, runtimeId, lease, command: parsed, expires: this.now() + centralReadLifetime, claimed: false })
    return id
  }

  cancel(owner: string, runtimeId: string, id: string): void {
    const query = this.pending.get(id)
    if (query?.owner === owner && query.runtimeId === runtimeId) this.pending.delete(id)
  }

  claim(runtimeId: string, lease: string): { id: string, command: CentralNetworkRead } | null {
    this.prune()
    const query = [...this.pending.values()].find(query => query.runtimeId === runtimeId && query.lease === lease && !query.claimed)
    if (!query) return null
    query.claimed = true
    return { id: query.id, command: query.command }
  }

  complete(runtimeId: string, lease: string, id: string, value: unknown, error: string | null): void {
    this.prune()
    const query = this.pending.get(id)
    if (!query || query.runtimeId !== runtimeId || query.lease !== lease || !query.claimed || query.result) throw new ProtocolError('workspace_read_expired', 409)
    if (error !== null && (typeof error !== 'string' || error.length > 2000)) throw new ProtocolError('invalid_workspace_read')
    query.result = { value: error === null ? parseCentralNetworkResult(value) : null, error }
  }

  result(runtimeId: string, lease: string, id: string): Read['result'] {
    this.prune()
    const query = this.pending.get(id)
    if (!query || query.runtimeId !== runtimeId || query.lease !== lease) throw new ProtocolError('workspace_read_expired', 409)
    if (query.result) this.pending.delete(id)
    return query.result
  }
}
