<script setup lang="ts">
import { ref } from 'vue'
import { navigateTo, useRoute } from '#imports'
import { useIdpAuth } from '../composables/useIdpAuth'
import { useWebAuthn } from '../composables/useWebAuthn'

const { fetchUser } = useIdpAuth()
const { registerWithToken, error: webauthnError, loading: webauthnLoading } = useWebAuthn()
const route = useRoute()

const token = route.query.token as string
const deviceName = ref('')
const error = ref('')
const registered = ref(false)

if (!token) {
  error.value = 'No registration token provided'
}

async function handleRegister() {
  error.value = ''
  try {
    await registerWithToken(token, deviceName.value || undefined)
    registered.value = true
    await fetchUser()
    await navigateTo('/')
  }
  catch {
    error.value = webauthnError.value
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold text-center">
          Welcome
        </h1>
        <p class="text-sm text-muted text-center mt-1">
          Register your passkey to get started
        </p>
      </template>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
        class="mb-4"
      />

      <div v-if="!error || token" class="space-y-4">
        <UFormField label="Device Name (optional)">
          <UInput
            v-model="deviceName"
            placeholder="e.g. MacBook, iPhone"
          />
        </UFormField>

        <UButton
          color="primary"
          block
          :loading="webauthnLoading"
          :disabled="webauthnLoading || !token"
          :label="webauthnLoading ? 'Registering...' : 'Register Passkey'"
          @click="handleRegister"
        />
      </div>

      <template #footer>
        <div class="text-center">
          <UButton
            to="/login"
            variant="link"
            label="Already registered? Login"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
