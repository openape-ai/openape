import { setTimeout as delay } from 'node:timers/promises'
import { ProtocolError } from '@openape/pods-protocol'
import { centralId, centralObject } from '../../../../../openape-pods/src/contracts/central'
import { centralReadLifetime, parseCentralNetworkRead } from '../../../../../openape-pods/src/contracts/central-networks'
import { boundary } from '../../../utils/service'
import { workspace, workspaceBody, workspaceBoundary, workspaceOwner } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const owner = await workspaceOwner(event)
  const body = centralObject(await workspaceBody(event, 4096))
  if (Object.keys(body).some(key => !['runtimeId', 'command'].includes(key))) throw new ProtocolError('invalid_workspace_read')
  const runtimeId = centralId(body.runtimeId)
  const store = workspace()
  const id = store.requestNetworkRead(owner, runtimeId, parseCentralNetworkRead(body.command))
  const deadline = Date.now() + centralReadLifetime
  try {
    while (Date.now() < deadline && !event.node.res.destroyed) {
      const result = store.networkReadResult(owner, runtimeId, id)
      if (result) {
        if (result.error) throw new ProtocolError(result.error, 409)
        return result.value
      }
      await delay(100)
    }
    throw new ProtocolError('workspace_runtime_read_timed_out', 504)
  }
  finally { store.cancelNetworkRead(owner, runtimeId, id) }
})))
