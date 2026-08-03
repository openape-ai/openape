<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

// Shared decision links land here logged out; asking for the email right where
// they arrived beats bouncing them to the start page and back.
const props = defineProps<{ hint?: string }>()
const { loading, login } = useOpenApeAuth()

const email = ref('')
const error = ref('')
const submitting = ref(false)

async function handleLogin() {
  error.value = ''
  if (!email.value.includes('@')) {
    error.value = 'Bitte eine gültige E-Mail-Adresse eingeben.'
    return
  }
  submitting.value = true
  try {
    await login(email.value.trim())
  }
  catch (e) {
    error.value = (e as { data?: { statusMessage?: string }, message?: string })?.data?.statusMessage
      ?? (e as { message?: string }).message
      ?? 'Login fehlgeschlagen.'
    submitting.value = false
  }
}
</script>

<template>
  <form class="w-full max-w-sm mx-auto space-y-3 py-12" @submit.prevent="handleLogin">
    <p class="text-zinc-400 text-center">
      {{ props.hint ?? 'Melde dich an, um diese Entscheidung zu sehen.' }}
    </p>
    <UInput
      v-model="email"
      type="email"
      placeholder="du@firma.at"
      size="lg"
      autocomplete="email"
      icon="i-lucide-mail"
      :disabled="submitting || loading"
      class="w-full"
      :ui="{ base: 'w-full' }"
    />
    <p v-if="error" class="text-sm text-red-400">
      {{ error }}
    </p>
    <UButton type="submit" color="primary" block size="lg" icon="i-lucide-fingerprint" :loading="submitting || loading">
      Anmelden
    </UButton>
  </form>
</template>
