import { actor, boundary, relay } from '../../../utils/service'
import { hub } from '../../../utils/runtime'

export default defineEventHandler(event => boundary(event, () => {
  const device = actor(event)
  return relay().list(device, 'runtime').map(runtime => ({ ...runtime, online: hub().online(runtime.id), capabilities: hub().capabilities(runtime.id), paired: relay().isPaired(runtime, device) }))
}))
