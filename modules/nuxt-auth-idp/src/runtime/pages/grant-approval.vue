<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { navigateTo, useIdpAuth, useRoute } from '#imports'
import type { ApprovalGrant, GrantDecisionResult } from '../utils/grant-decision'
import { grantDecisionError } from '../utils/grant-decision'
import { callerState, formatCountdown, formatWaited } from '../utils/caller-liveness'
import GrantBatchDecision from '../components/GrantBatchDecision.vue'
import GrantCard from '../components/GrantCard.vue'
import GrantDecisionForm from '../components/GrantDecisionForm.vue'

type ApprovalPageGrant = ApprovalGrant & { pending_diagnostics?: { source: string, summary: string, detail?: { unmatchedSegments?: string[], deniedSegment?: string, substitutionSegments?: string[] } }[] }
const { user, loading: authLoading, fetchUser } = useIdpAuth()
const route = useRoute()
const grant = ref<ApprovalPageGrant | null>(null)
const loading = ref(true)
const error = ref('')
const german = ref(false)
const grantId = computed(() => typeof route.query.grant_id === 'string' ? route.query.grant_id : '')
const batchQuery = computed(() => typeof route.query.batch === 'string' && typeof route.query.requester === 'string' && !grantId.value ? { requester: route.query.requester, batchId: route.query.batch } : null)
const nowSec = ref(Math.floor(Date.now() / 1000))
const liveness = computed(() => callerState(grant.value?.request, grant.value?.created_at ?? 0, nowSec.value))
let clock: ReturnType<typeof setInterval> | undefined
let loadGeneration = 0

async function loadGrant() {
  if (!grantId.value) return
  const requestedId = grantId.value
  const generation = ++loadGeneration
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<ApprovalPageGrant>(`/api/grants/${requestedId}`)
    if (grantId.value === requestedId && generation === loadGeneration) grant.value = response
  }
  catch (failure) { if (grantId.value === requestedId && generation === loadGeneration) error.value = grantDecisionError(failure) }
  finally { if (grantId.value === requestedId && generation === loadGeneration) loading.value = false }
}

