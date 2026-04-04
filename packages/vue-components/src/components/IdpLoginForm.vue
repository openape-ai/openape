<script setup lang="ts">
import { ref } from 'vue'
import { useIdpAuth } from '../composables/useIdpAuth'

const props = defineProps<{
  returnTo?: string
  loginHint?: string
}>()

const emit = defineEmits<{
  success: []
}>()

const { fetchUser } = useIdpAuth()
const email = ref(props.loginHint ?? '')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    // Step 1: Get a challenge
    const challengeRes = await fetch('/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: email.value || undefined }),
      credentials: 'include',
    })
    if (!challengeRes.ok) {
      const err = await challengeRes.json().catch(() => ({}))
      throw new Error(err.title || 'Failed to get challenge')
    }
    const { challenge } = await challengeRes.json()

    // Step 2: Sign the challenge using the SubtleCrypto API
    // This requires a key to be available - for now we use session login
    // which is the browser-based flow
    const loginRes = await fetch('/api/session/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: email.value,
        challenge,
        // The actual signing would be done by the agent/CLI,
        // for browser flow we rely on session cookies
      }),
      credentials: 'include',
    })

    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => ({}))
      throw new Error(err.title || 'Login failed')
    }

    await fetchUser()
    emit('success')

    if (props.returnTo) {
      window.location.href = props.returnTo
    }
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Login failed'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="handleLogin">
    <div
      v-if="error"
      class="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400"
    >
      {{ error }}
    </div>

    <div>
      <label for="idp-email" class="block text-sm font-medium mb-1">Email</label>
      <input
        id="idp-email"
        v-model="email"
        type="email"
        placeholder="user@example.com"
        class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
    </div>

    <button
      type="submit"
      :disabled="loading || !email"
      class="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {{ loading ? 'Signing in...' : 'Sign in with Key' }}
    </button>
  </form>
</template>
