import { actor, boundary, relay } from '../../../utils/service'
import { hub } from '../../../utils/runtime'

export default defineEventHandler(event => boundary(event, () => relay().list(actor(event), 'runtime').map(runtime => ({ ...runtime, online: hub().online(runtime.id), capabilities: hub().capabilities(runtime.id) }))))
