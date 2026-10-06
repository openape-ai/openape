import { actor, boundary, relay } from '../../../utils/service'

export default defineEventHandler(event => boundary(event, () => { relay().unregisterPush(actor(event).id, 'opt_out'); return { registered: false } }))
