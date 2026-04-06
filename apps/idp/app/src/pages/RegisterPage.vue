<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const token = route.query.token as string
const deviceName = ref('')
const publicKey = ref('')
const error = ref('')
const registered = ref(false)
const loading = ref(false)

if (!token) {
  error.value = 'No registration token provided'
}

async function handleRegister() {
  error.value = ''
  loading.value = true
  try {
    if (!publicKey.value) {
      error.value = 'Please provide an SSH public key'
      return
    }

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        token,
        publicKey: publicKey.value.trim(),
        name: deviceName.value || undefined,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || (err as Record<string, string>).statusMessage || 'Registration failed')
    }

    registered.value = true
    router.push('/')
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
        <p class="text-sm text-muted text-center mt-1">
          Register your SSH key to get started
        </p>
      </template>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
        class="mb-4"
      />

      <div v-if="(!error || token) && !registered" class="space-y-4">
        <UFormField label="Device Name (optional)">
          <UInput
            v-model="deviceName"
            placeholder="e.g. MacBook, iPhone"
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
