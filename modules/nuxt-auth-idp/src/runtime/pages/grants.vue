<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { navigateTo, useHead, useIdpAuth } from '#imports'
import type { PaginatedResponse } from '@openape/core'
import type { ApprovalGrant } from '../utils/grant-decision'
import { grantDecisionError } from '../utils/grant-decision'
import { callerState, formatCountdown, formatWaited } from '../utils/caller-liveness'
import { getCliAuthorizationDetails } from '../utils/cli-grants'
import { grantBatchPath, groupPendingGrantBatches } from '../utils/grant-batch'
import { standingRulePreview } from '../utils/rule-suggestions'
import GrantCard from '../components/GrantCard.vue'
import GrantRequestDate from '../components/GrantRequestDate.vue'
import GrantDecisionForm from '../components/GrantDecisionForm.vue'
import GrantIdentity from '../components/GrantIdentity.vue'

useHead({ title: 'Grants' })
const { user, loading: authLoading, fetchUser } = useIdpAuth()
const activeAndPending = ref<ApprovalGrant[]>([])
const historyGrants = ref<ApprovalGrant[]>([])
const historyCursor = ref<string | null>(null)
const historyHasMore = ref(false)
const loadingHistory = ref(false)
const loading = ref(true)
const actionError = ref('')
const revokeConfirmId = ref<string | null>(null)
const german = ref(false)
const detailsCache = new Map<string, Pick<ApprovalGrant, 'similar_grants' | 'widening_suggestions'>>()
const pendingGrants = computed(() => activeAndPending.value.filter(grant => grant.status === 'pending'))
const pendingGroups = computed(() => groupPendingGrantBatches(pendingGrants.value))
const activeGrants = computed(() => activeAndPending.value.filter(grant => grant.status === 'approved'))
const nowSec = ref(Math.floor(Date.now() / 1000))
let clock: ReturnType<typeof setInterval> | undefined
let loadGeneration = 0
const liveness = (grant: ApprovalGrant) => callerState(grant.request, grant.created_at, nowSec.value)
function livenessText(grant: ApprovalGrant) {
  const state = liveness(grant)
  if (state.kind === 'waiting') return `${german.value ? 'Der Prozess wartet noch' : 'The process is still waiting'} — ${formatCountdown(state.secondsLeft)}`
  if (state.kind === 'abandoned') return `${german.value ? 'Aufgegeben — niemand wartet mehr' : 'The requester has stopped waiting'} · ${formatWaited(state.waitedSeconds)}`
  return ''
}

async function loadGrants() {
  const generation = ++loadGeneration
  loading.value = true
  try {
    const [active, history] = await Promise.all([
      $fetch<PaginatedResponse<ApprovalGrant>>('/api/grants?section=active'),
      $fetch<PaginatedResponse<ApprovalGrant>>('/api/grants?section=history'),
    ])
    if (generation !== loadGeneration) return
    activeAndPending.value = active.data.map(grant => ({ ...grant, ...grant.status === 'pending' ? detailsCache.get(grant.id) : {} }))
    historyGrants.value = history.data
    historyCursor.value = history.pagination?.cursor ?? null
    historyHasMore.value = history.pagination?.has_more ?? false
    await Promise.all(active.data.filter(grant => grant.status === 'pending' && getCliAuthorizationDetails(grant.request.authorization_details).length && !detailsCache.has(grant.id)).map(async (grant) => {
      try {
        const detail = await $fetch<ApprovalGrant>(`/api/grants/${grant.id}`)
        if (generation !== loadGeneration) return
        const suggestions = { similar_grants: detail.similar_grants, widening_suggestions: detail.widening_suggestions }
        detailsCache.set(grant.id, suggestions)
        const at = activeAndPending.value.findIndex(item => item.id === grant.id)
        const current = activeAndPending.value[at]
        if (current?.status === 'pending') activeAndPending.value[at] = { ...current, ...suggestions }
      }
      catch (failure) { if (generation === loadGeneration) actionError.value = grantDecisionError(failure) }
    }))
  }
  catch (failure) { if (generation === loadGeneration) actionError.value = grantDecisionError(failure) }
  finally { if (generation === loadGeneration) loading.value = false }
}
async function loadMoreHistory() {
  if (!historyCursor.value || loadingHistory.value) return
  loadingHistory.value = true
  try {
    const page = await $fetch<PaginatedResponse<ApprovalGrant>>(`/api/grants?section=history&cursor=${historyCursor.value}`)
    historyGrants.value.push(...page.data)
    historyCursor.value = page.pagination?.cursor ?? null
    historyHasMore.value = page.pagination?.has_more ?? false
  }
  catch (failure) { actionError.value = grantDecisionError(failure) }
  finally { loadingHistory.value = false }
}
async function confirmRevoke() {
  const id = revokeConfirmId.value
  revokeConfirmId.value = null
  if (!id) return
  actionError.value = ''
  try { await $fetch(`/api/grants/${id}/revoke`, { method: 'POST' }); await loadGrants() }
  catch (failure) { actionError.value = grantDecisionError(failure) }
}
function onVisibilityChange() { if (document.visibilityState === 'visible' && user.value) void loadGrants() }
onMounted(async () => {
  german.value = navigator.language.startsWith('de')
  clock = setInterval(() => { nowSec.value = Math.floor(Date.now() / 1000) }, 1000)
  await fetchUser()
  if (!user.value) { await navigateTo('/login'); return }
  document.addEventListener('visibilitychange', onVisibilityChange)
  await loadGrants()
})
onUnmounted(() => { clearInterval(clock); document.removeEventListener('visibilitychange', onVisibilityChange) })
</script>

