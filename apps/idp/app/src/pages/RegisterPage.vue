<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const token = route.query.token as string
const error = ref(!token ? 'No registration token provided' : '')
const success = ref(false)
const loading = ref(false)

// Registration with SSH key (no WebAuthn in this IdP)
const publicKey = ref('')
const deviceName = ref('')

async function handleRegister() {
  error.value = ''
  loading.value = true
  try {
    // First, validate the token
    const validateRes = await fetch(`/api/admin/registration-urls`, {
      credentials: 'include',
    })
    // The registration URL token is validated server-side during enrollment
    // For now, provide a form to submit an SSH key

    if (!publicKey.value) {
      error.value = 'Please provide an SSH public key'
      return
    }

    // We don't need to call the registration URL validation endpoint;
    // the token just identifies who is being registered.
    // For the standalone IdP, registration means adding the SSH key.
    const tokenRes = await fetch(`/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        publicKey: publicKey.value.trim(),
        name: deviceName.value || undefined,
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || (err as Record<string, string>).statusMessage || 'Registration failed')
    }

    success.value = true
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Registration failed'
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
          Welcome
        </h1>
        <p class="text-sm text-(--ui-text-muted) text-center mt-1">
          Register your SSH key to get started
        </p>
      </template>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
        class="mb-4"
      />

      <UAlert
        v-if="success"
        color="success"
        title="Registration successful!"
        description="You can now sign in."
        class="mb-4"
      />

      <div v-if="!success && token" class="space-y-4">
        <UFormField label="Device Name (optional)">
          <UInput
            v-model="deviceName"
            placeholder="e.g. MacBook, Work Laptop"
          />
        </UFormField>

        <UFormField label="SSH Public Key (ssh-ed25519)">
          <UTextarea
            v-model="publicKey"
            placeholder="ssh-ed25519 AAAA..."
            :rows="3"
            class="font-mono text-xs"
          />
        </UFormField>

        <UButton
          color="primary"
          block
          :loading="loading"
          :disabled="loading || !token || !publicKey"
          :label="loading ? 'Registering...' : 'Register'"
          @click="handleRegister"
        />
      </div>

      <template #footer>
        <div class="text-center">
          <UButton
            variant="link"
            label="Already registered? Login"
            @click.prevent="router.push('/login')"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
