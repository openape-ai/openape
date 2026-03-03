<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useState } from '#imports'

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
    <UCard class="w-full max-w-md bg-gray-900 border border-gray-800">
      <template #header>
        <div class="flex flex-col items-center gap-3 pt-2">
          <AppLogo />
          <h1 class="text-lg font-semibold text-white">
            Anmelden
          </h1>
        </div>
      </template>

      <div v-if="!sent">
        <p class="text-sm text-gray-400 mb-4 text-center">
          Wir senden dir einen Login-Link per Email.
        </p>

        <form class="space-y-4" @submit.prevent="sendMagicLink">
          <UFormField label="Email">
            <UInput
              v-model="email"
              type="email"
              placeholder="du@example.com"
              required
              :readonly="!!loginHint"
              icon="i-lucide-mail"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UButton
            type="submit"
            color="primary"
            size="lg"
            block
            :loading="loading"
            icon="i-lucide-send"
          >
            Verifizierungslink senden
          </UButton>
        </form>

        <p v-if="error" class="mt-3 text-sm text-red-400 text-center">
          {{ error }}
        </p>
      </div>

      <div v-else class="text-center py-4">
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
