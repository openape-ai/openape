<script setup lang="ts">
import { useFetch } from '#imports'

const { data: user } = await useFetch<{ email: string } | null>('/api/me')
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-gray-950">
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
        <form method="POST" action="/api/logout" class="w-full">
          <UButton
            type="submit"
            color="neutral"
            variant="outline"
            size="lg"
            block
            icon="i-lucide-log-out"
          >
            Abmelden
          </UButton>
        </form>
      </div>
    </UCard>

    <!-- Not logged in -->
    <div v-else class="text-center">
      <AppLogo class="justify-center mb-6 text-2xl" />
      <h1 class="text-2xl font-bold text-white mb-3">
        Free Identity Provider
      </h1>
      <p class="text-gray-400 max-w-md">
        Universeller DDISA Identity Provider für Domains ohne eigenen IdP-Record.
        Authentifizierung via Magic Link.
      </p>
    </div>
  </div>
</template>
