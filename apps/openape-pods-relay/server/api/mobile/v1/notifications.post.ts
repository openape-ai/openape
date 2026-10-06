import { object, text } from '@openape/pods-protocol'
import { actor, body, boundary, relay } from '../../../utils/service'
import { notifier } from '../../../utils/runtime'

export default defineEventHandler(event => boundary(event, async () => {
  const caller = actor(event)
  const input = object(await body(event), ['token', 'environment'])
  relay().registerPush(caller, text(input.token, 400), text(input.environment, 11))
  return { registered: true, enabled: notifier().enabled }
}))
