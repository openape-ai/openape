<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser, login } = useOpenApeAuth()
const email = ref('')
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  await fetchUser()
  if (user.value) {
    await navigateTo('/prs')
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
            access_denied: 'Die Anmeldung wurde vom Identity Provider abgelehnt. Wahrscheinlich hat dein Domain-Admin PR Review noch nicht freigegeben — frag deinen Admin oder versuche eine andere Email-Adresse.',
          }"
        />

        <div class="text-6xl mb-6" aria-hidden="true">
          🔍
        </div>

        <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          See the diff.<br>
          <span class="text-primary-500">Decide.</span>
        </h1>

        <p class="mt-4 text-zinc-400 text-lg">
          Upload a pull request — diff, description, images — and review it on a beautiful surface.
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
          Agents upload with <code class="text-zinc-400">ape-pr upload ./out</code> — one command, one review link.
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
