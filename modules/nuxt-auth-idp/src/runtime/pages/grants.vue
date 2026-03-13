<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { navigateTo, useIdpAuth } from '#imports'

const { user, loading: authLoading, fetchUser } = useIdpAuth()

interface Grant {
  id: string
  status: string
  request: {
    requester: string
    target: string
    grant_type: string
    command?: string[]
    cmd_hash?: string
    reason?: string
    permissions?: string[]
  }
  created_at: number
  decided_at?: number
  decided_by?: string
  expires_at?: number
  used_at?: number
}

const grants = ref<Grant[]>([])
const loading = ref(true)
const actionError = ref('')

const pendingGrants = computed(() => grants.value.filter(g => g.status === 'pending'))
const activeGrants = computed(() => grants.value.filter(g => g.status === 'approved' && g.request.grant_type !== 'once'))
const historyGrants = computed(() => grants.value.filter(g => g.status !== 'pending' && !(g.status === 'approved' && g.request.grant_type !== 'once')))

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await loadGrants()
})

async function loadGrants() {
  loading.value = true
  try {
    const response = await $fetch<{ data: Grant[] }>('/api/grants')
    grants.value = response.data
  }
  catch {
    grants.value = []
  }
  finally {
    loading.value = false
  }
}

async function approveGrant(id: string) {
  actionError.value = ''
  try {
    await $fetch(`/api/grants/${id}/approve`, { method: 'POST' })
    await loadGrants()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    actionError.value = e.data?.statusMessage ?? 'Failed to approve grant'
  }
}

async function denyGrant(id: string) {
  actionError.value = ''
  try {
    await $fetch(`/api/grants/${id}/deny`, { method: 'POST' })
    await loadGrants()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    actionError.value = e.data?.statusMessage ?? 'Failed to deny grant'
  }
}

async function revokeGrant(id: string) {
  actionError.value = ''
  try {
    await $fetch(`/api/grants/${id}/revoke`, { method: 'POST' })
    await loadGrants()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    actionError.value = e.data?.statusMessage ?? 'Failed to revoke grant'
  }
}

