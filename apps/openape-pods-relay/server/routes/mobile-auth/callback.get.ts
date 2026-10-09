import { text } from '@openape/pods-protocol'
import { auth, boundary } from '../../utils/service'

export default defineEventHandler(event => boundary(event, async () => {
  const query = getQuery(event)
  await auth().callback(text(query.state, 256), text(query.code, 2048), getCookie(event, 'pods-relay-flow') ?? '')
  deleteCookie(event, 'pods-relay-flow', { path: '/mobile-auth' })
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  return '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>OpenApe Pods</title><main><h1>Desktop registered</h1><p>Return to OpenApe Pods to finish registering this desktop.</p></main></html>'
}))
