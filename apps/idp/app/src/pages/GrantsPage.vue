<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIdpAuth } from '@openape/vue-components'

const router = useRouter()
const { user, loading: authLoading, fetchUser } = useIdpAuth()

const grants = ref<any[]>([])
const loading = ref(true)
const actionError = ref('')
const statusFilter = ref('all')

const revokeConfirmId = ref<string | null>(null)

const filteredGrants = computed(() => {
  if (statusFilter.value === 'all') return grants.value
  return grants.value.filter(g => g.status === statusFilter.value)
})

const pendingCount = computed(() => grants.value.filter(g => g.status === 'pending').length)
const activeCount = computed(() => grants.value.filter(g => g.status === 'approved').length)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    router.push('/login')
    return
  }
  await loadGrants()
})

async function loadGrants() {
  loading.value = true
  try {
    const res = await fetch('/api/grants?limit=100', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      grants.value = data.data || data
    }
    else {
      grants.value = []
    }
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
    const res = await fetch(`/api/grants/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ grant_type: 'once' }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || (err as Record<string, string>).statusMessage || 'Approval failed')
    }
    await loadGrants()
  }
  catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Failed to approve grant'
  }
}

async function denyGrant(id: string) {
  actionError.value = ''
  try {
    const res = await fetch(`/api/grants/${id}/deny`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) throw new Error('Denial failed')
    await loadGrants()
  }
  catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Failed to deny grant'
  }
}

function requestRevoke(id: string) {
  revokeConfirmId.value = id
}

function cancelRevoke() {
  revokeConfirmId.value = null
}

async function confirmRevoke() {
  const id = revokeConfirmId.value
  revokeConfirmId.value = null
  if (!id) return
  actionError.value = ''
  try {
    const res = await fetch(`/api/grants/${id}/revoke`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) throw new Error('Revocation failed')
    await loadGrants()
  }
  catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Failed to revoke grant'
  }
}

function formatRequester(requester: string) {
  if (!requester) return ''
  if (requester.length > 30) return `${requester.slice(0, 20)}...${requester.slice(-8)}`
  return requester
}

function formatTime(ts: number) {
  if (!ts) return ''
  const ms = ts < 1e12 ? ts * 1000 : ts
  return new Date(ms).toLocaleString()
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    pending: 'warning',
    approved: 'success',
    denied: 'error',
    revoked: 'neutral',
    expired: 'warning',
    used: 'info',
  }
  return (map[status] || 'neutral') as any
}
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            Grant Management
          </h1>
          <p class="text-sm text-(--ui-text-muted)">
            {{ pendingCount }} pending, {{ activeCount }} active
          </p>
        </div>
        <div class="flex gap-3">
          <UButton color="primary" variant="soft" size="sm" @click="loadGrants">
            Refresh
          </UButton>
          <UButton color="neutral" variant="soft" size="sm" @click="router.push('/')">
            Back
          </UButton>
        </div>
      </div>

      <UAlert v-if="actionError" color="error" :title="actionError" class="mb-4" />

      <div v-if="loading || authLoading" class="text-center text-(--ui-text-muted) mt-10">
        Loading...
      </div>

      <template v-else>
        <div class="flex gap-2 mb-4">
          <UButton
            :color="statusFilter === 'all' ? 'primary' : 'neutral'"
            :variant="statusFilter === 'all' ? 'solid' : 'soft'"
            size="xs"
            @click="statusFilter = 'all'"
          >
            All ({{ grants.length }})
          </UButton>
          <UButton
            :color="statusFilter === 'pending' ? 'warning' : 'neutral'"
            :variant="statusFilter === 'pending' ? 'solid' : 'soft'"
            size="xs"
            @click="statusFilter = 'pending'"
          >
            Pending ({{ pendingCount }})
          </UButton>
          <UButton
            :color="statusFilter === 'approved' ? 'success' : 'neutral'"
            :variant="statusFilter === 'approved' ? 'solid' : 'soft'"
            size="xs"
            @click="statusFilter = 'approved'"
          >
            Active ({{ activeCount }})
          </UButton>
        </div>

        <div v-if="filteredGrants.length === 0">
          <UCard>
            <p class="text-sm text-(--ui-text-muted) text-center">
              No grants found.
            </p>
          </UCard>
        </div>
        <div v-else class="space-y-3">
          <UCard v-for="grant in filteredGrants" :key="grant.id">
            <div class="flex flex-col sm:flex-row items-start justify-between gap-3">
              <div class="flex-1 min-w-0 text-sm space-y-1 w-full">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs text-(--ui-text-dimmed)">{{ grant.id?.slice(0, 8) }}...</span>
                  <UBadge :color="statusColor(grant.status)" variant="soft" :label="grant.status" />
                  <UBadge v-if="grant.request?.grant_type" color="secondary" variant="soft" :label="grant.request.grant_type" />
                </div>
                <p>
                  <span class="text-(--ui-text-muted)">Requester:</span>
                  {{ formatRequester(grant.request?.requester || grant.requester) }}
                </p>
                <p>
                  <span class="text-(--ui-text-muted)">Host:</span>
                  {{ grant.request?.target_host || grant.targetHost }}
                </p>
                <p v-if="grant.request?.run_as">
                  <span class="text-(--ui-text-muted)">Run as:</span> {{ grant.request.run_as }}
                </p>
                <div v-if="grant.request?.command?.length" class="mt-1">
                  <span class="text-(--ui-text-muted)">Command:</span>
                  <code class="block font-mono text-xs bg-gray-900 text-green-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.command.join(" ") }}</code>
                </div>
                <p v-if="grant.request?.reason">
                  <span class="text-(--ui-text-muted)">Reason:</span> {{ grant.request.reason }}
                </p>
                <p v-if="grant.decided_by || grant.decidedBy" class="text-xs text-(--ui-text-dimmed)">
                  Decided by: {{ grant.decided_by || grant.decidedBy }}
                </p>
                <p class="text-xs text-(--ui-text-dimmed)">
                  Created: {{ formatTime(grant.created_at || grant.createdAt) }}
                </p>
                <p v-if="grant.expires_at || grant.expiresAt" class="text-xs text-(--ui-text-dimmed)">
                  Expires: {{ formatTime(grant.expires_at || grant.expiresAt) }}
                </p>
              </div>
              <div class="flex gap-2 flex-shrink-0">
                <template v-if="grant.status === 'pending'">
                  <UButton color="success" size="xs" @click="approveGrant(grant.id)">
                    Approve
                  </UButton>
                  <UButton color="error" size="xs" @click="denyGrant(grant.id)">
                    Deny
                  </UButton>
                </template>
                <UButton
                  v-if="grant.status === 'approved'"
                  color="neutral"
                  size="xs"
                  @click="requestRevoke(grant.id)"
                >
                  Revoke
                </UButton>
              </div>
            </div>
          </UCard>
        </div>
      </template>

      <UModal :open="!!revokeConfirmId" @close="cancelRevoke">
        <template #content>
          <div class="p-6 space-y-4">
            <h3 class="text-lg font-semibold">
              Revoke Permission?
            </h3>
            <p class="text-sm text-(--ui-text-muted)">
              This will permanently revoke this grant. The agent will no longer be able to use this permission.
            </p>
            <div class="flex gap-3 justify-end">
              <UButton color="neutral" variant="soft" @click="cancelRevoke">
                Cancel
              </UButton>
              <UButton color="error" @click="confirmRevoke">
                Revoke
              </UButton>
            </div>
          </div>
        </template>
      </UModal>
    </div>
  </div>
</template>
