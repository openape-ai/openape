<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser, login } = useOpenApeAuth()
const email = ref('')
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  await fetchUser()
  if (user.value)
    await navigateTo('/dashboard')
})

async function onSubmit() {
  const value = email.value.trim()
  if (!value || submitting.value)
    return
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
        <div class="text-6xl mb-6" aria-hidden="true">
          📊
        </div>

        <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          Your numbers.<br>
          <span class="text-primary-500">Pushed by your agents.</span>
        </h1>

        <p class="mt-4 text-zinc-400 text-lg">
          Agents push KPIs with <code class="text-zinc-300">ape-kpi push</code> —
          this dashboard and your morning mail are pure consumers.
        </p>

        <form class="mt-8 w-full flex flex-col gap-3" @submit.prevent="onSubmit">
          <UInput
            v-model="email"
            type="email"
            size="xl"
            placeholder="you@example.com"
            autocomplete="email"
            :disabled="submitting"
          />
          <UButton
            type="submit"
            size="xl"
            block
            :loading="submitting"
          >
            Sign in with your identity
          </UButton>
        </form>

        <p v-if="error" class="mt-3 text-sm text-red-400">
          {{ error }}
        </p>

        <p class="mt-6 text-sm text-zinc-500">
          DDISA sign-in via your own identity provider — no account here.
        </p>
      </div>
    </main>
  </div>
</template>
