import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'

interface Row { id: string, rowid: number, account: string, state: string, metadata: Record<string, unknown> }
type Bindings = Record<string, { connectionId?: string }>
export interface AccountCleanup { connections: string[], podKeys: { id: string, podId: string }[] }

const bindings = (row: Row): Bindings => (row.metadata.pods ?? {}) as Bindings
function identity(row: Row): string | null {
  const verified = typeof row.metadata.subject === 'string' || Object.keys(bindings(row)).length > 0 || ['ready', 'expired', 'revoked'].includes(row.state)
  return verified && typeof row.metadata.issuer === 'string' ? `${row.metadata.issuer}\n${row.account.toLowerCase()}` : null
}

export function usesConnection(configuration: Record<string, unknown>, id: string): boolean {
  const authority = configuration.authority as { ownerConnection?: string } | undefined
  const grants = Array.isArray(configuration.grants) ? configuration.grants as { authority?: { ownerConnection?: string } }[] : []
  return [configuration.connectionId, configuration.ownerConnection, authority?.ownerConnection].includes(id) || grants.some(grant => grant.authority?.ownerConnection === id)
}

export function revokeConnectionUse(store: PodDatabase, resources: ResourceRegistry, id: string): void {
  for (const pod of store.listPods()) {
    for (const resource of resources.list(pod.id)) {
      if (resource.state !== 'revoked' && usesConnection(resource.configuration, id)) resources.revoke(pod.id, resource.id, resource.revision)
    }
  }
}

// Earlier releases created one row per sign-in attempt and allowed several owners.
// Keep one Codex row and one DDISA owner row; Pods bound to another identity are re-provisioned under the owner later.
export function reconcileAccounts(store: PodDatabase, resources: ResourceRegistry): AccountCleanup {
  return store.transaction(() => {
    const cleanup: AccountCleanup = { connections: [], podKeys: [] }
    const rows = (provider: string): Row[] => store.db.prepare('SELECT rowid,id,account,state,metadata FROM connections WHERE provider=? ORDER BY rowid').all(provider).map(row => ({ id: row.id as string, rowid: row.rowid as number, account: row.account as string, state: row.state as string, metadata: JSON.parse(row.metadata as string) as Record<string, unknown> }))
    const remove = (row: Row) => { store.db.prepare('DELETE FROM connections WHERE id=?').run(row.id); cleanup.connections.push(row.id) }
    const defaultOwner = store.db.prepare('SELECT default_owner FROM onboarding WHERE id=1').get()!.default_owner as string | null
    store.db.prepare('UPDATE onboarding SET default_owner=NULL WHERE id=1').run()

    const codex = rows('chatgpt')
    const keptCodex = [...codex].reverse().find(row => row.state === 'ready') ?? codex.at(-1)
    for (const row of codex) {
      if (row !== keptCodex) remove(row)
    }

    const owners = rows('openape')
    const verified = owners.filter(row => identity(row))
    const weight = (key: string | null) => verified.filter(row => identity(row) === key).reduce((sum, row) => sum + Object.keys(bindings(row)).length, 0)
    const rank = (row: Row) => [row.id === defaultOwner ? 1 : 0, weight(identity(row)), Object.keys(bindings(row)).length, row.state === 'ready' ? 1 : 0, row.rowid]
    const better = (a: Row, b: Row) => { const left = rank(a); const right = rank(b); const index = left.findIndex((value, position) => value !== right[position]); return index >= 0 && left[index] > right[index] }
    const canonical = verified.reduce<Row | undefined>((best, row) => !best || better(row, best) ? row : best, undefined)
    const ownerKey = canonical ? identity(canonical) : null

    for (const row of owners) {
      if (row === canonical) continue
      if (ownerKey && identity(row) === ownerKey) {
        const merged = bindings(canonical!)
        for (const [podId, entry] of Object.entries(bindings(row))) {
          if (Object.hasOwn(merged, podId)) { if (typeof entry.connectionId === 'string' && entry.connectionId !== merged[podId].connectionId) cleanup.podKeys.push({ id: entry.connectionId, podId }) }
          else {
            merged[podId] = entry
          }
        }
        canonical!.metadata.pods = merged
        canonical!.metadata.broker ??= row.metadata.broker
        store.db.prepare('UPDATE resources SET configuration=replace(configuration,?,?) WHERE instr(configuration,?)>0').run(row.id, canonical!.id, row.id)
      }
      else {
        for (const [podId, entry] of Object.entries(bindings(row))) {
          if (typeof entry.connectionId === 'string') cleanup.podKeys.push({ id: entry.connectionId, podId })
          store.db.prepare('DELETE FROM remote_pods WHERE pod_id=?').run(podId)
        }
        revokeConnectionUse(store, resources, row.id)
      }
      remove(row)
    }
    if (canonical) store.db.prepare('UPDATE connections SET metadata=? WHERE id=?').run(JSON.stringify(canonical.metadata), canonical.id)
    return cleanup
  })
}
