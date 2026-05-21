<script setup>
import { ref } from 'vue'
import { navigateTo, useRoute } from '#imports'
import { useWebAuthn } from '../composables/useWebAuthn'

// Account-recovery page (#297). User arrives here from the link in the
// "Wiederherstellung angefordert" mail. The recovery token enforces
// its own 72h-aged gate server-side; the UI only collects the new
// device name + the "invalidate other devices" toggle.

const { recoverWithToken, error: webauthnError, loading: webauthnLoading } = useWebAuthn()
const route = useRoute()
const token = route.query.token
const deviceName = ref('')
const invalidateOthers = ref(true)
const error = ref('')
const done = ref(false)
if (!token) {
  error.value = 'No recovery token provided'
}

async function handleRecover() {
  error.value = ''
  try {
    await recoverWithToken(token, {
      deviceName: deviceName.value || undefined,
      invalidateOthers: invalidateOthers.value,
    })
    done.value = true
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
          Konto wiederherstellen
        </h1>
        <p class="text-sm text-muted text-center mt-1">
          Hinterlege einen neuen Passkey für dein Konto.
        </p>
      </template>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
        class="mb-4"
      />

      <div v-if="done" class="space-y-4">
        <UAlert
          color="success"
          title="Passkey hinterlegt"
          description="Du kannst dich jetzt einloggen."
        />
        <UButton
          color="primary"
          block
          label="Zum Login"
          @click="navigateTo('/login')"
        />
      </div>

      <div v-else-if="!error || token" class="space-y-4">
        <UFormField label="Geräte-Name (optional)">
          <UInput
            v-model="deviceName"
            placeholder="z.B. MacBook, iPhone"
          />
        </UFormField>

        <UCheckbox
          v-model="invalidateOthers"
          label="Alle anderen Geräte abmelden (empfohlen)"
        />

        <UButton
          color="primary"
          block
          :loading="webauthnLoading"
          :disabled="webauthnLoading || !token"
          :label="webauthnLoading ? 'Hinterlege …' : 'Neuen Passkey hinterlegen'"
          @click="handleRecover"
        />
      </div>

      <template #footer>
        <div class="text-center">
          <UButton
            to="/login"
            variant="link"
            label="Abbrechen"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
