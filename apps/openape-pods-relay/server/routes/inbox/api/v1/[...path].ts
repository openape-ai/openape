import { ProtocolError } from '@openape/pods-protocol'
import { centralObject } from '../../../../../../openape-pods/src/contracts/central'
import { boundary } from '../../../../utils/service'
import { workspaceBody, workspaceBoundary } from '../../../../utils/workspace'
import { inboxCaller, inboxStore, signOut } from '../../../../utils/inbox-service'
import { parseSubscription } from '../../../../utils/inbox-store'

const id = /^[0-9a-f-]{36}$/
function flag(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value
  throw new ProtocolError('invalid_inbox_change')
}

// Owner-facing inbox API (plan M1). Every route resolves the human session and its active device first.
export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const path = getRouterParam(event, 'path') ?? ''
  const { owner, device } = await inboxCaller(event)
  const store = inboxStore()
  const query = getQuery(event)

  if (path === 'session' && event.method === 'GET') return { issuer: owner.issuer, subject: owner.subject, device: device.id, vapidPublicKey: String(useRuntimeConfig().inboxVapidPublicKey) }
  if (path === 'items' && event.method === 'GET') return store.list(owner, { kind: String(query.kind ?? ''), archived: query.archived === '1', before: Number(query.before ?? 0) })
  if (path === 'changes' && event.method === 'GET') return store.changes(owner, Number(query.after ?? 0) || 0)
  if (path === 'devices' && event.method === 'GET') return { current: device.id, devices: store.devices(owner) }
  if (path === 'logout' && event.method === 'POST') { store.revokeDevice(owner, device.id); await signOut(event); return { ok: true } }
  if (path === 'push/subscribe' && event.method === 'POST') { store.subscribe(owner, device.id, parseSubscription(centralObject(await workspaceBody(event, 4096)).subscription)); return { ok: true } }
  if (path === 'push/unsubscribe' && event.method === 'POST') { store.unsubscribe(owner, device.id); return { ok: true } }

  const revoke = /^devices\/([^/]+)\/revoke$/.exec(path)
  if (revoke && event.method === 'POST' && id.test(revoke[1]!)) {
    store.revokeDevice(owner, revoke[1]!)
    if (revoke[1] === device.id) await signOut(event)
    return { ok: true }
  }
  const item = /^items\/([^/]+)$/.exec(path)
  if (item && id.test(item[1]!)) {
    if (event.method === 'GET') return { item: store.item(owner, item[1]!) }
    if (event.method === 'PATCH') {
      const change = centralObject(await workspaceBody(event, 1024))
      if (Object.keys(change).some(field => !['read', 'archived', 'deleted'].includes(field))) throw new ProtocolError('invalid_inbox_change')
      return { item: store.mark(owner, item[1]!, { read: flag(change.read), archived: flag(change.archived), deleted: flag(change.deleted) }) }
    }
  }
  throw new ProtocolError('not_found', 404)
})))
