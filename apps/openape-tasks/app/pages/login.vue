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
    await navigateTo('/teams')
  }
})

async function onSubmit() {
  if (!email.value.trim() || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    await login(email.value.trim())
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
  <div class="min-h-dvh flex items-center justify-center p-4 bg-zinc-950 text-zinc-100">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold">
          OpenApe Tasks
        </h1>
        <p class="text-sm text-zinc-400 mt-1">
          Shared task lists for humans and agents.
        </p>
      </template>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <UFormField label="Email" required>
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UAlert v-if="error" color="error" :title="error" @close="error = ''" />

        <UButton
          type="submit"
          color="primary"
          block
          size="lg"
          :loading="submitting"
          :disabled="!email.trim() || submitting"
        >
          Continue
        </UButton>
      </form>

      <template #footer>
        <p class="text-xs text-zinc-500">
          Login via DDISA: we look up your email domain and forward you to your identity provider.
        </p>
      </template>
    </UCard>
  </div>
</template>
