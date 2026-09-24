import { ProtocolError, text } from '@openape/pods-protocol'
import { centralId, centralObject, centralRevision, parseRuntimeCentralCommand } from '../../../../../openape-pods/src/contracts/central'
import { actor, boundary } from '../../../utils/service'
import { workspace, workspaceBody, workspaceBoundary } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const runtime = actor(event, 'runtime')
  const body = centralObject(await workspaceBody(event, 48 * 1024 * 1024))
  const store = workspace()
  if (body.type === 'begin') return store.begin(runtime)
  const lease = centralId(body.lease)
  store.assertLease(runtime, lease)
  if (body.type === 'heartbeat') { store.heartbeat(runtime, lease, text(body.hash, 64)); return { ok: true } }
  if (body.type === 'disconnect') { store.disconnect(runtime, lease); return { ok: true } }
  if (body.type === 'archive') return store.archive(runtime, lease)
  if (body.type === 'claim') return new Response(JSON.stringify(store.claim(runtime, lease)), { headers: { 'content-type': 'application/json' } })
  if (body.type === 'publish') {
    let completion: { id: string, result: unknown, error: string | null } | undefined
    if (body.completion !== undefined) {
      const value = centralObject(body.completion)
      completion = { id: centralId(value.id), result: value.result ?? null, error: value.error === null ? null : text(value.error, 4096) }
    }
    return store.publish(runtime, lease, centralId(body.id), centralRevision(body.revision), body.snapshot, completion)
  }
  if (body.type === 'artifact') {
    if (typeof body.content !== 'string' || body.content.length > 45 * 1024 * 1024) throw new ProtocolError('invalid_artifact_encoding')
    const content = Buffer.from(body.content, 'base64')
    if (content.toString('base64') !== body.content) throw new ProtocolError('invalid_artifact_encoding')
    store.putArtifact(runtime, lease, centralId(body.podId), text(body.hash, 64), content)
    return { ok: true }
  }
  if (body.type === 'submit') {
    const target = body.runtimeId ? centralId(body.runtimeId) : runtime.id
    return store.submit(runtime.owner, target, centralRevision(body.revision), parseRuntimeCentralCommand(body.command), centralId(body.id), target === runtime.id)
  }
  if (body.type === 'operation') {
    const operation = store.operation(runtime.owner, centralId(body.id))
    return operation.runtimeId === runtime.id ? operation : store.visibleOperation(runtime.owner, operation.id)
  }
  if (body.type === 'inventory') return store.inventory(runtime.owner)
  if (body.type === 'read') return store.read(runtime.owner, body.runtimeId ? centralId(body.runtimeId) : runtime.id, centralId(body.podId))
  throw new ProtocolError('unsupported_workspace_request')
})))
