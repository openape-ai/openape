<script setup lang="ts">
// The nuxt-auth-sp callback handler hard-codes a redirect to /dashboard
// after successful login. Our app's "home" is the room list at /, so this
// page just bounces. Once the SP module accepts a configurable post-login
// route we can drop this file.
onMounted(() => {
  navigateTo('/', { replace: true })
})
</script>

<template>
  <div class="min-h-dvh flex items-center justify-center text-zinc-500 text-sm">
    Signing you in…
  </div>
</template>
