<script setup lang="ts">
import { useOpenApeAuth } from '#imports'
import { onMounted, ref } from 'vue'

definePageMeta({ layout: false })

const { user, fetchUser, login } = useOpenApeAuth()
const email = ref('')
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  await fetchUser()
  if (user.value) {
    // invite.vue merkt sich das Ziel vor dem Login; der OIDC-Callback landet hier.
    const stored = window.sessionStorage.getItem('openape-crm:returnTo')
    window.sessionStorage.removeItem('openape-crm:returnTo')
    await navigateTo(stored?.startsWith('/') ? stored : '/vorgaenge', { replace: true })
  }
})

async function onSubmit() {
  const value = email.value.trim()
  if (!value || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    await login(value)
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string }, message?: string }
    error.value = e.data?.detail ?? e.data?.title ?? e.message ?? 'Login fehlgeschlagen'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh flex items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100">
    <div class="w-full max-w-md text-center">
      <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
        Deals im Blick,<br>
        <span class="text-primary-400">Stufe für Stufe.</span>
      </h1>
      <p class="mt-4 text-lg text-zinc-400">
        Pipeline, Kontakte und Notizen — für Menschen und Agenten.
      </p>

      <form class="mt-10 space-y-3" @submit.prevent="onSubmit">
        <UInput
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="du@example.com"
          size="xl"
          class="w-full"
          :ui="{ base: 'text-center' }"
        />
        <UAlert v-if="error" color="error" :title="error" @close="error = ''" />
        <UButton
          type="submit"
          color="primary"
          block
          size="xl"
          :loading="submitting"
          :disabled="!email.trim() || submitting"
        >
          Anmelden
        </UButton>
      </form>

      <p class="mt-6 text-xs text-zinc-500">
        Login über DDISA: wir schlagen deine Mail-Domain nach und leiten dich an deinen Identity Provider weiter.
      </p>
    </div>
  </div>
</template>
