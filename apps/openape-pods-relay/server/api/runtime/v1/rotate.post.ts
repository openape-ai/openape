import { actor, body, boundary, relay } from '../../../utils/service'
import { hub } from '../../../utils/runtime'

export default defineEventHandler(event => boundary(event, async () => {
  const runtime = actor(event, 'runtime')
  await body(event)
  hub().disconnect(runtime.id)
  return relay().rotate(runtime)
}))
