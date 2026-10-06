import { text } from '@openape/pods-protocol'
import { auth, boundary } from '../../utils/service'

export default defineEventHandler(event => boundary(event, async () => {
  const result = await auth().start(text(getQuery(event).id, 36))
  setCookie(event, 'pods-relay-flow', result.browserSecret, { httpOnly: true, secure: getRequestURL(event).protocol === 'https:', sameSite: 'lax', path: '/mobile-auth', maxAge: 300 })
  return sendRedirect(event, result.url)
}))
