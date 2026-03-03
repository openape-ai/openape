<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useState } from '#imports'

useSeoMeta({ title: 'Login' })

const route = useRoute()
const loginHint = (route.query.login_hint as string) || ''

const email = ref(loginHint)
const loading = ref(false)
const sent = ref(false)
const error = ref('')

async function sendMagicLink() {
  error.value = ''
  loading.value = true

  try {
    // Fetch CSRF token from session (embedded in the page via server-side)
    const csrfToken = useState<string>('csrfToken').value

    await $fetch('/api/magic-link', {
      method: 'POST',
      body: { email: email.value, csrfToken },
    })
    sent.value = true
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Ein Fehler ist aufgetreten'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-gray-950">
    <!-- Login form -->
    <div v-if="!sent" class="w-full max-w-md flex flex-col items-center text-center">
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

      <form class="w-full space-y-4" @submit.prevent="sendMagicLink">
        <UInput
          v-model="email"
          type="email"
          placeholder="you@example.com"
          required
          :readonly="!!loginHint"
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
          icon="i-lucide-send"
        >
          Send magic link
        </UButton>
      </form>

      <p v-if="error" class="mt-3 text-sm text-red-400 text-center">
        {{ error }}
      </p>

      <p class="mt-8 text-sm text-gray-500">
        Powered by <NuxtLink to="https://openape.at" external class="text-gray-400 hover:text-white transition-colors">
          OpenApe
        </NuxtLink>
      </p>
    </div>

    <!-- Email sent confirmation -->
    <UCard v-else class="w-full max-w-md bg-gray-900 border border-gray-800">
      <div class="text-center py-4">
        <UIcon name="i-lucide-mail-check" class="text-4xl text-primary mb-3" />
        <h2 class="text-lg font-semibold text-white mb-2">
          Prüfe dein Postfach
        </h2>
        <p class="text-sm text-gray-400">
          Wir haben einen Login-Link an
          <strong class="text-white">{{ email }}</strong>
          gesendet. Der Link ist 10 Minuten gültig.
        </p>
      </div>
    </UCard>
  </div>
</template>
