<script setup lang="ts">
// @openape/nuxt-auth-sp redirects here after the OAuth callback (hardcoded
// in the module's callback.get handler). We bounce to the caller's intended
// destination (saved in sessionStorage before login, e.g. by the invite
// page) or to /companies as the default landing page.
onMounted(async () => {
  let target = '/me'
  if (typeof window !== 'undefined') {
    const stored = window.sessionStorage.getItem('openape-timetrack:returnTo')
    if (stored && stored.startsWith('/')) {
      target = stored
      window.sessionStorage.removeItem('openape-timetrack:returnTo')
    }
  }
  await navigateTo(target, { replace: true })
})
</script>

<template>
  <div class="min-h-dvh flex items-center justify-center bg-zinc-950 text-zinc-500">
    Redirecting…
  </div>
</template>
