import { object, text } from '@openape/pods-protocol'
import { body, boundary, relay } from '../../../../utils/service'

export default defineEventHandler(event => boundary(event, async () => {
  const request = object(await body(event), ['refreshToken', 'signature'])
  return relay().refresh(text(request.refreshToken, 128), text(request.signature, 128))
}))
