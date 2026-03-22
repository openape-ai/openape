<script setup lang="ts">
useSeoMeta({ title: 'Free Identity Provider' })

const { user, loading, fetchUser, logout } = useIdpAuth()

await fetchUser()

async function handleLogout() {
  await logout()
  navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <!-- Logged in -->
    <UCard v-if="user" class="w-full max-w-md bg-gray-900 border border-gray-800">
      <div class="flex flex-col items-center gap-4 py-4">
        <AppLogo />
        <div class="text-center">
          <p class="text-sm text-gray-400">
            Angemeldet als
          </p>
          <p class="text-white font-medium mt-1">
            {{ user.email }}
          </p>
        </div>
        <div class="w-full space-y-2">
          <UButton
            to="/account"
            color="primary"
            variant="outline"
            size="lg"
            block
            icon="i-lucide-key-round"
          >
            Passkeys verwalten
          </UButton>
          <UButton
            to="/agents"
            color="primary"
            variant="outline"
            size="lg"
            block
            icon="i-lucide-bot"
          >
            Agents verwalten
          </UButton>
          <UButton
            to="/grants"
            color="primary"
            variant="outline"
            size="lg"
            block
            icon="i-lucide-shield-check"
          >
            Berechtigungen
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            block
            icon="i-lucide-log-out"
            :loading="loading"
            @click="handleLogout"
          >
            Abmelden
          </UButton>
        </div>
      </div>
    </UCard>

    <!-- Not logged in -->
    <div v-else class="w-full max-w-md flex flex-col items-center text-center">
      <div class="text-6xl mb-6">
        🦍
      </div>

      <h1 class="text-4xl sm:text-5xl font-extrabold text-white mb-4">
        One login.<br>
        <span class="text-primary sm:whitespace-nowrap">Every human.<br class="sm:hidden"> Every agent.</span>
      </h1>

      <p class="text-lg text-gray-400 mb-8">
        Free identity provider for the open web. Secured by passkeys.
      </p>

      <div class="w-full space-y-3">
        <UButton
          to="/login"
          color="primary"
          size="xl"
          block
          icon="i-lucide-fingerprint"
        >
          Sign in with Passkey
        </UButton>

        <UButton
          to="/register-email"
          color="neutral"
          variant="outline"
          size="xl"
          block
          icon="i-lucide-user-plus"
        >
          Create account
        </UButton>
      </div>

      <p class="mt-8 text-sm text-gray-500">
        Powered by <NuxtLink to="https://openape.at" external class="text-gray-400 hover:text-white transition-colors">
          OpenApe
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
