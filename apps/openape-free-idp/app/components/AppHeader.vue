<script setup lang="ts">
// Identity bar for signed-in pages. Signed-out pages (login, register,
// recover) are full-bleed heroes with their own logo, so the layout hides
// this rather than stacking two logos.
const { user, logout } = useIdpAuth()

async function handleLogout() {
  await logout()
  await navigateTo('/login')
}
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-default bg-zinc-950/85 backdrop-blur">
    <div class="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4 sm:px-6">
      <NuxtLink
        to="/"
        class="flex items-center gap-2 rounded-md font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
      >
        <span class="text-xl">🦍</span>
        <span class="hidden sm:inline">OpenApe ID</span>
      </NuxtLink>

      <span class="ml-auto hidden truncate text-sm text-muted sm:block">{{ user?.email }}</span>

      <UButton to="/account" color="neutral" variant="ghost" size="sm" class="ml-auto sm:ml-0">
        Account
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-log-out"
        aria-label="Sign out"
        @click="handleLogout"
      />
    </div>
  </header>
</template>
