<script setup lang="ts">
import { ref } from 'vue'

useSeoMeta({ title: 'Account erstellen' })

// Pre-fill from query param so the login page's "no passkey for this domain"
// recovery flow lands here without making the user retype their address.
const route = useRoute()
const email = ref((route.query.email as string) ?? '')
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
    error.value = e?.data?.detail || e?.data?.title || 'Ein Fehler ist aufgetreten'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <IdpHero>
    <!-- Registration form -->
    <div v-if="!sent" class="flex flex-col items-center text-center">
      <div class="mb-6 text-6xl">
        🦍
      </div>

      <h1 class="mb-4 text-4xl font-extrabold sm:text-5xl">
        Account erstellen
      </h1>

      <p class="mb-8 text-muted">
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

      <div class="mt-6 text-sm text-dimmed">
        Bereits registriert?
        <NuxtLink to="/login" class="text-primary hover:underline">
          Anmelden
        </NuxtLink>
      </div>
    </div>

    <!-- Email sent confirmation -->
    <UCard v-else>
      <div class="py-4 text-center">
        <UIcon name="i-lucide-mail-check" class="mb-3 text-4xl text-primary" />
        <h2 class="mb-2 text-lg font-semibold">
          Prüfe dein Postfach
        </h2>
        <p class="text-sm text-muted">
          Wir haben einen Registrierungslink an
          <strong class="text-default">{{ email }}</strong>
          gesendet. Der Link ist 24 Stunden gültig.
        </p>
        <div class="mt-4">
          <NuxtLink to="/login" class="text-sm text-primary hover:underline">
            Zurück zum Login
          </NuxtLink>
        </div>
      </div>
    </UCard>
  </IdpHero>
</template>
