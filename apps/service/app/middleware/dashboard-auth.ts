export default defineNuxtRouteMiddleware(async () => {
  const { data, error } = await useFetch('/api/me')
  if (error.value || !data.value) {
    return navigateTo('/login')
  }
})
