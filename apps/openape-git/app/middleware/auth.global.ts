import { useOpenApeAuth } from '#imports'
import { rememberReturnPath } from '~/utils/return-to'

// Client-only: the session lives in an httpOnly cookie that `fetchUser` trades
// for an identity, and sessionStorage — where the target is parked across the
// OIDC round trip — does not exist during SSR.
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || to.path === '/') return

  const { user, fetchUser } = useOpenApeAuth()
  await fetchUser()
  if (user.value) return

  rememberReturnPath(to.fullPath)
  return navigateTo('/')
})
