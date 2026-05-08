<script setup lang="ts">
import { useOpenApeAuth } from '#imports'

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

if (user.value) {
  await navigateTo('/agents')
}
</script>

<template>
  <div class="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100">
    <main class="flex-1 flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md flex flex-col items-center text-center">
        <OpenApeOAuthErrorAlert
          class="text-left mb-6 w-full"
          :messages="{
            access_denied: 'Login wurde vom Identity Provider abgelehnt. Wahrscheinlich hat dein Domain-Admin Troop noch nicht freigegeben — frag deinen Admin oder verwende eine andere Email-Adresse.',
          }"
        />

        <div class="text-6xl mb-6" aria-hidden="true">
          🦒
        </div>

        <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          Your troop of<br>
          <span class="text-primary-500">small agents.</span>
        </h1>

        <p class="mt-4 text-zinc-400 text-lg">
          Cron-scheduled, single-purpose, OpenApe-identity. Manage from anywhere.
        </p>

        <UButton
          to="/login"
          color="primary"
          size="xl"
          class="mt-10"
          icon="i-lucide-fingerprint"
        >
          Sign in with OpenApe
        </UButton>

        <p class="mt-10 italic text-sm text-zinc-500">
          "Hatched by you. Loyal to you. Lives on your computer."
        </p>
      </div>
    </main>

    <footer class="py-6 text-center text-xs text-zinc-600">
      Powered by
      <a
        href="https://openape.ai"
        target="_blank"
        rel="noopener"
        class="text-zinc-400 hover:text-primary-500 transition-colors"
      >OpenApe</a>
    </footer>
  </div>
</template>
