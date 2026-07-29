<script setup lang="ts">
// The app frame. Resolving the session here once means pages read shared
// state instead of each fetching /api/me, and the identity bar can render
// above every signed-in page. Width is set per page by AppPage/AppHero, not
// clamped here — /grants and /admin need more room than a login card.
const { user, fetchUser } = useIdpAuth()

await fetchUser()
</script>

<template>
  <div class="flex min-h-screen flex-col bg-zinc-950">
    <AppHeader v-if="user" />
    <main class="flex flex-1 flex-col">
      <slot />
    </main>
  </div>
</template>
