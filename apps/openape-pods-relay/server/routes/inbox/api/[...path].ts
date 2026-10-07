import { ProtocolError } from '@openape/pods-protocol'
import { centralObject } from '../../../../../openape-pods/src/contracts/central'
import { boundary } from '../../../utils/service'
import { workspaceBody, workspaceBoundary, workspaceOwner } from '../../../utils/workspace'
import { dispatchDuePushes, inbox, vapidPublicKey } from '../../../utils/inbox'
import { parseSubscription } from '../../../utils/inbox-prototype'

const id = /^[0-9a-f-]{36}$/

// ponytail: one small router for the disposable M0 prototype; M1 introduces the reviewed inbox API.
export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const path = getRouterParam(event, 'path') ?? ''
  const method = event.method
  const store = inbox()

  // The service worker reports display/click with the per-push secret token, also while signed out.
  if (path === 'receipt' && method === 'POST') {
    const body = centralObject(await workspaceBody(event, 1024))
    if (body.phase !== 'shown' && body.phase !== 'clicked') throw new ProtocolError('invalid_receipt')
    return { recorded: store.receipt(String(body.token), body.phase) }
  }

  const owner = await workspaceOwner(event)
  if (path === 'session' && method === 'GET') return { issuer: owner.issuer, subject: owner.subject, vapidPublicKey: vapidPublicKey(), devices: store.devices(owner), version: useRuntimeConfig().app.buildId }
  if (path === 'items' && method === 'GET') return { items: store.items(owner) }
  if (path === 'pushes' && method === 'GET') return { pushes: store.pushes(owner) }
  if (path === 'subscribe' && method === 'POST') {
    const body = centralObject(await workspaceBody(event, 4096))
    store.subscribe(owner, parseSubscription(body.subscription), getHeader(event, 'user-agent') ?? '')
    return { devices: store.devices(owner) }
  }
  if (path === 'unsubscribe' && method === 'POST') {
    const body = centralObject(await workspaceBody(event, 4096))
    store.unsubscribe(owner, String(body.endpoint))
    return { devices: store.devices(owner) }
  }
  if (path === 'schedule' && method === 'POST') {
    const body = centralObject(await workspaceBody(event, 4096))
    store.schedule(owner, body.times as number[])
    await dispatchDuePushes()
    return { pushes: store.pushes(owner) }
  }
  if (path === 'schedule/cancel' && method === 'POST') { store.cancelPending(owner); return { pushes: store.pushes(owner) } }

  const match = /^items\/([^/]+)(\/decide)?$/.exec(path)
  if (!match || !id.test(match[1]!)) throw new ProtocolError('not_found', 404)
  const itemId = match[1]!
  if (!match[2] && method === 'GET') {
    const push = getQuery(event).push
    if (typeof push === 'string' && id.test(push)) store.opened(owner, push, itemId)
    const item = store.item(owner, itemId)
    return { item: item.kind === 'message' ? store.markRead(owner, itemId) : item }
  }
  if (match[2] && method === 'POST') {
    const body = centralObject(await workspaceBody(event, 1024))
    return { item: store.decide(owner, itemId, String(body.choice)) }
  }
  throw new ProtocolError('not_found', 404)
})))
