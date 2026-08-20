<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { navigateTo, useHead, useIdpAuth } from '#imports'
import { formatCliResourceChain, formatWidenedPreview, getCliAuthorizationDetails, summarizeCliGrant } from '../utils/cli-grants'
import { formatRequesterName, unwrapShellCommand } from '../utils/command-display'

useHead({ title: 'Grants' })

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const activeAndPending = ref([])
const historyGrants = ref([])
const historyCursor = ref(null)
const historyHasMore = ref(false)
const loadingHistory = ref(false)
const loading = ref(true)
const actionError = ref('')
const grantTypeSelections = ref({})
const durationPresetSelections = ref({})
const customDurations = ref({})
const extendModeSelections = ref({})
const similarGrantsData = ref({})
const DURATION_PRESETS = [
  { label: '1 hour', value: '3600' },
  { label: '4 hours', value: '14400' },
  { label: '1 day', value: '86400' },
  { label: '1 week', value: '604800' },
  { label: 'Custom', value: 'custom' },
]
const GRANT_TYPE_OPTIONS = [
  { label: 'Once', value: 'once', description: 'Single use only' },
  { label: 'Timed', value: 'timed', description: 'Time-limited' },
  { label: 'Always', value: 'always', description: 'Until revoked' },
]
const EXTEND_MODE_OPTIONS = [
  { label: 'Extend to wildcard', value: 'widen', description: 'Widen scope with wildcards' },
  { label: 'Add this value', value: 'merge', description: 'Merge keeping specific selectors' },
  { label: 'Approve as separate', value: 'separate', description: 'New independent grant' },
]
async function loadSimilarGrants(grantId) {
  if (similarGrantsData.value[grantId]) return
  try {
    const data = await $fetch(`/api/grants/${grantId}`)
    if (data.similar_grants) {
      similarGrantsData.value[grantId] = data.similar_grants
      if (!extendModeSelections.value[grantId]) {
        extendModeSelections.value[grantId] = 'separate'
      }
    }
  }
  catch {
  }
}
function hasSimilar(grantId) {
  return !!similarGrantsData.value[grantId]?.similar_grants?.length
}
function getEffectiveDuration(grantId) {
  if (grantTypeSelections.value[grantId] !== 'timed') return void 0
  const preset = durationPresetSelections.value[grantId] ?? '3600'
  return preset === 'custom' ? customDurations.value[grantId] ?? 3600 : Number(preset)
}
const pendingGrants = computed(() => activeAndPending.value.filter(g => g.status === 'pending'))
const activeGrants = computed(() => activeAndPending.value.filter(g => g.status === 'approved'))
// Refetch when the PWA returns to the foreground (push tap focuses an
// already-open window without remounting; without this the list would
// keep showing stale state from before the new grant arrived).
function onVisibilityChange() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && user.value) {
    loadGrants()
  }
}

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  await loadGrants()
})

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
})
async function loadGrants() {
  loading.value = true
  try {
    const [activeRes, historyRes] = await Promise.all([
      $fetch('/api/grants?section=active'),
      $fetch('/api/grants?section=history'),
    ])
    activeAndPending.value = activeRes.data
    historyGrants.value = historyRes.data
    historyCursor.value = historyRes.pagination?.cursor ?? null
    historyHasMore.value = historyRes.pagination?.has_more ?? false
    for (const g of activeRes.data) {
      if (g.status === 'pending' && !grantTypeSelections.value[g.id]) {
        grantTypeSelections.value[g.id] = 'once'
        durationPresetSelections.value[g.id] = '3600'
        customDurations.value[g.id] = 3600
        if (getCliAuthorizationDetails(g.request?.authorization_details).length > 0) {
          loadSimilarGrants(g.id)
        }
      }
    }
  }
  catch {
    activeAndPending.value = []
    historyGrants.value = []
  }
  finally {
    loading.value = false
  }
}
async function loadMoreHistory() {
  if (!historyCursor.value || loadingHistory.value) return
  loadingHistory.value = true
  try {
    const res = await $fetch(`/api/grants?section=history&cursor=${historyCursor.value}`)
    historyGrants.value = [...historyGrants.value, ...res.data]
    historyCursor.value = res.pagination?.cursor ?? null
    historyHasMore.value = res.pagination?.has_more ?? false
  }
  catch {
  }
  finally {
    loadingHistory.value = false
  }
}
async function approveGrant(id, grantTypeOverride) {
  actionError.value = ''
  try {
    const grantType = grantTypeOverride ?? grantTypeSelections.value[id] ?? 'once'
    const extendMode = extendModeSelections.value[id]
    const similar = similarGrantsData.value[id]
    const extendBody = extendMode && extendMode !== 'separate' && similar?.similar_grants?.length
      ? {
          extend_mode: extendMode,
          extend_grant_ids: similar.similar_grants.map(s => s.grant.id),
        }
      : {}
    await $fetch(`/api/grants/${id}/approve`, {
      method: 'POST',
      body: {
        grant_type: grantType,
        ...grantType === 'timed' ? { duration: getEffectiveDuration(id) } : {},
        ...extendBody,
      },
    })
    await loadGrants()
  }
  catch (err) {
    const e = err
    actionError.value = e.data?.statusMessage ?? 'Failed to approve grant'
  }
}
async function denyGrant(id) {
  actionError.value = ''
  try {
    await $fetch(`/api/grants/${id}/deny`, { method: 'POST' })
    await loadGrants()
  }
  catch (err) {
    const e = err
    actionError.value = e.data?.statusMessage ?? 'Failed to deny grant'
  }
}
const revokeConfirmId = ref(null)
function requestRevoke(id) {
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
    await $fetch(`/api/grants/${id}/revoke`, { method: 'POST' })
    await loadGrants()
  }
  catch (err) {
    const e = err
    actionError.value = e.data?.statusMessage ?? 'Failed to revoke grant'
  }
}
// Per-card disclosure for the advanced approval options (timed grants,
// extend/widen against similar grants). The quick actions cover the common
// phone-approval moment; everything else lives behind this toggle.
const moreOptionsOpen = ref({})
function toggleMoreOptions(id) {
  moreOptionsOpen.value = { ...moreOptionsOpen.value, [id]: !moreOptionsOpen.value[id] }
}
function commandDisplay(grant) {
  return unwrapShellCommand(grant.request?.command)
}
function formatTime(ts) {
  return new Date(ts * 1e3).toLocaleString()
}
function cliSummary(grant) {
  return summarizeCliGrant(grant.request.authorization_details)
}
function cliDetails(grant) {
  return getCliAuthorizationDetails(grant.request.authorization_details)
}
function isExactCommand(detail) {
  return detail.constraints?.exact_command === true
}
</script>

