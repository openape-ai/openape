import { ProtocolError, uuid } from '@openape/pods-protocol'
import { actor, boundary, relay } from '../../../../utils/service'

export default defineEventHandler(event => boundary(event, () => {
  const caller = actor(event)
  const id = uuid(getRouterParam(event, 'id'))
  if (relay().registration(id).kind !== 'mobile') throw new ProtocolError('not_found', 404)
  relay().revoke(caller, id)
  return { revoked: true }
}))
