import { parseEnvelope, ProtocolError } from '@openape/pods-protocol'
import { actor, body, boundary, relay } from '../../../utils/service'
import { hub } from '../../../utils/runtime'

export default defineEventHandler(event => boundary(event, async () => {
  const caller = actor(event); const envelope = parseEnvelope(await body(event))
  const receipt = relay().admit(caller, envelope, (id) => {
    if (!hub().online(id)) return false
    if (!hub().supports(id, envelope.route.direction, envelope.route.kind)) throw new ProtocolError('unsupported_operation', 426)
    return true
  })
  hub().dispatch(envelope.route.runtimeId)
  setResponseStatus(event, 202)
  return receipt
}))
