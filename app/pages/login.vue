<script setup lang="ts">
import { ref } from 'vue'

useSeoMeta({ title: 'Login' })

const route = useRoute()
const loginHint = (route.query.login_hint as string) || ''

const email = ref(loginHint)
const { login, error: webauthnError, loading } = useWebAuthn()

const { fetchUser } = useIdpAuth()

async function handleLogin() {
  const success = await login(email.value || undefined)
  if (success) {
    await fetchUser()
    const returnTo = route.query.returnTo as string
    if (returnTo) {
      await navigateTo(returnTo, { external: true })
    }
    else {
      await navigateTo('/')
    }
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-gray-950">
    <div class="w-full max-w-md flex flex-col items-center text-center">
      <div class="text-6xl mb-6">
        🦍
      </div>

      <h1 class="text-4xl sm:text-5xl font-extrabold text-white mb-4">
        One login.<br>
        <span class="text-primary sm:whitespace-nowrap">Every human.<br class="sm:hidden"> Every agent.</span>
      </h1>

      <p class="text-lg text-gray-400 mb-8">
        Passwordless authentication for the open web.
      </p>

      <form class="w-full space-y-4" @submit.prevent="handleLogin">
        <UInput
          v-model="email"
          type="email"
          placeholder="you@example.com (optional)"
          icon="i-lucide-mail"
          size="xl"
          class="w-full"
        />

        <UButton
          type="submit"
          color="primary"
          size="xl"
          block
          :loading="loading"
          icon="i-lucide-fingerprint"
        >
          Sign in with Passkey
        </UButton>
      </form>

      <p v-if="webauthnError" class="mt-3 text-sm text-red-400 text-center">
        {{ webauthnError }}
      </p>

      <div class="mt-6 text-sm text-gray-500">
        Noch keinen Account?
        <NuxtLink to="/register-email" class="text-primary hover:underline">
          Jetzt registrieren
        </NuxtLink>
      </div>

      <p class="mt-8 text-sm text-gray-500">
        Powered by <NuxtLink to="https://openape.at" external class="text-gray-400 hover:text-white transition-colors">
          OpenApe
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
