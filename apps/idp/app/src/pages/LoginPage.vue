<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIdpAuth, useKeyLogin } from '@openape/vue-components'

const route = useRoute()
const router = useRouter()
const { fetchUser } = useIdpAuth()
const { loginWithKey, loading: keyLoading, error: keyError } = useKeyLogin()

const email = ref((route.query.login_hint as string) ?? '')
const error = ref((route.query.error as string) ?? '')
const loading = ref(false)
const federationProviders = ref<Array<{ id: string, name: string }>>([])
const showKeyMode = ref(false)
const privateKey = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/federation/providers', { credentials: 'include' })
    if (res.ok) {
      federationProviders.value = await res.json()
    }
  }
  catch {
  }
})

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    const challengeRes = await fetch('/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: email.value || undefined }),
      credentials: 'include',
    })
    if (!challengeRes.ok) {
      const err = await challengeRes.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || 'Failed to get challenge')
    }

    const { challenge } = await challengeRes.json()
    const loginRes = await fetch('/api/session/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: email.value, challenge }),
      credentials: 'include',
    })
    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || 'Login failed')
    }

    await fetchUser()
    const returnTo = route.query.returnTo as string
    if (returnTo) {
      window.location.href = returnTo
    }
    else {
      router.push('/')
    }
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Login failed'
  }
  finally {
    loading.value = false
  }
}

async function handleKeyLogin() {
  error.value = ''
  if (!email.value) {
    error.value = 'Email is required for key login'
    return
  }
  const success = await loginWithKey(email.value, privateKey.value)
  if (success) {
    await fetchUser()
    const returnTo = route.query.returnTo as string
    if (returnTo) {
      window.location.href = returnTo
    }
    else {
      router.push('/')
    }
  }
  else {
    error.value = keyError.value
  }
}

function handleFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    privateKey.value = reader.result as string
  }
  reader.readAsText(file)
}

function federationLogin(providerId: string) {
  const returnTo = route.query.returnTo as string
  let url = `/auth/federated/${providerId}`
  if (returnTo) {
    url += `?returnTo=${encodeURIComponent(returnTo)}`
  }
  window.location.href = url
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold text-center">
          Login
        </h1>
      </template>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
        class="mb-4"
      />

      <div class="space-y-4">
        <UFormField label="Email (optional)">
          <UInput
            id="email"
            v-model="email"
            type="email"
            placeholder="user@example.com"
          />
        </UFormField>

        <UButton
          color="primary"
          block
          :loading="loading"
          :disabled="loading"
          :label="loading ? 'Authenticating...' : 'Sign in with Passkey'"
          @click="handleLogin"
        />
      </div>

      <div
        v-if="federationProviders.length > 0"
        class="mt-4"
      >
        <div class="relative my-4">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t" />
          </div>
          <div class="relative flex justify-center text-sm">
            <span class="bg-(--ui-bg) px-2 text-(--ui-text-muted)">or</span>
          </div>
        </div>

        <div class="space-y-2">
          <UButton
            v-for="provider in federationProviders"
            :key="provider.id"
            block
            variant="outline"
            :label="`Sign in with ${provider.name}`"
            @click="federationLogin(provider.id)"
          />
        </div>
      </div>

      <!-- Private key login (SPA-only feature) -->
      <div class="mt-6">
        <button
          class="text-xs text-(--ui-text-muted) hover:underline cursor-pointer"
          @click="showKeyMode = !showKeyMode"
        >
          {{ showKeyMode ? 'Hide key login' : 'Sign in with private key instead' }}
        </button>

        <div v-if="showKeyMode" class="mt-3 space-y-3">
          <UFormField label="Private Key (PEM)">
            <UTextarea
              v-model="privateKey"
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
              :rows="6"
              class="font-mono text-xs"
            />
          </UFormField>

          <input
            type="file"
            accept=".pem,.key,*"
            class="text-xs text-(--ui-text-muted)"
            @change="handleFileSelect"
          >

          <UButton
            color="primary"
            variant="outline"
            block
            :loading="keyLoading"
            :disabled="keyLoading || !email || !privateKey"
            label="Sign in with Key"
            @click="handleKeyLogin"
          />
        </div>
      </div>

      <template #footer>
        <div class="text-center">
          <UButton
            variant="link"
            label="Back to Home"
            @click.prevent="router.push('/')"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
