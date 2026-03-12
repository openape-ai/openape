<script setup lang="ts">
const { user, loading, fetchUser, logout } = useOpenApeAuth()
const route = useRoute()

const grantStatus = ref('')
const hasPermission = ref(false)
const requesting = ref(false)
const executing = ref(false)
const actionResult = ref<Record<string, unknown> | null>(null)
const error = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    navigateTo('/')
    return
  }

  // Check for grant callback status from URL
  if (route.query.grant_status) {
    grantStatus.value = String(route.query.grant_status)
    if (grantStatus.value === 'approved') {
      hasPermission.value = true
    }
  }
  else {
    // Check session for existing AuthZ-JWT (persists across refresh)
    const status = await $fetch<{ hasAuthzJWT: boolean }>('/api/grant-status')
    if (status.hasAuthzJWT) {
      hasPermission.value = true
    }
  }
})

async function requestPermission() {
  error.value = ''
  requesting.value = true
  try {
    const { redirectUrl } = await $fetch<{ redirectUrl: string }>('/api/request-permission', {
      method: 'POST',
      body: { action: 'protected-action', reason: 'Execute a protected action on Sample SP' },
    })
    navigateTo(redirectUrl, { external: true })
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Permission request failed'
    requesting.value = false
  }
}

async function executeProtectedAction() {
  error.value = ''
  executing.value = true
  actionResult.value = null
  try {
    const result = await $fetch<Record<string, unknown>>('/api/protected-action', {
      method: 'POST',
    })
    actionResult.value = result
    if (result.grantConsumed) {
      hasPermission.value = false
    }
  }
  catch (err: unknown) {
    const e = err as { statusCode?: number, data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Action failed'
    if (e.statusCode === 403) {
      hasPermission.value = false
    }
  }
  finally {
    executing.value = false
  }
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-2xl mx-auto">
      <div v-if="loading" class="text-center text-muted mt-20">
        Loading...
      </div>

      <template v-else-if="user">
        <div class="flex items-center justify-between mb-8">
          <h1 class="text-2xl font-bold">
            Dashboard
          </h1>
          <UButton color="error" variant="soft" size="sm" @click="logout">
            Logout
          </UButton>
        </div>

        <!-- DDISA Assertion Claims -->
        <UCard class="mb-6">
          <template #header>
            <p class="text-green-400 font-medium">
              Authenticated via DDISA
            </p>
          </template>

          <div class="divide-y divide-(--ui-border)">
            <div class="px-6 py-3 flex justify-between">
              <span class="text-sm text-muted">Subject (sub)</span>
              <span class="text-sm font-mono">{{ user.sub }}</span>
            </div>
            <div class="px-6 py-3 flex justify-between">
              <span class="text-sm text-muted">Issuer (iss)</span>
              <span class="text-sm font-mono">{{ user.iss }}</span>
            </div>
            <div class="px-6 py-3 flex justify-between">
              <span class="text-sm text-muted">Audience (aud)</span>
              <span class="text-sm font-mono">{{ user.aud }}</span>
            </div>
            <div class="px-6 py-3 flex justify-between">
              <span class="text-sm text-muted">Issued At</span>
              <span class="text-sm">{{ formatTimestamp(user.iat) }}</span>
            </div>
          </div>
        </UCard>

        <!-- Grant Status Notification -->
        <UAlert
          v-if="grantStatus === 'approved'"
          color="success"
          title="Permission granted! You can now execute the protected action."
          class="mb-4"
        />
        <UAlert
          v-if="grantStatus === 'denied'"
          color="error"
          title="Permission denied by the user."
          class="mb-4"
        />

        <!-- Error -->
        <UAlert
          v-if="error"
          color="error"
          :title="error"
          class="mb-4"
        />

        <!-- OpenApe Protected Action -->
        <UCard>
          <template #header>
            <h2 class="text-lg font-semibold">
              OpenApe Protected Action
            </h2>
          </template>

          <p class="text-sm text-muted mb-4">
            This action requires OpenApe authorization. Click "Request Permission" to be redirected to the IdP for approval.
          </p>

          <div class="flex gap-3">
            <UButton
              v-if="hasPermission"
              color="success"
              :loading="executing"
              :disabled="executing"
              label="Execute Protected Action"
              @click="executeProtectedAction"
            />

            <UButton
              color="warning"
              :loading="requesting"
              :disabled="requesting"
              :label="hasPermission ? 'Request New Permission' : 'Request Permission'"
              @click="requestPermission"
            />
          </div>

          <!-- Action Result -->
          <UCard v-if="actionResult" variant="soft" class="mt-4">
            <p class="text-sm font-medium text-muted mb-2">
              Result:
            </p>
            <pre class="text-xs overflow-auto">{{ JSON.stringify(actionResult, null, 2) }}</pre>
          </UCard>
        </UCard>
      </template>
    </div>
  </div>
</template>
