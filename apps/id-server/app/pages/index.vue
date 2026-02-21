<script setup lang="ts">
const { user, loading, fetchUser, logout } = useAuth()

onMounted(() => {
  fetchUser()
})

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
          id.delta-mind.at
        </h1>
        <p class="text-center text-sm text-muted mt-2">
          DDISA Identity Provider + ClawGate
        </p>
      </template>

      <div v-if="loading" class="text-center text-muted">
        Loading...
      </div>

      <div v-else-if="user" class="space-y-4">
        <UAlert color="success" title="Logged in as">
          <template #description>
            <p class="font-semibold">{{ user.name }}</p>
            <p class="text-sm">{{ user.email }}</p>
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

        <UButton
          to="/grants"
          color="primary"
          block
          label="Manage Grants"
        />

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

      <div v-else class="space-y-4">
        <p class="text-muted text-center text-sm">
          Production Identity Provider for @delta-mind.at users.
        </p>
        <UButton
          to="/login"
          color="primary"
          block
          label="Login"
        />
      </div>
    </UCard>
  </div>
</template>
