<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { navigateTo, useIdpAuth, useRoute } from '#imports'

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const route = useRoute()

const grant = ref<Record<string, unknown> | null>(null)
const loading = ref(true)
const error = ref('')
const processing = ref(false)

const grantId = computed(() => route.query.grant_id as string)
const callbackUrl = computed(() => route.query.callback as string)
const isDelegate = computed(() => (grant.value as any)?.request?.permissions?.includes('delegate'))
const delegateDuration = computed(() => {
  const req = (grant.value as any)?.request
  if (!req?.duration) return null
  const h = Math.floor(req.duration / 3600)
  const m = Math.floor((req.duration % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
})

onMounted(async () => {
  await fetchUser()

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
          <UAlert
            v-if="isDelegate"
            color="error"
            title="Identity Delegation Request"
          >
            <template #description>
              <p class="font-semibold">
                {{ (grant as any).request?.requester }} is requesting to act <strong>as you</strong> at {{ (grant as any).request?.target }}.
              </p>
              <p v-if="delegateDuration" class="mt-1 text-sm">
                Duration: {{ delegateDuration }}
              </p>
              <p v-else-if="(grant as any).request?.grant_type === 'once'" class="mt-1 text-sm">
                Single use only.
              </p>
              <p v-else-if="(grant as any).request?.grant_type === 'always'" class="mt-1 text-sm">
                Permanent — until revoked.
              </p>
            </template>
          </UAlert>

          <UAlert :color="isDelegate ? 'error' : 'warning'" title="An application is requesting permission:">
            <template #description>
              <dl class="text-sm space-y-2 mt-2">
                <div>
                  <dt class="text-muted">Requester</dt>
                  <dd class="font-mono text-sm break-all">{{ (grant as any).request?.requester }}</dd>
                </div>
                <div>
                  <dt class="text-muted">Target</dt>
                  <dd class="font-mono text-sm">{{ (grant as any).request?.target }}</dd>
                </div>
                <div>
                  <dt class="text-muted">Type</dt>
                  <dd class="font-mono text-sm">{{ (grant as any).request?.grant_type }}</dd>
                </div>
                <div v-if="(grant as any).request?.command?.length">
                  <dt class="text-muted mb-1">Command</dt>
                  <dd class="font-mono text-xs bg-gray-900 text-green-400 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-words">{{ (grant as any).request.command.join(' ') }}</dd>
                </div>
                <div v-if="(grant as any).request?.cmd_hash">
                  <dt class="text-muted">Hash</dt>
                  <dd class="font-mono text-xs text-dimmed break-all">{{ (grant as any).request.cmd_hash }}</dd>
                </div>
                <div v-if="(grant as any).request?.reason">
                  <dt class="text-muted">Reason</dt>
                  <dd>{{ (grant as any).request?.reason }}</dd>
                </div>
                <div v-if="(grant as any).request?.permissions?.length">
                  <dt class="text-muted">Permissions</dt>
                  <dd class="font-mono text-sm">{{ (grant as any).request?.permissions?.join(', ') }}</dd>
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

        <div v-else class="space-y-4">
          <UAlert
            :color="(grant as any).status === 'approved' ? 'success' : (grant as any).status === 'denied' ? 'error' : 'neutral'"
            :title="`Grant ${(grant as any).status}`"
          >
            <template #description>
              <dl class="text-sm space-y-2 mt-2">
                <div>
                  <dt class="text-muted">Requester</dt>
                  <dd class="font-mono text-sm break-all">{{ (grant as any).request?.requester }}</dd>
                </div>
                <div>
                  <dt class="text-muted">Target</dt>
                  <dd class="font-mono text-sm">{{ (grant as any).request?.target }}</dd>
                </div>
                <div v-if="(grant as any).request?.command?.length">
                  <dt class="text-muted">Command</dt>
                  <dd class="font-mono text-xs bg-gray-900 text-green-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ (grant as any).request.command.join(' ') }}</dd>
                </div>
                <div v-if="(grant as any).request?.reason">
                  <dt class="text-muted">Reason</dt>
                  <dd>{{ (grant as any).request?.reason }}</dd>
                </div>
                <div v-if="(grant as any).decided_by">
                  <dt class="text-muted">Decided by</dt>
                  <dd>{{ (grant as any).decided_by }}</dd>
                </div>
              </dl>
            </template>
          </UAlert>
        </div>
      </template>
    </UCard>
  </div>
</template>
