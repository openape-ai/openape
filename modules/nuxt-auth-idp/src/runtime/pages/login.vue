<script setup>
import { onMounted, ref } from 'vue'
import { navigateTo, useRoute } from '#imports'
import { useIdpAuth } from '../composables/useIdpAuth'
import { useWebAuthn } from '../composables/useWebAuthn'

const { fetchUser } = useIdpAuth()
const { login, error: webauthnError, loading: webauthnLoading } = useWebAuthn()
const route = useRoute()
const email = ref(route.query.login_hint ?? '')
const error = ref(route.query.error ?? '')
const federationProviders = ref([])
onMounted(async () => {
  try {
    const providers = await $fetch('/api/federation/providers')
    federationProviders.value = providers
  } catch {
  }
})
async function handleLogin() {
  error.value = ''
  try {
    await login(email.value || void 0)
    await fetchUser()
    const returnTo = route.query.returnTo
    if (returnTo) {
      await navigateTo(returnTo, { external: true })
    } else {
      await navigateTo('/')
    }
  } catch {
    error.value = webauthnError.value
  }
}
function federationLogin(providerId) {
  const returnTo = route.query.returnTo
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
          :loading="webauthnLoading"
          :disabled="webauthnLoading"
          :label="webauthnLoading ? 'Authenticating...' : 'Sign in with Passkey'"
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

      <template #footer>
        <div class="text-center">
          <UButton
            to="/"
            variant="link"
            label="Back to Home"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
