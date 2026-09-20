import { actor, boundary, relay } from '../../../../utils/service'

export default defineEventHandler(event => boundary(event, () => { const caller = actor(event); relay().revoke(caller, caller.id); return { revoked: true } }))
