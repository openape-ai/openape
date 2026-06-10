<script setup lang="ts">
import { ref } from 'vue'

// "Lost access?" entry point (#462, story recovery-broadcast). Requests an
// account recovery via POST /api/recovery/request. The response is
// enumeration-safe — the confirmation reads the same whether the address
// has an account or not.

useSeoMeta({ title: 'Recover account' })

const email = ref('')
const loading = ref(false)
const requested = ref(false)
const error = ref('')

async function handleRequest() {
  error.value = ''
  loading.value = true
  try {
    await $fetch('/api/recovery/request', { method: 'POST', body: { email: email.value } })
    requested.value = true
  }
  catch (err) {
    error.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? 'Could not request a recovery — please try again'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold text-center">
          Recover your account
        </h1>
        <p class="text-sm text-muted text-center mt-1">
          Lost every device with a passkey? Recovery lets you register a new
          one after a waiting period — it never signs anyone in by itself.
        </p>
      </template>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
        class="mb-4"
      />

      <div v-if="requested" class="space-y-4">
        <UAlert
          color="success"
          icon="i-lucide-mail-check"
          title="Recovery requested"
          description="If this address has an account, the waiting period starts now. A warning with a one-tap cancel link goes out immediately — to every device with notifications enabled and to every address ever linked to the account. The mail to the account address contains the link to register a new passkey once the wait is over."
        />
        <p class="text-xs text-muted text-center">
          For your safety this page answers the same way whether the address
          has an account or not.
        </p>
      </div>

      <div v-else class="space-y-4">
        <UFormField label="Account email">
          <UInput
            v-model="email"
            type="email"
            placeholder="you@example.com"
            class="w-full"
          />
        </UFormField>

        <UButton
          color="primary"
          block
          icon="i-lucide-life-buoy"
          :loading="loading"
          :disabled="!email.trim() || loading"
          @click="handleRequest"
        >
          Request recovery
        </UButton>
      </div>

      <template #footer>
        <div class="text-center">
          <UButton
            to="/login"
            variant="link"
            label="Back to sign in"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
