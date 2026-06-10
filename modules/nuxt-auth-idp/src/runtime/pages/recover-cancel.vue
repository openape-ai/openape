<script setup>
import { ref } from 'vue'
import { useRoute } from '#imports'

// One-tap recovery cancel (#462). User arrives here from the cancel
// link in a warning mail or push notification. No session, no further
// steps: the tokenized POST kills the recovery attempt immediately.
// Cancelling is idempotent — a second tap still shows success.

const route = useRoute()
const token = route.query.token
const error = ref('')
const done = ref(false)

async function cancelRecovery() {
  if (!token) {
    error.value = 'No cancel token provided'
    return
  }
  try {
    await $fetch('/api/recovery/cancel', { method: 'POST', body: { token } })
    done.value = true
  }
  catch {
    error.value = 'Cancelling failed. Please try again or sign in from one of your devices — that cancels the recovery too.'
  }
}

await cancelRecovery()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold text-center">
          Wiederherstellung abbrechen
        </h1>
      </template>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
      />

      <UAlert
        v-else-if="done"
        color="success"
        title="Wiederherstellung abgebrochen"
        description="Der Wiederherstellungs-Versuch ist dauerhaft abgebrochen und kann nicht mehr abgeschlossen werden."
      />
    </UCard>
  </div>
</template>
