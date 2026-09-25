import { uuid } from '@openape/pods-protocol'
import { actor, boundary, relay } from '../../../../utils/service'

export default defineEventHandler(event => boundary(event, () => relay().operation(actor(event), uuid(getRouterParam(event, 'id')))))
