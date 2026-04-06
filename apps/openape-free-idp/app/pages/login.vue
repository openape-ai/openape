<script setup lang="ts">
import { ref } from 'vue'
import { useKeyLogin } from '@openape/vue-components'

useSeoMeta({ title: 'Login' })

const route = useRoute()
const loginHint = (route.query.login_hint as string) || ''

const email = ref(loginHint)
const keyMode = ref(false)
const privateKeyPem = ref('')

const { login, error: webauthnError, loading } = useWebAuthn()
const { loginWithKey, loading: keyLoading, error: keyError } = useKeyLogin()
const { fetchUser } = useIdpAuth()

async function handlePasskeyLogin() {
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

async function handleKeyLogin() {
  const ok = await loginWithKey(email.value, privateKeyPem.value)
  if (ok) {
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

function handleFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = () => { privateKeyPem.value = reader.result as string }
    reader.readAsText(file)
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
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

      <!-- Passkey mode (default) -->
      <form v-if="!keyMode" class="w-full space-y-4" @submit.prevent="handlePasskeyLogin">
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

      <!-- Key mode (pro mode) -->
      <form v-else class="w-full space-y-4" @submit.prevent="handleKeyLogin">
        <UInput
          v-model="email"
          type="email"
          placeholder="you@example.com"
          icon="i-lucide-mail"
          size="xl"
          class="w-full"
        />

        <UTextarea
          v-model="privateKeyPem"
          placeholder="Paste your ed25519 private key..."
          :rows="4"
          class="w-full font-mono text-xs"
        />

        <input
          type="file"
          accept=".pem,.key,id_ed25519"
          class="text-sm text-gray-400"
          @change="handleFileSelect"
        >

        <UButton
          type="submit"
          color="primary"
          size="xl"
          block
          :loading="keyLoading"
          :disabled="!email || !privateKeyPem || keyLoading"
          icon="i-lucide-key-round"
        >
          Sign in with Key
        </UButton>
      </form>

      <p v-if="webauthnError || keyError" class="mt-3 text-sm text-red-400 text-center">
        {{ webauthnError || keyError }}
      </p>

      <button
        class="mt-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
        @click="keyMode = !keyMode"
      >
        {{ keyMode ? 'Sign in with Passkey instead' : 'Sign in with private key instead' }}
      </button>

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