<template>
  <IdpPage title="Grants" :subtitle="user?.email" back-to="/account" back-label="Account">
    <template #actions>
      <UButton color="primary" variant="soft" size="sm" @click="loadGrants">
        Refresh
      </UButton>
    </template>

    <UAlert v-if="actionError" color="error" :title="actionError" class="mb-4" />

    <div v-if="loading || authLoading" class="text-center text-muted mt-10">
      Loading…
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
                  <span class="text-base font-semibold">{{ formatRequesterName(grant.request.requester) }}</span>
                  <UBadge v-if="grant.request.run_as" color="warning" variant="soft" :label="`run as ${grant.request.run_as}`" />
                  <span class="text-xs text-dimmed">on {{ grant.request.target_host }}</span>
                </div>
                <p v-if="grant.request.reason">
                  {{ grant.request.reason }}
                </p>
                <p v-if="cliSummary(grant)" class="text-muted">
                  {{ cliSummary(grant) }}
                </p>
                <div v-if="commandDisplay(grant)" class="mt-1">
                  <div class="flex items-center gap-2">
                    <span class="text-muted">Command:</span>
                    <UBadge v-if="commandDisplay(grant).shell" color="neutral" variant="outline" size="xs" :label="`via ${commandDisplay(grant).shell}`" />
                  </div>
                  <code class="block font-mono text-xs bg-default text-green-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ commandDisplay(grant).text }}</code>
                </div>
                <div v-if="cliDetails(grant).length" class="mt-1 space-y-1">
                  <div
                    v-for="detail in cliDetails(grant)"
                    :key="`${detail.cli_id}:${detail.operation_id}:${detail.permission}`"
                    class="rounded bg-elevated/50 px-2 py-1"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge color="primary" variant="soft" :label="detail.cli_id" />
                      <UBadge color="neutral" variant="soft" :label="detail.action" />
                      <UBadge :color="isExactCommand(detail) ? 'warning' : 'success'" variant="soft" :label="isExactCommand(detail) ? 'exact-only' : 'reusable'" />
                    </div>
                    <div class="text-xs mt-1">
                      {{ detail.display }}
                    </div>
                    <div class="font-mono text-xs text-dimmed break-all">
                      {{ detail.permission }}
                    </div>
                    <div class="font-mono text-xs text-dimmed">
                      {{ formatCliResourceChain(detail) }}
                    </div>
                  </div>
                </div>
                <p class="text-xs text-dimmed">
                  {{ grant.request.requester }} · {{ formatTime(grant.created_at) }}
                </p>
              </div>

              <div class="flex gap-2">
                <UButton color="error" variant="soft" size="sm" class="flex-1" @click="denyGrant(grant.id)">
                  Deny
                </UButton>
                <UButton color="success" size="sm" class="flex-1" @click="approveGrant(grant.id, 'once')">
                  Just this once
                </UButton>
                <UButton color="success" variant="outline" size="sm" class="flex-1" @click="approveGrant(grant.id, 'always')">
                  Always allow
                </UButton>
              </div>

              <button
                type="button"
                class="self-start flex items-center gap-2 text-xs text-muted hover:text-default"
                @click="toggleMoreOptions(grant.id)"
              >
                <span>{{ moreOptionsOpen[grant.id] ? '▾' : '▸' }} More options</span>
                <UBadge v-if="hasSimilar(grant.id)" color="info" variant="soft" size="xs" label="similar grants exist" />
              </button>

              <div v-if="moreOptionsOpen[grant.id]" class="space-y-3">
                <p class="font-mono text-xs text-dimmed">
                  Grant {{ grant.id.slice(0, 8) }}… · Audience: {{ grant.request.audience }} · Requested as: {{ grant.request.grant_type }}
                </p>
                <div v-if="grant.request.permissions?.length">
                  <span class="text-xs text-muted">Permissions:</span>
                  <code class="block font-mono text-xs bg-default text-blue-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.permissions.join(", ") }}</code>
                </div>
                <div v-if="hasSimilar(grant.id)" class="rounded border border-info/30 bg-info/5 px-3 py-2 space-y-2">
                  <div class="flex items-center gap-2">
                    <UBadge color="info" variant="soft" label="Similar grants exist" />
                  </div>
                  <div
                    v-for="similar in similarGrantsData[grant.id]?.similar_grants ?? []"
                    :key="similar.grant.id"
                    class="text-xs"
                  >
                    <span class="text-muted">Existing:</span>
                    <span class="font-mono text-dimmed">{{ similar.grant.id.slice(0, 8) }}...</span>
                    <div
                      v-for="detail in getCliAuthorizationDetails(similar.grant.request.authorization_details)"
                      :key="detail.permission"
                      class="font-mono text-dimmed break-all"
                    >
                      {{ detail.permission }}
                    </div>
                  </div>
                  <URadioGroup
                    v-model="extendModeSelections[grant.id]"
                    :items="EXTEND_MODE_OPTIONS"
                  />
                  <div v-if="extendModeSelections[grant.id] === 'widen'" class="rounded bg-elevated/50 px-2 py-1">
                    <p class="text-xs text-muted">
                      Result:
                    </p>
                    <p
                      v-for="perm in formatWidenedPreview(similarGrantsData[grant.id]?.widened_details ?? [])"
                      :key="perm"
                      class="font-mono text-xs text-green-400"
                    >
                      {{ perm }}
                    </p>
                  </div>
                  <div v-if="extendModeSelections[grant.id] === 'merge'" class="rounded bg-elevated/50 px-2 py-1">
                    <p class="text-xs text-muted">
                      Result:
                    </p>
                    <p
                      v-for="perm in formatWidenedPreview(similarGrantsData[grant.id]?.merged_details ?? [])"
                      :key="perm"
                      class="font-mono text-xs text-blue-400"
                    >
                      {{ perm }}
                    </p>
                  </div>
                </div>
                <div class="space-y-2">
                  <div>
                    <label class="text-xs font-medium text-muted block mb-1">Approval Type</label>
                    <URadioGroup
                      v-model="grantTypeSelections[grant.id]"
                      :items="GRANT_TYPE_OPTIONS"
                    />
                  </div>
                  <div v-if="grantTypeSelections[grant.id] === 'timed'" class="space-y-1">
                    <label class="text-xs font-medium text-muted block">Duration</label>
                    <USelect
                      v-model="durationPresetSelections[grant.id]"
                      :items="DURATION_PRESETS"
                      size="sm"
                    />
                    <UInput
                      v-if="durationPresetSelections[grant.id] === 'custom'"
                      v-model.number="customDurations[grant.id]"
                      type="number"
                      :min="60"
                      placeholder="Duration in seconds"
                      size="sm"
                    />
                  </div>
                  <UButton color="success" variant="outline" size="sm" @click="approveGrant(grant.id)">
                    Approve with selected options
                  </UButton>
                </div>
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
                <p><span class="text-muted">Requester:</span> {{ formatRequesterName(grant.request.requester) }}</p>
                <p><span class="text-muted">Host:</span> {{ grant.request.target_host }} <span class="text-muted">Audience:</span> {{ grant.request.audience }}</p>
                <p v-if="cliSummary(grant)">
                  <span class="text-muted">Request:</span> {{ cliSummary(grant) }}
                </p>
                <p v-if="grant.request.run_as">
                  <span class="text-muted">Run as:</span> {{ grant.request.run_as }}
                </p>
                <div v-if="commandDisplay(grant)" class="mt-1">
                  <div class="flex items-center gap-2">
                    <span class="text-muted">Command:</span>
                    <UBadge v-if="commandDisplay(grant).shell" color="neutral" variant="outline" size="xs" :label="`via ${commandDisplay(grant).shell}`" />
                  </div>
                  <code class="block font-mono text-xs bg-default text-green-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ commandDisplay(grant).text }}</code>
                </div>
                <div v-if="grant.request.permissions?.length" class="mt-1">
                  <span class="text-muted">Permissions:</span>
                  <code class="block font-mono text-xs bg-default text-blue-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.permissions.join(", ") }}</code>
                </div>
                <div v-if="cliDetails(grant).length" class="mt-1 space-y-1">
                  <div
                    v-for="detail in cliDetails(grant)"
                    :key="`${detail.cli_id}:${detail.operation_id}:${detail.permission}`"
                    class="text-xs"
                  >
                    <div class="font-medium">
                      {{ detail.display }}
                    </div>
                    <div class="font-mono text-dimmed break-all">
                      {{ detail.permission }}
                    </div>
                  </div>
                </div>
                <p v-if="grant.request.reason">
                  <span class="text-muted">Reason:</span> {{ grant.request.reason }}
                </p>
                <p v-if="grant.decided_by" class="text-xs text-dimmed flex items-center gap-2">
                  <span>Approved by: {{ grant.decided_by }}</span>
                  <UBadge
                    v-if="grant.auto_approval_kind"
                    :color="grant.auto_approval_kind === 'standing' ? 'info' : 'warning'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ grant.auto_approval_kind }}
                  </UBadge>
                </p>
                <p v-if="grant.expires_at" class="text-xs text-dimmed">
                  Expires: {{ formatTime(grant.expires_at) }}
                </p>
              </div>
              <UButton
                color="neutral"
                size="xs"
                class="flex-shrink-0"
                @click="requestRevoke(grant.id)"
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
            No recent history.
          </p>
        </UCard>
        <div v-else class="space-y-3">
          <UCard v-for="grant in historyGrants" :key="grant.id" class="opacity-75">
            <div class="text-sm space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs text-dimmed">{{ grant.id.slice(0, 8) }}...</span>
                <UBadge
                  :color="{ denied: 'error', revoked: 'neutral', expired: 'warning', used: 'info', approved: 'success' }[grant.status] || 'neutral'"
                  :variant="grant.status === 'expired' ? 'outline' : 'soft'"
                  :label="grant.status"
                />
              </div>
              <p><span class="text-muted">Requester:</span> {{ formatRequesterName(grant.request.requester) }}</p>
              <p><span class="text-muted">Host:</span> {{ grant.request.target_host }} <span class="text-muted">Audience:</span> {{ grant.request.audience }}</p>
              <p v-if="cliSummary(grant)">
                <span class="text-muted">Request:</span> {{ cliSummary(grant) }}
              </p>
              <p v-if="grant.request.run_as">
                <span class="text-muted">Run as:</span> {{ grant.request.run_as }}
              </p>
              <div v-if="grant.request.command?.length" class="mt-1">
                <span class="text-muted">Command:</span>
                <code class="block font-mono text-xs bg-default text-green-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.command.join(" ") }}</code>
              </div>
              <div v-if="grant.request.permissions?.length" class="mt-1">
                <span class="text-muted">Permissions:</span>
                <code class="block font-mono text-xs bg-default text-blue-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">{{ grant.request.permissions.join(", ") }}</code>
              </div>
              <div v-if="cliDetails(grant).length" class="mt-1 space-y-1">
                <div
                  v-for="detail in cliDetails(grant)"
                  :key="`${detail.cli_id}:${detail.operation_id}:${detail.permission}`"
                  class="text-xs"
                >
                  <div class="font-medium">
                    {{ detail.display }}
                  </div>
                  <div class="font-mono text-dimmed break-all">
                    {{ detail.permission }}
                  </div>
                </div>
              </div>
              <p v-if="grant.request.reason">
                <span class="text-muted">Reason:</span> {{ grant.request.reason }}
              </p>
              <p v-if="grant.decided_by" class="text-xs text-dimmed flex items-center gap-2">
                <span>Decided by: {{ grant.decided_by }}</span>
                <UBadge
                  v-if="grant.auto_approval_kind === 'yolo'"
                  color="warning"
                  variant="subtle"
                  size="xs"
                >
                  YOLO
                </UBadge>
                <UBadge
                  v-else-if="grant.auto_approval_kind === 'standing'"
                  color="info"
                  variant="subtle"
                  size="xs"
                >
                  Standing
                </UBadge>
              </p>
              <p class="text-xs text-dimmed">
                Created: {{ formatTime(grant.created_at) }}
              </p>
            </div>
          </UCard>
          <div v-if="historyHasMore" class="text-center pt-2">
            <UButton color="neutral" variant="soft" size="sm" :loading="loadingHistory" @click="loadMoreHistory">
              Load more
            </UButton>
          </div>
        </div>
      </section>
    </template>

    <UModal :open="!!revokeConfirmId" @close="cancelRevoke">
      <template #content>
        <div class="p-6 space-y-4">
          <h3 class="text-lg font-semibold">
            Revoke Permission?
          </h3>
          <p class="text-sm text-muted">
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
  </IdpPage>
</template>
