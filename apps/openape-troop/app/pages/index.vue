<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, loading, fetchUser, login } = useOpenApeAuth()
await fetchUser()

if (user.value) {
  await navigateTo('/agents')
}

const email = ref('')
const error = ref('')
const submitting = ref(false)

async function handleLogin() {
  error.value = ''
  if (!email.value || !email.value.includes('@')) {
    error.value = 'Bitte eine gültige Email-Adresse eingeben.'
    return
  }
  submitting.value = true
  try {
    await login(email.value.trim())
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Login fehlgeschlagen.'
    submitting.value = false
  }
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
          🦍
        </div>

        <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          We feed<br>
          baby apes<br>
          <span class="text-primary-500">with inference.</span>
        </h1>

        <p class="mt-4 text-zinc-400 text-lg">
          Cron-scheduled, single-purpose, OpenApe-identity. Manage from anywhere.
        </p>

        <form class="mt-10 w-full space-y-3" @submit.prevent="handleLogin">
          <UInput
            v-model="email"
            type="email"
            placeholder="you@example.com"
            size="xl"
            autocomplete="email"
            icon="i-lucide-mail"
            :disabled="submitting || loading"
            class="w-full"
            :ui="{ base: 'w-full' }"
          />
          <p v-if="error" class="text-sm text-red-400 text-left">
            {{ error }}
          </p>
          <UButton
            type="submit"
            color="primary"
            block
            size="xl"
            icon="i-lucide-fingerprint"
            :loading="submitting || loading"
          >
            Sign in with OpenApe
          </UButton>
        </form>

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
