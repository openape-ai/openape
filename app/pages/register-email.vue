<script setup lang="ts">
import { ref } from 'vue'

useSeoMeta({ title: 'Account erstellen' })

const email = ref('')
const loading = ref(false)
const sent = ref(false)
const error = ref('')

async function requestRegistration() {
  error.value = ''
  loading.value = true

  try {
    await $fetch('/api/register', {
      method: 'POST',
      body: { email: email.value },
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
    <!-- Registration form -->
    <div v-if="!sent" class="w-full max-w-md flex flex-col items-center text-center">
      <div class="text-6xl mb-6">
        🦍
      </div>

      <h1 class="text-3xl font-extrabold text-white mb-4">
        Account erstellen
      </h1>

      <p class="text-gray-400 mb-8">
        Gib deine Email-Adresse ein. Du erhältst einen Link zum Erstellen deines Passkeys.
      </p>

      <form class="w-full space-y-4" @submit.prevent="requestRegistration">
        <UInput
          v-model="email"
          type="email"
          placeholder="you@example.com"
          required
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
          Registrierungslink senden
        </UButton>
      </form>

      <p v-if="error" class="mt-3 text-sm text-red-400 text-center">
        {{ error }}
      </p>

      <div class="mt-6 text-sm text-gray-500">
        Bereits registriert?
        <NuxtLink to="/login" class="text-primary hover:underline">
          Anmelden
        </NuxtLink>
      </div>
    </div>

    <!-- Email sent confirmation -->
    <UCard v-else class="w-full max-w-md bg-gray-900 border border-gray-800">
      <div class="text-center py-4">
        <UIcon name="i-lucide-mail-check" class="text-4xl text-primary mb-3" />
        <h2 class="text-lg font-semibold text-white mb-2">
          Prüfe dein Postfach
        </h2>
        <p class="text-sm text-gray-400">
          Wir haben einen Registrierungslink an
          <strong class="text-white">{{ email }}</strong>
          gesendet. Der Link ist 24 Stunden gültig.
        </p>
        <div class="mt-4">
          <NuxtLink to="/login" class="text-sm text-primary hover:underline">
            Zurück zum Login
          </NuxtLink>
        </div>
      </div>
    </UCard>
  </div>
</template>
