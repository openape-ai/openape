<script setup lang="ts">
import { useFetch } from '#imports'

useSeoMeta({ title: 'Free Identity Provider' })

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
    <div v-else class="w-full max-w-md flex flex-col items-center text-center">
      <div class="text-6xl mb-6">
        🦍
      </div>

      <h1 class="text-4xl sm:text-5xl font-extrabold text-white mb-4">
        One login.<br>
        <span class="text-primary sm:whitespace-nowrap">Every human.<br class="sm:hidden"> Every agent.</span>
      </h1>

      <p class="text-lg text-gray-400 mb-8">
        Free identity provider for the open web. No password needed.
      </p>

      <UButton
        to="/login"
        color="primary"
        size="xl"
        block
        icon="i-lucide-log-in"
      >
        Sign in
      </UButton>

      <p class="mt-8 text-sm text-gray-500">
        Powered by <NuxtLink to="https://openape.at" external class="text-gray-400 hover:text-white transition-colors">
          OpenApe
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
