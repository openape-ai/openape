<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

// Shared decision links land here logged out; asking for the email right where
// they arrived beats bouncing them to the start page and back.
const props = defineProps<{ hint?: string }>()
const { t } = useI18n()
const { loading, login } = useOpenApeAuth()

const email = ref('')
const error = ref('')
const submitting = ref(false)

async function handleLogin() {
  error.value = ''
  if (!email.value.includes('@')) {
    error.value = t('header.login.invalidEmail')
    return
  }
  submitting.value = true
  try {
    await login(email.value.trim())
  }
  catch (e) {
    error.value = (e as { data?: { statusMessage?: string }, message?: string })?.data?.statusMessage
      ?? (e as { message?: string }).message
      ?? t('header.login.failed')
    submitting.value = false
  }
}
</script>

<template>
  <form class="w-full max-w-sm mx-auto space-y-3 py-12" @submit.prevent="handleLogin">
    <p class="text-zinc-400 text-center">
      {{ props.hint ?? $t('common.loginHint', { what: $t('header.login.what') }) }}
    </p>
    <UInput
      v-model="email"
      type="email"
      :placeholder="$t('header.login.emailPlaceholder')"
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
      {{ $t('header.login.submit') }}
    </UButton>
  </form>
</template>
