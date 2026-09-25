import { object, text } from '@openape/pods-protocol'
import { actor, body, boundary, relay } from '../../../utils/service'

export default defineEventHandler(event => boundary(event, async () => { const caller = actor(event); relay().acknowledge(caller, text(object(await body(event), ['cursor']).cursor, 19)); return { acknowledged: true } }))
