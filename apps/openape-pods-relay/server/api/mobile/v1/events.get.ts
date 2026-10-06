import { text } from '@openape/pods-protocol'
import { actor, boundary, relay } from '../../../utils/service'

export default defineEventHandler(event => boundary(event, () => ({ events: relay().events(actor(event), text(getQuery(event).cursor ?? '0', 19)) })))
