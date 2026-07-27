<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser, login } = useOpenApeAuth()
const email = ref('')
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  await fetchUser()
  if (user.value) await navigateTo('/monitors')
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
    error.value = e.data?.detail ?? e.data?.title ?? e.message ?? 'Login failed'
  }
  finally {
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
            access_denied: 'Die Anmeldung wurde vom Identity Provider abgelehnt. Wahrscheinlich hat dein Domain-Admin Monitor noch nicht freigegeben — frag deinen Admin oder versuche eine andere Email-Adresse.',
          }"
        />

        <div class="text-6xl mb-6" aria-hidden="true">
          📡
        </div>

        <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          Know before<br>
          <span class="text-primary-500">your users do.</span>
        </h1>

        <p class="mt-4 text-zinc-400 text-lg">
          Add the URLs that matter. We ping them around the clock and mail you the moment one stops answering.
        </p>

        <form class="w-full mt-10 space-y-3" @submit.prevent="onSubmit">
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            size="xl"
            class="w-full"
            :ui="{ base: 'text-center' }"
          />

          <UButton
            type="submit"
            color="primary"
            block
            size="xl"
            :loading="submitting"
            :disabled="!email.trim() || submitting"
          >
            Login with OpenApe
          </UButton>

          <UAlert
            v-if="error"
            color="error"
            :title="error"
            class="text-left"
            @close="error = ''"
          />
        </form>

        <p class="mt-10 text-sm text-zinc-500">
          Uptime monitoring for the OpenApe stack.
        </p>
      </div>
    </main>
  </div>
</template>
