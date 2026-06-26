<script setup lang="ts">
// @openape/nuxt-auth-sp redirects here after OAuth callback. We bounce to the
// caller's intended destination (saved in sessionStorage before login) or to
// /teams as the default landing page.
onMounted(async () => {
  let target = '/teams'
  if (typeof window !== 'undefined') {
    const stored = window.sessionStorage.getItem('openape-tasks:returnTo')
    if (stored && stored.startsWith('/')) {
      target = stored
      window.sessionStorage.removeItem('openape-tasks:returnTo')
    }
  }
  await navigateTo(target, { replace: true })
})
</script>

<template>
  <div class="min-h-dvh flex items-center justify-center text-gray-500">
    Redirecting…
  </div>
</template>
