<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useKeyLogin } from '@openape/vue-components'

const route = useRoute()
const router = useRouter()
const { loginWithKey, loading: keyLoading, error: keyError } = useKeyLogin()

const loginHint = (route.query.login_hint as string) || ''
const returnTo = (route.query.returnTo as string) || ''
const email = ref(loginHint)
const error = ref('')
const keyMode = ref(false)
const privateKeyPem = ref('')

async function handlePasskeyLogin() {
  error.value = 'Passkey login coming soon. Use "Sign in with private key" below.'
}

async function handleKeyLogin() {
  error.value = ''
  const ok = await loginWithKey(email.value, privateKeyPem.value)
  if (ok) {
    if (returnTo) {
      window.location.href = returnTo
    }
    else {
      router.push('/')
    }
  }
  else {
    error.value = keyError.value
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

      <p v-if="error || keyError" class="mt-3 text-sm text-red-400 text-center">
        {{ error || keyError }}
      </p>

      <button
        class="mt-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
        @click="keyMode = !keyMode"
      >
        {{ keyMode ? 'Sign in with Passkey instead' : 'Sign in with private key instead' }}
      </button>

      <div class="mt-6 text-sm text-gray-500">
        No account yet?
        <router-link to="/register" class="text-primary hover:underline">
          Register
        </router-link>
      </div>

      <p class="mt-8 text-sm text-gray-500">
        Powered by <a href="https://openape.at" class="text-gray-400 hover:text-white transition-colors">OpenApe</a>
      </p>
    </div>
  </div>
</template>