async function decided(result: GrantDecisionResult) {
  if (result.grant.id !== grantId.value) return
  loadGeneration++
  loading.value = false
  grant.value = { ...grant.value, ...result.grant }
  if (typeof route.query.callback !== 'string') return
  try {
    const url = new URL(route.query.callback)
    url.searchParams.set('grant_id', result.grant.id)
    url.searchParams.set('status', result.grant.status)
    if (result.authz_jwt) url.searchParams.set('authz_jwt', result.authz_jwt)
    await navigateTo(url.toString(), { external: true })
  }
  catch (failure) { error.value = grantDecisionError(failure) }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible' && user.value && grantId.value) void loadGrant()
}
watch(grantId, async (next, previous) => {
  if (next && next !== previous && user.value) { grant.value = null; await loadGrant() }
})
onMounted(async () => {
  german.value = navigator.language.startsWith('de')
  clock = setInterval(() => { nowSec.value = Math.floor(Date.now() / 1000) }, 1000)
  await fetchUser()
  if (!user.value) {
    const returnTo = `/grant-approval?${new URLSearchParams(route.query as Record<string, string>).toString()}`
    await navigateTo(`/login?returnTo=${encodeURIComponent(returnTo)}`)
    return
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  if (batchQuery.value) return
  if (!grantId.value) { error.value = 'Missing grant_id parameter'; loading.value = false; return }
  await loadGrant()
})
onUnmounted(() => { clearInterval(clock); document.removeEventListener('visibilitychange', onVisibilityChange) })
</script>

<template>
  <GrantBatchDecision v-if="batchQuery && user" :key="`${batchQuery.requester}:${batchQuery.batchId}`" :requester="batchQuery.requester" :batch-id="batchQuery.batchId" />
  <div v-else-if="batchQuery" class="min-h-screen flex items-center justify-center p-4 text-muted">
    Loading...
  </div>
  <div v-else class="min-h-screen flex items-start sm:items-center justify-center p-4">
    <div class="w-full max-w-xl space-y-4">
      <h1 class="text-2xl font-bold">
        {{ german ? 'Freigabe' : 'Permission request' }}
      </h1>
      <p v-if="(loading && !grant) || authLoading" class="text-muted">
        Loading...
      </p>
      <UAlert v-if="error" color="error" :title="error" />
      <template v-if="grant && !authLoading">
        <UAlert v-if="grant.status !== 'pending'" :color="grant.status === 'approved' ? 'success' : grant.status === 'denied' ? 'error' : 'neutral'" :title="`Grant ${grant.status}`">
          <template v-if="grant.decided_by" #description>
            {{ german ? 'Entschieden von' : 'Decided by' }} {{ grant.decided_by }}
          </template>
        </UAlert>
        <GrantCard :grant="grant" :german="german" :show-validity="grant.status !== 'pending'" :technical="grant.status !== 'pending'" @language="german = $event">
          <template v-if="grant.status === 'pending'">
            <p v-if="grant.request.permissions?.includes('delegate')" class="rounded border border-warning p-3 text-sm">
              {{ german ? 'Identitätsdelegation: Der Antragsteller möchte in deinem Namen handeln.' : 'Identity delegation: the requester wants to act as you.' }}
            </p>
            <p v-if="grant.brokered" class="text-xs text-muted break-words">
              {{ german ? 'Angefragt über' : 'Requested via' }} {{ grant.brokered.agent_issuer }} · {{ german ? 'Entscheidendes Konto' : 'Decision account' }}: {{ grant.brokered.owner }}
            </p>
            <p v-if="liveness.kind === 'waiting'" class="text-xs text-success">
              {{ german ? 'Der Prozess wartet noch' : 'The process is still waiting' }} — {{ formatCountdown(liveness.secondsLeft) }}
            </p>
            <p v-else-if="liveness.kind === 'abandoned'" class="text-xs text-warning">
              {{ german ? 'Aufgegeben — niemand wartet mehr' : 'The requester has stopped waiting' }} · {{ formatWaited(liveness.waitedSeconds) }}
            </p>
            <GrantDecisionForm :key="grant.id" :grant="grant" :german="german" :can-approve="liveness.kind !== 'abandoned'" @decided="decided" />
          </template>
        </GrantCard>
        <details v-if="grant.pending_diagnostics?.length && grant.status === 'pending'" class="rounded-lg border border-default p-4">
          <summary class="cursor-pointer text-sm">
            {{ german ? 'Warum die Anfrage wartet' : 'Why this is waiting' }}
          </summary>
          <div v-for="diagnostic in grant.pending_diagnostics" :key="diagnostic.source" class="mt-3 text-xs space-y-1">
            <p>{{ diagnostic.source }}: {{ diagnostic.summary }}</p>
            <p v-for="segment in diagnostic.detail?.unmatchedSegments" :key="segment" class="font-mono break-all">
              {{ segment }}
            </p>
            <p v-if="diagnostic.detail?.deniedSegment" class="font-mono break-all">
              {{ diagnostic.detail.deniedSegment }}
            </p>
            <p v-if="diagnostic.detail?.substitutionSegments?.length">
              {{ german ? 'Enthält Befehlssubstitution; ein Muster muss das Konstrukt ausdrücklich benennen.' : 'Contains command substitution; a pattern must spell the construct out.' }}
            </p>
          </div>
        </details>
        <div v-if="grant.status !== 'pending'" class="flex gap-3">
          <UButton to="/grants" variant="soft">
            {{ german ? 'Alle Freigaben' : 'All grants' }}
          </UButton><UButton to="/" variant="soft" color="neutral">
            Home
          </UButton>
        </div>
      </template>
    </div>
  </div>
</template>