<template>
  <IdpPage :title="german ? 'Freigaben' : 'Grants'" :subtitle="user?.email" back-to="/account" :back-label="german ? 'Konto' : 'Account'">
    <UAlert v-if="actionError" color="error" :title="actionError" class="mb-4" />
    <p v-if="(loading && !activeAndPending.length && !historyGrants.length) || authLoading" class="text-muted">
      Loading...
    </p>
    <div v-if="!authLoading" class="space-y-8">
      <section>
        <h2 class="mb-3 text-lg font-semibold">
          {{ german ? 'Offene Anfragen' : 'Pending requests' }} ({{ pendingGroups.singles.length + pendingGroups.batches.length }})
        </h2>
        <p v-if="!pendingGrants.length" class="text-sm text-muted">
          {{ german ? 'Keine offenen Anfragen.' : 'No pending requests.' }}
        </p>
        <div class="space-y-4">
          <UCard v-for="batch in pendingGroups.batches" :key="`${batch.requester}:${batch.batchId}`" data-pending-batch>
            <div class="min-w-0 space-y-3">
              <p class="text-xs text-muted">
                {{ german ? 'Beschreibung vom Antragsteller' : 'Description from the requester' }}
              </p>
              <h3 class="text-xl font-semibold break-words">
                {{ batch.title || (german ? 'Sammelfreigabe' : 'Batch approval') }}
              </h3>
              <p v-if="batch.description" class="text-sm whitespace-pre-wrap break-words">
                {{ batch.description }}
              </p>
              <GrantIdentity :grant="batch.grant" :german="german" />
              <GrantRequestDate :created-at="batch.oldestAt" :latest-at="batch.createdAt" :german="german" />
              <p class="text-xs text-muted">
                {{ batch.size ? `${batch.count} / ${batch.size}` : batch.count }} {{ german ? 'Anfragen · Einmalig' : 'requests · Single use' }}
              </p>
              <UButton :to="grantBatchPath(batch.requester, batch.batchId)">
                {{ german ? 'Sammelanfrage prüfen' : 'Review batch' }}
              </UButton>
            </div>
          </UCard>
          <GrantCard v-for="grant in pendingGroups.singles" :key="grant.id" :grant="grant" :german="german" :show-validity="false" :technical="false" @language="german = $event">
            <p v-if="livenessText(grant)" class="text-xs" :class="liveness(grant).kind === 'waiting' ? 'text-success' : 'text-warning'">
              {{ livenessText(grant) }}
            </p>
            <GrantDecisionForm :grant="grant" :german="german" :can-approve="liveness(grant).kind !== 'abandoned'" @decided="loadGrants" />
          </GrantCard>
        </div>
      </section>
      <section>
        <h2 class="mb-3 text-lg font-semibold">
          {{ german ? 'Aktive Berechtigungen' : 'Active Permissions' }} ({{ activeGrants.length }})
        </h2>
        <p v-if="!activeGrants.length" class="text-sm text-muted">
          {{ german ? 'Keine aktiven Berechtigungen.' : 'No active permissions.' }}
        </p>
        <div class="space-y-4">
          <GrantCard v-for="grant in activeGrants" :key="grant.id" :grant="grant" :german="german" :language-switch="false">
            <p v-if="standingRulePreview(grant.request)" class="text-sm break-all">
              {{ german ? 'Regel' : 'Rule' }}: {{ standingRulePreview(grant.request) }}
            </p>
            <p v-if="grant.decided_by" class="text-xs text-muted">
              {{ german ? 'Freigegeben von' : 'Approved by' }}: {{ grant.decided_by }} <UBadge v-if="grant.auto_approval_kind" color="neutral" :label="grant.auto_approval_kind" />
            </p>
            <UButton color="neutral" variant="outline" @click="revokeConfirmId = grant.id">
              {{ german ? 'Widerrufen' : 'Revoke' }}
            </UButton>
          </GrantCard>
        </div>
      </section>
      <section>
        <h2 class="mb-3 text-lg font-semibold">
          {{ german ? 'Verlauf' : 'History' }} ({{ historyGrants.length }})
        </h2>
        <p v-if="!historyGrants.length" class="text-sm text-muted">
          {{ german ? 'Kein aktueller Verlauf.' : 'No recent history.' }}
        </p>
        <div class="space-y-4">
          <GrantCard v-for="grant in historyGrants" :key="grant.id" :grant="grant" :german="german" :language-switch="false">
            <p class="text-xs text-muted">
              {{ grant.status }}<span v-if="grant.decided_by"> · {{ grant.decided_by }}</span>
            </p>
          </GrantCard>
          <UButton v-if="historyHasMore" color="neutral" variant="outline" :loading="loadingHistory" @click="loadMoreHistory">
            {{ german ? 'Mehr laden' : 'Load more' }}
          </UButton>
        </div>
      </section>
    </div>
    <UModal :open="!!revokeConfirmId" @update:open="!$event && (revokeConfirmId = null)">
      <template #content>
        <div class="space-y-4 p-5">
          <h2 class="text-lg font-semibold">
            {{ german ? 'Freigabe widerrufen?' : 'Revoke grant?' }}
          </h2><p class="text-sm">
            {{ german ? 'Der Antragsteller kann diese Berechtigung anschließend nicht mehr verwenden.' : 'The requester will no longer be able to use this permission.' }}
          </p><div class="flex gap-3">
            <UButton color="error" @click="confirmRevoke">
              {{ german ? 'Widerrufen' : 'Revoke' }}
            </UButton><UButton color="neutral" variant="outline" @click="revokeConfirmId = null">
              {{ german ? 'Abbrechen' : 'Cancel' }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </IdpPage>
</template>
