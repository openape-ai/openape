<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useIdpAuth, navigateTo } from '#imports'

const { user, loading, fetchUser, logout } = useIdpAuth()

const bootstrapping = ref(false)
const bootstrapUrl = ref('')
const bootstrapError = ref('')
const hasUsers = ref<boolean | null>(null)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    // Check if bootstrap is needed
    try {
      const result = await $fetch('/api/bootstrap', { method: 'POST' })
      bootstrapUrl.value = result.registrationUrl
      hasUsers.value = false
    }
    catch {
      hasUsers.value = true
    }
  }
})

async function handleBootstrap() {
  bootstrapError.value = ''
  bootstrapping.value = true
  try {
    const result = await $fetch('/api/bootstrap', { method: 'POST' })
    bootstrapUrl.value = result.registrationUrl
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    bootstrapError.value = e.data?.statusMessage ?? e.message ?? 'Bootstrap failed'
  }
  finally {
    bootstrapping.value = false
  }
}

async function handleLogout() {
  await logout()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center p-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold text-center">
          Playground IdP
        </h1>
        <p class="text-center text-sm text-muted mt-2">
          OpenApe Identity Provider Playground
        </p>
      </template>

      <!-- Loading -->
      <div v-if="loading" class="text-center text-muted">
        Loading...
      </div>

      <!-- Logged in -->
      <div v-else-if="user" class="space-y-4">
        <UAlert color="success" title="Logged in as">
          <template #description>
            <p class="font-semibold">
              {{ user.name }}
            </p>
            <p class="text-sm">
              {{ user.email }}
            </p>
          </template>
        </UAlert>

        <div class="text-sm text-muted space-y-2">
          <p>Endpoints:</p>
          <ul class="list-disc list-inside space-y-1 text-xs font-mono">
            <li>GET /authorize</li>
            <li>POST /token</li>
            <li>GET /.well-known/jwks.json</li>
            <li>POST /api/grants</li>
          </ul>
        </div>

        <UButton to="/account" color="primary" block label="Account" />
        <UButton to="/grants" color="primary" variant="soft" block label="Manage Grants" />

        <UButton
          v-if="user.isAdmin"
          to="/admin"
          color="secondary"
          block
          label="Admin Dashboard"
        />

        <UButton
          color="error"
          block
          label="Logout"
          @click="handleLogout"
        />
      </div>

      <!-- Not logged in -->
      <div v-else class="space-y-4">
        <!-- Bootstrap: registration URL ready -->
        <template v-if="bootstrapUrl">
          <UAlert color="success" title="Registration URL created">
            <template #description>
              <p class="text-sm mb-2">
                Click below to register the first admin user:
              </p>
              <a :href="bootstrapUrl" class="text-white underline break-all text-sm">
                {{ bootstrapUrl }}
              </a>
            </template>
          </UAlert>
        </template>

        <!-- Bootstrap: no users yet, auto-bootstrap failed or not tried -->
        <template v-else-if="hasUsers === false">
          <UAlert color="warning" title="No users found">
            <template #description>
              Create the first admin user to get started.
            </template>
          </UAlert>
          <UButton
            color="primary"
            block
            :loading="bootstrapping"
            :disabled="bootstrapping"
            label="Bootstrap Admin User"
            @click="handleBootstrap"
          />
        </template>

        <!-- Has users: show login -->
        <template v-else-if="hasUsers">
          <p class="text-muted text-center text-sm">
            Sign in with your passkey.
          </p>
          <UButton to="/login" color="primary" block label="Login" />
        </template>

        <!-- Checking... -->
        <template v-else>
          <div class="text-center text-muted">
            Checking...
          </div>
        </template>

        <UAlert v-if="bootstrapError" color="error" :title="bootstrapError" />
      </div>
    </UCard>
  </div>
</template>
