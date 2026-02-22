<script setup lang="ts">
const { user, loading: authLoading, fetchUser } = useAuth()
const route = useRoute()

const grant = ref<Record<string, unknown> | null>(null)
const loading = ref(true)
const error = ref('')
const processing = ref(false)

const grantId = computed(() => route.query.grant_id as string)
const callbackUrl = computed(() => route.query.callback as string)

onMounted(async () => {
  await fetchUser()

  // If not logged in, redirect to login with returnTo
  if (!user.value) {
    const returnTo = `/grant-approval?${new URLSearchParams(route.query as Record<string, string>).toString()}`
    await navigateTo(`/login?returnTo=${encodeURIComponent(returnTo)}`)
    return
  }

  if (!grantId.value) {
    error.value = 'Missing grant_id parameter'
    loading.value = false
    return
  }

  try {
    grant.value = await $fetch(`/api/grants/${grantId.value}`)
  }
  catch {
    error.value = 'Grant not found'
  }
  finally {
    loading.value = false
  }
})

async function handleApprove() {
  processing.value = true
  try {
    const result = await $fetch<{ grant: Record<string, unknown>, authzJWT: string }>(
      `/api/grants/${grantId.value}/approve`,
      { method: 'POST' },
    )

    // Redirect back to SP with the AuthZ-JWT
    if (callbackUrl.value) {
      const url = new URL(callbackUrl.value)
      url.searchParams.set('grant_id', grantId.value)
      url.searchParams.set('authz_jwt', result.authzJWT)
      url.searchParams.set('status', 'approved')
      await navigateTo(url.toString(), { external: true })
    }
    else {
      grant.value = result.grant
    }
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Approval failed'
  }
  finally {
    processing.value = false
  }
}

async function handleDeny() {
  processing.value = true
  try {
    await $fetch(`/api/grants/${grantId.value}/deny`, { method: 'POST' })

    if (callbackUrl.value) {
      const url = new URL(callbackUrl.value)
      url.searchParams.set('grant_id', grantId.value)
      url.searchParams.set('status', 'denied')
      await navigateTo(url.toString(), { external: true })
    }
    else {
      grant.value = { ...(grant.value ?? {}), status: 'denied' }
    }
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Denial failed'
  }
  finally {
    processing.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-lg">
      <template #header>
        <h1 class="text-2xl font-bold text-center">
          Permission Request
        </h1>
      </template>

      <div v-if="loading || authLoading" class="text-center text-muted">
        Loading...
      </div>

      <UAlert v-else-if="error" color="error" :title="error" />

      <template v-else-if="grant">
        <div v-if="(grant as any).status === 'pending'" class="space-y-4">
          <UAlert color="warning" title="An application is requesting permission:">
            <template #description>
              <dl class="text-sm space-y-2 mt-2">
                <div class="flex justify-between">
                  <dt class="text-muted">
                    Requester
                  </dt>
                  <dd class="font-mono">
                    {{ (grant as any).request?.requester }}
                  </dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-muted">
                    Target
                  </dt>
                  <dd class="font-mono">
                    {{ (grant as any).request?.target }}
                  </dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-muted">
                    Type
                  </dt>
                  <dd class="font-mono">
                    {{ (grant as any).request?.grant_type }}
                  </dd>
                </div>
                <div v-if="(grant as any).request?.command?.length">
                  <dt class="text-muted mb-1">
                    Command
                  </dt>
                  <dd class="font-mono text-sm bg-gray-900 text-green-400 rounded px-3 py-2 break-all">
                    {{ (grant as any).request.command.join(' ') }}
                  </dd>
                </div>
                <div v-if="(grant as any).request?.cmd_hash" class="flex justify-between">
                  <dt class="text-muted">
                    Hash
                  </dt>
                  <dd class="font-mono text-xs text-dimmed truncate ml-2">
                    {{ (grant as any).request.cmd_hash }}
                  </dd>
                </div>
                <div v-if="(grant as any).request?.reason" class="flex justify-between">
                  <dt class="text-muted">
                    Reason
                  </dt>
                  <dd class="">
                    {{ (grant as any).request?.reason }}
                  </dd>
                </div>
                <div v-if="(grant as any).request?.permissions?.length" class="flex justify-between">
                  <dt class="text-muted">
                    Permissions
                  </dt>
                  <dd class="font-mono">
                    {{ (grant as any).request?.permissions?.join(', ') }}
                  </dd>
                </div>
              </dl>
            </template>
          </UAlert>

          <div class="flex gap-3">
            <UButton
              color="success"
              :loading="processing"
              block
              class="flex-1"
              @click="handleApprove"
            >
              Approve
            </UButton>
            <UButton
              color="error"
              :loading="processing"
              block
              class="flex-1"
              @click="handleDeny"
            >
              Deny
            </UButton>
          </div>
        </div>

        <UAlert v-else color="neutral">
          <template #description>
            <p class="text-center">
              This grant has been <strong>{{ (grant as any).status }}</strong>.
            </p>
          </template>
        </UAlert>
      </template>
    </UCard>
  </div>
</template>
