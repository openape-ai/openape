import { ProtocolError, uuid } from '@openape/pods-protocol'
import { actor, boundary, relay } from '../../../../utils/service'
import { hub } from '../../../../utils/runtime'

export default defineEventHandler(event => boundary(event, () => {
  const caller = actor(event)
  const id = uuid(getRouterParam(event, 'id'))
  if (relay().registration(id).kind !== 'runtime') throw new ProtocolError('not_found', 404)
  relay().revoke(caller, id)
  hub().disconnect(id)
  return { revoked: true }
}))
