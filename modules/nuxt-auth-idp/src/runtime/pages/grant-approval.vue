<script setup>
import { computed, onMounted, ref } from 'vue'
import { navigateTo, useIdpAuth, useRoute } from '#imports'
import { formatCliResourceChain, formatWidenedPreview, getCliAuthorizationDetails, summarizeCliGrant } from '../utils/cli-grants'

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const route = useRoute()
const grant = ref(null)
const loading = ref(true)
const error = ref('')
const processing = ref(false)
const selectedExtendMode = ref('separate')
const grantId = computed(() => route.query.grant_id)
const callbackUrl = computed(() => route.query.callback)
const isDelegate = computed(() => grant.value?.request?.permissions?.includes('delegate'))
const hasSimilarGrants = computed(() => grant.value?.similar_grants?.similar_grants?.length > 0)
const similarGrants = computed(() => grant.value?.similar_grants?.similar_grants ?? [])
const widenedPreview = computed(() => formatWidenedPreview(grant.value?.similar_grants?.widened_details ?? []))
const mergedPreview = computed(() => formatWidenedPreview(grant.value?.similar_grants?.merged_details ?? []))
const wideningSuggestions = computed(() => grant.value?.widening_suggestions ?? [])
const hasWideningSuggestions = computed(() => wideningSuggestions.value.length > 0)
// One selected scope index per detail; defaults to 0 (exact) for conservative behavior.
const selectedWideningByIndex = ref({})
const EXTEND_MODE_OPTIONS = [
  { label: 'Extend to wildcard', value: 'widen', description: 'Widen scope with wildcards (replaces existing grant)' },
  { label: 'Add this value', value: 'merge', description: 'Merge into single grant keeping specific selectors' },
  { label: 'Approve as separate', value: 'separate', description: 'Create a new independent grant' },
]
const cliDetails = computed(() => getCliAuthorizationDetails(grant.value?.request?.authorization_details))
const cliSummary = computed(() => summarizeCliGrant(grant.value?.request?.authorization_details))
/**
 * True when this grant was requested via the `apes` generic-fallback path.
 * Such CLIs have no registered shape — the approver should see a prominent
 * banner explaining the lack of structured validation and the single-use
 * nature of the grant.
 */
