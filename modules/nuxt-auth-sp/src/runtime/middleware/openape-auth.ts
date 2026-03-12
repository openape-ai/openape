import { defineNuxtRouteMiddleware, navigateTo } from '#imports'
import { useOpenApeAuth } from '../composables/useOpenApeAuth'

export default defineNuxtRouteMiddleware(async () => {
  const { user, fetchUser, loading } = useOpenApeAuth()
  if (loading.value) await fetchUser()
  if (!user.value) return navigateTo('/')
})