function formatRequester(requester: string): string {
  if (requester.startsWith('agent:'))
    return `Agent ${requester.slice(6, 14)}...`
  return requester
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">
          Grant Management
        </h1>
        <div class="flex gap-3">
          <UButton color="primary" variant="soft" size="sm" @click="loadGrants">
            Refresh
          </UButton>
          <UButton to="/" color="neutral" variant="soft" size="sm">
            Back
          </UButton>
        </div>
      </div>

      <UAlert v-if="actionError" color="error" :title="actionError" class="mb-4" />

      <div v-if="loading || authLoading" class="text-center text-muted mt-10">
        Loading...
      </div>

      <template v-else>
        <section class="mb-8">
          <h2 class="text-lg font-semibold mb-3">
            Pending Requests
            <span class="text-sm font-normal text-muted">({{ pendingGrants.length }})</span>
          </h2>
          <UCard v-if="pendingGrants.length === 0">
            <p class="text-sm text-muted text-center">
              No pending requests.
            </p>
          </UCard>
          <div v-else class="space-y-3">
            <UCard v-for="grant in pendingGrants" :key="grant.id">
              <div class="flex flex-col gap-3">
                <div class="text-sm space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-xs text-dimmed">{{ grant.id.slice(0, 8) }}...</span>
                    <UBadge color="warning" variant="soft" :label="grant.status" />
                    <UBadge color="secondary" :label="grant.request.grant_type" />
                  </div>
                  <p><span class="text-muted">Requester:</span> {{ formatRequester(grant.request.requester) }}</p>
                  <p><span class="text-muted">Target:</span> {{ grant.request.target }}</p>
                  <div v-if="grant.request.command?.length" class="mt-1">
                    <span class="text-muted">Command:</span>
                    <code class="block font-mono text-xs bg-gray-900 text-green-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.command.join(' ') }}</code>
                  </div>
                  <div v-if="grant.request.permissions?.length" class="mt-1">
                    <span class="text-muted">Permissions:</span>
                    <code class="block font-mono text-xs bg-gray-900 text-blue-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.permissions.join(', ') }}</code>
                  </div>
                  <p v-if="grant.request.reason">
                    <span class="text-muted">Reason:</span> {{ grant.request.reason }}
                  </p>
                  <p class="text-xs text-dimmed">
                    Created: {{ formatTime(grant.created_at) }}
                  </p>
                </div>
                <div class="flex gap-2">
                  <UButton color="success" size="sm" class="flex-1" @click="approveGrant(grant.id)">
                    Approve
                  </UButton>
                  <UButton color="error" size="sm" class="flex-1" @click="denyGrant(grant.id)">
                    Deny
                  </UButton>
                </div>
              </div>
            </UCard>
          </div>
        </section>

        <section class="mb-8">
          <h2 class="text-lg font-semibold mb-3">
            Active Permissions
            <span class="text-sm font-normal text-muted">({{ activeGrants.length }})</span>
          </h2>
          <UCard v-if="activeGrants.length === 0">
            <p class="text-sm text-muted text-center">
              No active permissions.
            </p>
          </UCard>
          <div v-else class="space-y-3">
            <UCard v-for="grant in activeGrants" :key="grant.id">
              <div class="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div class="flex-1 min-w-0 text-sm space-y-1 w-full">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-xs text-dimmed">{{ grant.id.slice(0, 8) }}...</span>
                    <UBadge color="success" variant="soft" :label="grant.status" />
                    <UBadge color="secondary" :label="grant.request.grant_type" />
                  </div>
                  <p><span class="text-muted">Requester:</span> {{ formatRequester(grant.request.requester) }}</p>
                  <p><span class="text-muted">Target:</span> {{ grant.request.target }}</p>
                  <div v-if="grant.request.command?.length" class="mt-1">
                    <span class="text-muted">Command:</span>
                    <code class="block font-mono text-xs bg-gray-900 text-green-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.command.join(' ') }}</code>
                  </div>
                  <div v-if="grant.request.permissions?.length" class="mt-1">
                    <span class="text-muted">Permissions:</span>
                    <code class="block font-mono text-xs bg-gray-900 text-blue-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.permissions.join(', ') }}</code>
                  </div>
                  <p v-if="grant.request.reason">
                    <span class="text-muted">Reason:</span> {{ grant.request.reason }}
                  </p>
                  <p v-if="grant.decided_by" class="text-xs text-dimmed">
                    Approved by: {{ grant.decided_by }}
                  </p>
                  <p v-if="grant.expires_at" class="text-xs text-dimmed">
                    Expires: {{ formatTime(grant.expires_at) }}
                  </p>
                </div>
                <UButton
                  color="neutral"
                  size="xs"
                  class="flex-shrink-0"
                  @click="revokeGrant(grant.id)"
                >
                  Revoke
                </UButton>
              </div>
            </UCard>
          </div>
        </section>

        <section>
          <h2 class="text-lg font-semibold mb-3">
            History
            <span class="text-sm font-normal text-muted">({{ historyGrants.length }})</span>
          </h2>
          <UCard v-if="historyGrants.length === 0">
            <p class="text-sm text-muted text-center">
              No history.
            </p>
          </UCard>
          <div v-else class="space-y-3">
            <UCard v-for="grant in historyGrants" :key="grant.id" class="opacity-75">
              <div class="text-sm space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs text-dimmed">{{ grant.id.slice(0, 8) }}...</span>
                  <UBadge
                    :color="(({ denied: 'error', revoked: 'neutral', expired: 'warning', used: 'info' } as Record<string, 'error' | 'neutral' | 'warning' | 'info'>)[grant.status] || 'neutral')"
                    :variant="grant.status === 'expired' ? 'outline' : 'soft'"
                    :label="grant.status"
                  />
                </div>
                <p><span class="text-muted">Requester:</span> {{ formatRequester(grant.request.requester) }}</p>
                <p><span class="text-muted">Target:</span> {{ grant.request.target }}</p>
                <div v-if="grant.request.command?.length" class="mt-1">
                  <span class="text-muted">Command:</span>
                  <code class="block font-mono text-xs bg-gray-900 text-green-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.command.join(' ') }}</code>
                </div>
                <div v-if="grant.request.permissions?.length" class="mt-1">
                  <span class="text-muted">Permissions:</span>
                  <code class="block font-mono text-xs bg-gray-900 text-blue-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.permissions.join(', ') }}</code>
                </div>
                <p v-if="grant.request.reason">
                  <span class="text-muted">Reason:</span> {{ grant.request.reason }}
                </p>
                <p v-if="grant.decided_by" class="text-xs text-dimmed">
                  Decided by: {{ grant.decided_by }}
                </p>
                <p class="text-xs text-dimmed">
                  Created: {{ formatTime(grant.created_at) }}
                </p>
              </div>
            </UCard>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
