import { ProtocolError } from '@openape/pods-protocol'
import { setTimeout as delay } from 'node:timers/promises'
import { centralId, centralObject } from '../../../../../../openape-pods/src/contracts/central'
import type { CentralOperation } from '../../../../../../openape-pods/src/contracts/central'
import { inboxDecisionLimits } from '../../../../../../openape-pods/src/contracts/inbox'
import { boundary } from '../../../../utils/service'
import { workspace, workspaceBody, workspaceBoundary } from '../../../../utils/workspace'
import { inboxCaller, inboxStore, signOut } from '../../../../utils/inbox-service'
import { parseSubscription } from '../../../../utils/inbox-store'

const id = /^[0-9a-f-]{36}$/
function flag(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value
  throw new ProtocolError('invalid_inbox_change')
}

// The desktop accepts one workspace operation at a time; a phone decision waits briefly for a running one.
async function submitDecision(submit: () => CentralOperation): Promise<CentralOperation> {
  const deadline = Date.now() + 10000
  for (;;) {
    try { return submit() }
    catch (error) {
      const busy = error instanceof ProtocolError && error.status === 409 && ['workspace_busy', 'workspace_revision_conflict'].includes(error.code)
      if (!busy || Date.now() >= deadline) throw error
      await delay(250)
    }
  }
}

// Owner-facing inbox API (plan M1). Every route resolves the human session and its active device first.
export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const path = getRouterParam(event, 'path') ?? ''
  const { owner, device } = await inboxCaller(event)
  const store = inboxStore()
  const query = getQuery(event)

  if (path === 'session' && event.method === 'GET') return { issuer: owner.issuer, subject: owner.subject, device: device.id, vapidPublicKey: String(useRuntimeConfig().inboxVapidPublicKey) }
  if (path === 'items' && event.method === 'GET') return store.list(owner, { kind: String(query.kind ?? ''), archived: query.archived === '1', before: Number(query.before ?? 0) })
  // The device lets a client notice that another sign-in in this browser replaced its session (and maybe its account).
  if (path === 'changes' && event.method === 'GET') return { ...store.changes(owner, Number(query.after ?? 0) || 0), device: device.id }
  if (path === 'devices' && event.method === 'GET') return { current: device.id, devices: store.devices(owner) }
  if (path === 'logout' && event.method === 'POST') { await signOut(event); return { ok: true } }
  if (path === 'push/subscribe' && event.method === 'POST') { store.subscribe(owner, device.id, parseSubscription(centralObject(await workspaceBody(event, 4096)).subscription)); return { ok: true } }
  if (path === 'push/unsubscribe' && event.method === 'POST') { store.unsubscribe(owner, device.id); return { ok: true } }

  const revoke = /^devices\/([^/]+)\/revoke$/.exec(path)
  if (revoke && event.method === 'POST' && id.test(revoke[1]!)) {
    if (revoke[1] === device.id) await signOut(event)
    else store.revokeDevice(owner, revoke[1]!)
    return { ok: true }
  }
  // A decision leaves only as the desktop's own command; the desktop re-reads the source and checks the digest
  // the phone displayed. A retry with the same request id returns the operation it already created.
  const decide = /^items\/([^/]+)\/decide$/.exec(path)
  if (decide && event.method === 'POST' && id.test(decide[1]!)) {
    const input = centralObject(await workspaceBody(event, 8 * 1024))
    if (Object.keys(input).some(field => !['option', 'input', 'digest', 'requestId'].includes(field))) throw new ProtocolError('invalid_inbox_decision')
    const requestId = centralId(input.requestId)
    const retried = workspace().existingOperation(owner, requestId)
    if (retried) {
      if (retried.command.channel !== 'inbox' || retried.command.body.digest !== input.digest || retried.command.body.option !== input.option) throw new ProtocolError('workspace_operation_conflict', 409)
      return { operation: retried }
    }
    const { item: stored, digest } = store.openDecision(owner, decide[1]!)
    if (input.digest !== digest) throw new ProtocolError('decision_changed', 409)
    const option = stored.decision?.options.find(entry => entry.key === input.option)
    if (!stored.decision || !option) throw new ProtocolError('invalid_inbox_option')
    // Evidence or a typed value travels only for options that ask for it.
    const text = typeof input.input === 'string' ? input.input.trim() : ''
    if ((input.input !== undefined && typeof input.input !== 'string') || text.length > inboxDecisionLimits.input || (option.input && !text) || (!option.input && text)) throw new ProtocolError('invalid_inbox_input')
    const command = { channel: 'inbox' as const, body: { type: 'decide', sourceId: stored.decision.sourceId, digest, option: option.key, ...(text ? { input: text } : {}) } }
    const runtimeId = stored.decision.runtimeId
    return { operation: await submitDecision(() => workspace().submitDecision(owner, runtimeId, command, requestId)) }
  }
  const operation = /^operations\/([^/]+)$/.exec(path)
  if (operation && event.method === 'GET' && id.test(operation[1]!)) return { operation: workspace().visibleOperation(owner, operation[1]!) }

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