const isGenericGrant = computed(() =>
  cliDetails.value.some(d => d?.operation_id === '_generic.exec'),
)
const delegateDuration = computed(() => {
  const req = grant.value?.request
  if (!req?.duration) return null
  const h = Math.floor(req.duration / 3600)
  const m = Math.floor(req.duration % 3600 / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
})
const selectedGrantType = ref('once')
const selectedDurationPreset = ref('3600')
const customDuration = ref(3600)
const DURATION_PRESETS = [
  { label: '1 hour', value: '3600' },
  { label: '4 hours', value: '14400' },
  { label: '1 day', value: '86400' },
  { label: '1 week', value: '604800' },
  { label: 'Custom', value: 'custom' },
]
const asRequestedOption = computed(() => {
  if (!grant.value?.request) return null
  const req = grant.value.request
  const type = req.grant_type || 'once'
  let desc = `${type}`
  if (type === 'timed' && req.duration) {
    const mins = Math.round(req.duration / 60)
    desc = mins >= 60 ? `timed (${Math.round(mins / 60)}h)` : `timed (${mins}m)`
  }
  return { label: 'As requested', value: 'as_requested', description: desc }
})
const grantTypeOptions = computed(() => {
  const base = [
    { label: 'Once', value: 'once', description: 'Single use only' },
    { label: 'Timed', value: 'timed', description: 'Time-limited' },
    { label: 'Always', value: 'always', description: 'Until revoked' },
  ]
  const asReq = asRequestedOption.value
  return asReq ? [asReq, ...base] : base
})
const effectiveDuration = computed(() => {
  if (selectedGrantType.value === 'as_requested') {
    return grant.value?.request?.duration
  }
  if (selectedGrantType.value !== 'timed') return void 0
  return selectedDurationPreset.value === 'custom' ? customDuration.value : Number(selectedDurationPreset.value)
})
onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    const returnTo = `/grant-approval?${new URLSearchParams(route.query).toString()}`
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
    // Initialize widening selection to exact (0) for every detail so the
    // conservative default is always preselected before the user acts.
    if (Array.isArray(grant.value?.widening_suggestions)) {
      const init = {}
      grant.value.widening_suggestions.forEach((_, idx) => {
        init[idx] = '0'
      })
      selectedWideningByIndex.value = init
    }
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
    const extendBody = hasSimilarGrants.value && selectedExtendMode.value !== 'separate'
      ? {
          extend_mode: selectedExtendMode.value,
          extend_grant_ids: similarGrants.value.map(s => s.grant.id),
        }
      : {}
    // Build widened_details only when the user actually chose a non-exact scope
    // and the similar-grants extend flow is NOT in play (mutually exclusive).
    let wideningBody = {}
    if (hasWideningSuggestions.value && !hasSimilarGrants.value) {
      const chosen = wideningSuggestions.value.map((suggestions, idx) => {
        const selectedIdx = Number(selectedWideningByIndex.value[idx] ?? '0')
        return suggestions[selectedIdx]?.detail
      }).filter(Boolean)
      const originalDetails = cliDetails.value
      const hasAnyNonExact = chosen.some((detail, idx) => {
        return detail.permission !== originalDetails[idx]?.permission
      })
      if (hasAnyNonExact) {
        wideningBody = { widened_details: chosen }
      }
    }
    const resolvedGrantType = selectedGrantType.value === 'as_requested'
      ? (grant.value?.request?.grant_type || 'once')
      : selectedGrantType.value
    const resolvedDuration = selectedGrantType.value === 'as_requested'
      ? grant.value?.request?.duration
      : effectiveDuration.value
    const result = await $fetch(
      `/api/grants/${grantId.value}/approve`,
      {
        method: 'POST',
        body: {
          grant_type: resolvedGrantType,
          ...resolvedGrantType === 'timed' && resolvedDuration ? { duration: resolvedDuration } : {},
          ...extendBody,
          ...wideningBody,
        },
      },
    )
    if (callbackUrl.value) {
      const url = new URL(callbackUrl.value)
      url.searchParams.set('grant_id', grantId.value)
      url.searchParams.set('authz_jwt', result.authz_jwt)
      url.searchParams.set('status', 'approved')
      await navigateTo(url.toString(), { external: true })
    }
    else {
      grant.value = result.grant
    }
  }
  catch (err) {
    const e = err
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
      grant.value = { ...grant.value ?? {}, status: 'denied' }
    }
  }
  catch (err) {
    const e = err
    error.value = e.data?.statusMessage ?? e.message ?? 'Denial failed'
  }
  finally {
    processing.value = false
  }
}
function isExactCommand(detail) {
  return detail.constraints?.exact_command === true
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
        <div v-if="grant.status === 'pending'" class="space-y-4">
          <UAlert
            v-if="isDelegate"
            color="error"
            title="Identity Delegation Request"
          >
            <template #description>
              <p class="font-semibold">
                {{ grant.request?.requester }} is requesting to act <strong>as you</strong> at {{ grant.request?.target_host }}.
              </p>
              <p v-if="delegateDuration" class="mt-1 text-sm">
                Duration: {{ delegateDuration }}
              </p>
              <p v-else-if="grant.request?.grant_type === 'once'" class="mt-1 text-sm">
                Single use only.
              </p>
              <p v-else-if="grant.request?.grant_type === 'always'" class="mt-1 text-sm">
                Permanent — until revoked.
              </p>
            </template>
          </UAlert>

          <UAlert
            v-if="isGenericGrant"
            color="error"
            icon="i-lucide-alert-triangle"
            title="⚠ Unshaped CLI"
            class="mb-4"
          >
            <template #description>
              This command has no registered shape. Approving grants
              <strong>single-use</strong> access to execute the exact command shown below.
              No structured validation is possible — review carefully.
            </template>
          </UAlert>

          <UAlert :color="isDelegate ? 'error' : 'warning'" title="An application is requesting permission:">
            <template #description>
              <dl class="text-sm space-y-2 mt-2">
                <div>
                  <dt class="text-muted">
                    Requester
                  </dt>
                  <dd class="font-mono text-sm break-all">
                    {{ grant.request?.requester }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">
                    Target
                  </dt>
                  <dd class="font-mono text-sm">
                    {{ grant.request?.target_host }}
                  </dd>
                </div>
                <div v-if="cliSummary">
                  <dt class="text-muted">
                    Request
                  </dt>
                  <dd class="text-sm">
                    {{ cliSummary }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">
                    Type
                  </dt>
                  <dd class="font-mono text-sm">
                    {{ grant.request?.grant_type }}
                  </dd>
                </div>
                <div v-if="grant.request?.run_as">
                  <dt class="text-muted">
                    Run as
                  </dt>
                  <dd class="font-mono text-sm">
                    {{ grant.request.run_as }}
                  </dd>
                </div>
                <div v-if="grant.request?.command?.length">
                  <dt class="text-muted mb-1">
                    Command
                  </dt>
                  <dd
                    class="font-mono text-sm rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap break-words"
                    style="background-color: #0b1220; color: #4ade80;"
                  >
                    {{ grant.request.command.join(" ") }}
                  </dd>
                </div>
                <div v-if="grant.request?.cmd_hash">
                  <dt class="text-muted">
                    Hash
                  </dt>
                  <dd class="font-mono text-xs text-dimmed break-all">
                    {{ grant.request.cmd_hash }}
                  </dd>
                </div>
                <div v-if="grant.request?.reason">
                  <dt class="text-muted">
                    Reason
                  </dt>
                  <dd>{{ grant.request?.reason }}</dd>
                </div>
                <div v-if="grant.request?.permissions?.length">
                  <dt class="text-muted">
                    Permissions
                  </dt>
                  <dd class="font-mono text-sm">
                    {{ grant.request?.permissions?.join(", ") }}
                  </dd>
                </div>
                <div v-if="cliDetails.length" class="space-y-2">
                  <dt class="text-muted">
                    Structured Permissions
                  </dt>
                  <dd class="space-y-2">
                    <div
                      v-for="detail in cliDetails"
                      :key="`${detail.cli_id}:${detail.operation_id}:${detail.permission}`"
                      class="rounded border border-gray-700 bg-gray-950/50 px-3 py-2"
                    >
                      <div class="flex flex-wrap items-center gap-2 mb-1">
                        <UBadge color="primary" variant="soft" :label="detail.cli_id" />
                        <UBadge color="neutral" variant="soft" :label="detail.action" />
                        <UBadge color="secondary" variant="soft" :label="detail.risk" />
                        <UBadge :color="isExactCommand(detail) ? 'warning' : 'success'" variant="soft" :label="isExactCommand(detail) ? 'exact-only' : 'reusable'" />
                      </div>
                      <p class="text-sm">
                        {{ detail.display }}
                      </p>
                      <p class="font-mono text-xs text-dimmed break-all">
                        {{ detail.permission }}
                      </p>
                      <p class="font-mono text-xs text-dimmed">
                        {{ formatCliResourceChain(detail) }}
                      </p>
                    </div>
                  </dd>
                </div>
              </dl>
            </template>
          </UAlert>

          <div
            v-if="hasWideningSuggestions && !hasSimilarGrants"
            class="rounded-lg border border-default p-4 space-y-3"
          >
            <div>
              <h3 class="text-sm font-semibold">
                Approve scope
              </h3>
              <p class="text-xs text-muted mt-1">
                Choose how broad this grant should be. Conservative default is exact.
              </p>
            </div>
            <div v-for="(suggestions, detailIdx) in wideningSuggestions" :key="detailIdx" class="space-y-2">
              <p v-if="cliDetails[detailIdx]" class="text-xs text-muted">
                For: <span class="font-mono break-all">{{ cliDetails[detailIdx].display }}</span>
              </p>
              <URadioGroup
                v-model="selectedWideningByIndex[detailIdx]"
                :items="suggestions.map((s, i) => ({
                  label: s.label,
                  value: String(i),
                  description: s.permission,
                }))"
                :ui="{ description: 'font-mono text-xs break-all' }"
              />
            </div>
          </div>

          <UAlert
            v-if="hasSimilarGrants"
            color="info"
            title="Similar grant(s) exist"
          >
            <template #description>
              <div class="text-sm space-y-2 mt-2">
                <div v-for="similar in similarGrants" :key="similar.grant.id">
                  <p class="text-muted">
                    Existing grant: <span class="font-mono text-xs">{{ similar.grant.id.slice(0, 8) }}...</span>
                  </p>
                  <div
                    v-for="detail in getCliAuthorizationDetails(similar.grant.request.authorization_details)"
                    :key="detail.permission"
                    class="font-mono text-xs text-dimmed break-all"
                  >
                    {{ detail.permission }}
                  </div>
                </div>
                <div class="mt-2 space-y-1">
                  <p class="text-muted font-medium">
                    Extension options:
                  </p>
                  <URadioGroup
                    v-model="selectedExtendMode"
                    :items="EXTEND_MODE_OPTIONS"
                  />
                  <div v-if="selectedExtendMode === 'widen'" class="mt-1 rounded bg-gray-950/50 px-2 py-1">
                    <p class="text-xs text-muted">
                      Result:
                    </p>
                    <p v-for="perm in widenedPreview" :key="perm" class="font-mono text-xs text-green-400">
                      {{ perm }}
                    </p>
                  </div>
                  <div v-if="selectedExtendMode === 'merge'" class="mt-1 rounded bg-gray-950/50 px-2 py-1">
                    <p class="text-xs text-muted">
                      Result:
                    </p>
                    <p v-for="perm in mergedPreview" :key="perm" class="font-mono text-xs text-blue-400">
                      {{ perm }}
                    </p>
                  </div>
                </div>
              </div>
            </template>
          </UAlert>

          <div class="space-y-3">
            <div>
              <label class="text-sm font-medium text-muted block mb-2">Approval Type</label>
              <p v-if="grant.request?.grant_type" class="text-xs text-dimmed mb-2">
                Requested: {{ grant.request.grant_type }}
              </p>
              <URadioGroup
                v-model="selectedGrantType"
                :items="grantTypeOptions"
              />
            </div>
            <div v-if="selectedGrantType === 'timed'" class="space-y-2">
              <label class="text-sm font-medium text-muted block">Duration</label>
              <USelect
                v-model="selectedDurationPreset"
                :items="DURATION_PRESETS"
              />
              <UInput
                v-if="selectedDurationPreset === 'custom'"
                v-model.number="customDuration"
                type="number"
                :min="60"
                placeholder="Duration in seconds"
              />
            </div>
          </div>

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
            :color="grant.status === 'approved' ? 'success' : grant.status === 'denied' ? 'error' : 'neutral'"
            :title="`Grant ${grant.status}`"
          >
            <template #description>
              <dl class="text-sm space-y-2 mt-2">
                <div>
                  <dt class="text-muted">
                    Requester
                  </dt>
                  <dd class="font-mono text-sm break-all">
                    {{ grant.request?.requester }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">
                    Target
                  </dt>
                  <dd class="font-mono text-sm">
                    {{ grant.request?.target }}
                  </dd>
                </div>
                <div v-if="grant.request?.run_as">
                  <dt class="text-muted">
                    Run as
                  </dt>
                  <dd class="font-mono text-sm">
                    {{ grant.request.run_as }}
                  </dd>
                </div>
                <div v-if="grant.request?.command?.length">
                  <dt class="text-muted">
                    Command
                  </dt>
                  <dd
                    class="font-mono text-sm rounded px-3 py-2 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words"
                    style="background-color: #0b1220; color: #4ade80;"
                  >
                    {{ grant.request.command.join(" ") }}
                  </dd>
                </div>
                <div v-if="grant.request?.reason">
                  <dt class="text-muted">
                    Reason
                  </dt>
                  <dd>{{ grant.request?.reason }}</dd>
                </div>
                <div v-if="grant.decided_by">
                  <dt class="text-muted">
                    Decided by
                  </dt>
                  <dd>{{ grant.decided_by }}</dd>
                </div>
              </dl>
            </template>
          </UAlert>

          <div class="flex gap-3">
            <UButton to="/grants" variant="soft" color="primary" block class="flex-1">
              All grants
            </UButton>
            <UButton to="/" variant="soft" color="neutral" block class="flex-1">
              Home
            </UButton>
          </div>
        </div>
      </template>
    </UCard>
  </div>
</template>
