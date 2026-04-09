<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useIdpAuth } from '../composables/useIdpAuth'
import { formatCliResourceChain, getCliAuthorizationDetails, summarizeCliGrant } from '../utils/cli-grants'

const props = defineProps<{
  grantId: string
}>()

const emit = defineEmits<{
  done: [result: { status: string, authzJwt?: string }]
}>()

const { user, loading: authLoading, fetchUser } = useIdpAuth()

const grant = ref<any>(null)
const loading = ref(true)
const error = ref('')
const processing = ref(false)

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

const isDelegate = computed(() => grant.value?.request?.permissions?.includes('delegate'))
const cliDetails = computed(() => getCliAuthorizationDetails(grant.value?.request?.authorization_details))
const cliSummary = computed(() => summarizeCliGrant(grant.value?.request?.authorization_details))

const delegateDuration = computed(() => {
  const req = grant.value?.request
  if (!req?.duration) return null
  const h = Math.floor(req.duration / 3600)
  const m = Math.floor(req.duration % 3600 / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
})

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
  if (selectedGrantType.value === 'as_requested')
    return grant.value?.request?.duration
  if (selectedGrantType.value !== 'timed')
    return undefined
  return selectedDurationPreset.value === 'custom' ? customDuration.value : Number(selectedDurationPreset.value)
})

// Similar grants
const hasSimilarGrants = computed(() => grant.value?.similar_grants?.similar_grants?.length > 0)
const similarGrants = computed(() => grant.value?.similar_grants?.similar_grants ?? [])
const selectedExtendMode = ref('separate')

const EXTEND_MODE_OPTIONS = [
  { label: 'Extend to wildcard', value: 'widen', description: 'Widen scope with wildcards (replaces existing grant)' },
  { label: 'Add this value', value: 'merge', description: 'Merge into single grant keeping specific selectors' },
  { label: 'Approve as separate', value: 'separate', description: 'Create a new independent grant' },
]

// Widening suggestions (server-provided proactive scope suggestions on the first approve)
const wideningSuggestions = computed<any[][]>(() => grant.value?.widening_suggestions ?? [])
const hasWideningSuggestions = computed(() => wideningSuggestions.value.length > 0)
const selectedWideningByIndex = ref<Record<number, string>>({})

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    error.value = 'Login required'
    loading.value = false
    return
  }
  if (!props.grantId) {
    error.value = 'Missing grant_id parameter'
    loading.value = false
    return
  }
  try {
    const res = await fetch(`/api/grants/${props.grantId}`, { credentials: 'include' })
    if (!res.ok) throw new Error('Grant not found')
    grant.value = await res.json()
    if (Array.isArray(grant.value?.widening_suggestions)) {
      const init: Record<number, string> = {}
      grant.value.widening_suggestions.forEach((_: any, idx: number) => {
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
          extend_grant_ids: similarGrants.value.map((s: any) => s.grant.id),
        }
      : {}
    // Build widened_details only when the user chose a non-exact scope and the
    // similar-grants extend flow is NOT in play (mutually exclusive on the server).
    let wideningBody: { widened_details?: any[] } = {}
    if (hasWideningSuggestions.value && !hasSimilarGrants.value) {
      const chosen = wideningSuggestions.value.map((suggestions, idx) => {
        const selectedIdx = Number(selectedWideningByIndex.value[idx] ?? '0')
        return suggestions[selectedIdx]?.detail
      }).filter(Boolean)
      const originalDetails = cliDetails.value
      const hasAnyNonExact = chosen.some((detail, idx) => {
        return detail.permission !== originalDetails[idx]?.permission
      })
      if (hasAnyNonExact)
        wideningBody = { widened_details: chosen }
    }
    const resolvedGrantType = selectedGrantType.value === 'as_requested'
      ? (grant.value?.request?.grant_type || 'once')
      : selectedGrantType.value
    const resolvedDuration = selectedGrantType.value === 'as_requested'
      ? grant.value?.request?.duration
      : effectiveDuration.value

    const res = await fetch(`/api/grants/${props.grantId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        grant_type: resolvedGrantType,
        ...resolvedGrantType === 'timed' && resolvedDuration ? { duration: resolvedDuration } : {},
        ...extendBody,
        ...wideningBody,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.title || 'Approval failed')
    }
    const result = await res.json()
    emit('done', { status: 'approved', authzJwt: result.authz_jwt })
    grant.value = result.grant
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Approval failed'
  }
  finally {
    processing.value = false
  }
}

async function handleDeny() {
  processing.value = true
  try {
    const res = await fetch(`/api/grants/${props.grantId}/deny`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) throw new Error('Denial failed')
    emit('done', { status: 'denied' })
    grant.value = { ...grant.value, status: 'denied' }
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Denial failed'
  }
  finally {
    processing.value = false
  }
}

function isExactCommand(detail: any) {
  return detail.constraints?.exact_command === true
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-center mb-6">
      Permission Request
    </h1>

    <div v-if="loading || authLoading" class="text-center text-gray-500">
      Loading...
    </div>

    <div
      v-else-if="error"
      class="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400"
    >
      {{ error }}
    </div>

    <template v-else-if="grant">
      <!-- Pending grant -->
      <div v-if="grant.status === 'pending'" class="space-y-4">
        <!-- Delegation warning -->
        <div
          v-if="isDelegate"
          class="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4"
        >
          <h3 class="font-bold text-red-700 dark:text-red-400 mb-1">
            Identity Delegation Request
          </h3>
          <p class="font-semibold text-sm text-red-600 dark:text-red-300">
            {{ grant.request?.requester }} is requesting to act <strong>as you</strong> at {{ grant.request?.target_host }}.
          </p>
          <p v-if="delegateDuration" class="mt-1 text-sm text-red-500 dark:text-red-400">
            Duration: {{ delegateDuration }}
          </p>
          <p v-else-if="grant.request?.grant_type === 'once'" class="mt-1 text-sm text-red-500 dark:text-red-400">
            Single use only.
          </p>
          <p v-else-if="grant.request?.grant_type === 'always'" class="mt-1 text-sm text-red-500 dark:text-red-400">
            Permanent - until revoked.
          </p>
        </div>

        <!-- Request details -->
        <div
          :class="[
            'rounded-md border p-4',
            isDelegate
              ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
              : 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800',
          ]"
        >
          <h3 class="font-semibold text-sm mb-2">
            An application is requesting permission:
          </h3>
          <dl class="text-sm space-y-2">
            <div>
              <dt class="text-gray-500">
                Requester
              </dt>
              <dd class="font-mono text-sm break-all">
                {{ grant.request?.requester }}
              </dd>
            </div>
            <div>
              <dt class="text-gray-500">
                Target
              </dt>
              <dd class="font-mono text-sm">
                {{ grant.request?.target_host }}
              </dd>
            </div>
            <div v-if="cliSummary">
              <dt class="text-gray-500">
                Request
              </dt>
              <dd class="text-sm">
                {{ cliSummary }}
              </dd>
            </div>
            <div>
              <dt class="text-gray-500">
                Type
              </dt>
              <dd class="font-mono text-sm">
                {{ grant.request?.grant_type }}
              </dd>
            </div>
            <div v-if="grant.request?.run_as">
              <dt class="text-gray-500">
                Run as
              </dt>
              <dd class="font-mono text-sm">
                {{ grant.request.run_as }}
              </dd>
            </div>
            <div v-if="grant.request?.command?.length">
              <dt class="text-gray-500 mb-1">
                Command
              </dt>
              <dd class="font-mono text-xs bg-gray-900 text-green-400 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-words">
                {{ grant.request.command.join(" ") }}
              </dd>
            </div>
            <div v-if="grant.request?.cmd_hash">
              <dt class="text-gray-500">
                Hash
              </dt>
              <dd class="font-mono text-xs text-gray-400 break-all">
                {{ grant.request.cmd_hash }}
              </dd>
            </div>
            <div v-if="grant.request?.reason">
              <dt class="text-gray-500">
                Reason
              </dt>
              <dd>{{ grant.request?.reason }}</dd>
            </div>
            <div v-if="grant.request?.permissions?.length">
              <dt class="text-gray-500">
                Permissions
              </dt>
              <dd class="font-mono text-sm">
                {{ grant.request?.permissions?.join(", ") }}
              </dd>
            </div>
            <div v-if="cliDetails.length" class="space-y-2">
              <dt class="text-gray-500">
                Structured Permissions
              </dt>
              <dd class="space-y-2">
                <div
                  v-for="detail in cliDetails"
                  :key="`${detail.cli_id}:${detail.operation_id}:${detail.permission}`"
                  class="rounded border border-gray-700 bg-gray-950/50 px-3 py-2"
                >
                  <div class="flex flex-wrap items-center gap-2 mb-1">
                    <span class="inline-flex items-center rounded-md bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">{{ detail.cli_id }}</span>
                    <span class="inline-flex items-center rounded-md bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">{{ detail.action }}</span>
                    <span class="inline-flex items-center rounded-md bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300">{{ detail.risk }}</span>
                    <span
                      :class="[
                        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                        isExactCommand(detail)
                          ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
                          : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
                      ]"
                    >{{ isExactCommand(detail) ? 'exact-only' : 'reusable' }}</span>
                  </div>
                  <p class="text-sm">
                    {{ detail.display }}
                  </p>
                  <p class="font-mono text-xs text-gray-400 break-all">
                    {{ detail.permission }}
                  </p>
                  <p class="font-mono text-xs text-gray-400">
                    {{ formatCliResourceChain(detail) }}
                  </p>
                </div>
              </dd>
            </div>
          </dl>
        </div>

        <!-- Widening suggestions (only when no similar grants exist) -->
        <div
          v-if="hasWideningSuggestions && !hasSimilarGrants"
          class="rounded-md bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800 p-4"
        >
          <h3 class="font-semibold text-sm text-indigo-700 dark:text-indigo-300 mb-2">
            Approve scope
          </h3>
          <p class="text-xs text-gray-500 mb-3">
            Choose how broad this grant should be. Conservative default is exact.
          </p>
          <div v-for="(suggestions, detailIdx) in wideningSuggestions" :key="detailIdx" class="space-y-2 mb-3">
            <p v-if="cliDetails[detailIdx]" class="text-xs text-gray-500">
              For: <span class="font-mono text-xs break-all">{{ cliDetails[detailIdx].display }}</span>
            </p>
            <div v-for="(s, i) in suggestions" :key="i" class="flex items-start gap-2">
              <input
                :id="`widen-${detailIdx}-${i}`"
                v-model="selectedWideningByIndex[detailIdx]"
                type="radio"
                :value="String(i)"
                class="mt-1"
              >
              <label :for="`widen-${detailIdx}-${i}`" class="text-sm">
                <span class="font-medium">{{ s.label }}</span>
                <span class="block font-mono text-xs text-gray-500 break-all">{{ s.permission }}</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Similar grants -->
        <div
          v-if="hasSimilarGrants"
          class="rounded-md bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 p-4"
        >
          <h3 class="font-semibold text-sm text-blue-700 dark:text-blue-300 mb-2">
            Similar grant(s) exist
          </h3>
          <div class="text-sm space-y-2">
            <div v-for="similar in similarGrants" :key="similar.grant.id">
              <p class="text-gray-500">
                Existing grant: <span class="font-mono text-xs">{{ similar.grant.id.slice(0, 8) }}...</span>
              </p>
              <div
                v-for="detail in getCliAuthorizationDetails(similar.grant.request.authorization_details)"
                :key="detail.permission"
                class="font-mono text-xs text-gray-400 break-all"
              >
                {{ detail.permission }}
              </div>
            </div>
            <div class="mt-2 space-y-2">
              <p class="text-gray-500 font-medium">
                Extension options:
              </p>
              <div v-for="opt in EXTEND_MODE_OPTIONS" :key="opt.value" class="flex items-start gap-2">
                <input
                  :id="`extend-${opt.value}`"
                  v-model="selectedExtendMode"
                  type="radio"
                  :value="opt.value"
                  class="mt-1"
                >
                <label :for="`extend-${opt.value}`" class="text-sm">
                  <span class="font-medium">{{ opt.label }}</span>
                  <span class="text-gray-500 ml-1">{{ opt.description }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Grant type selection -->
        <div class="space-y-3">
          <div>
            <label class="text-sm font-medium text-gray-500 block mb-2">Approval Type</label>
            <p v-if="grant.request?.grant_type" class="text-xs text-gray-400 mb-2">
              Requested: {{ grant.request.grant_type }}
            </p>
            <div class="space-y-2">
              <div v-for="opt in grantTypeOptions" :key="opt.value" class="flex items-start gap-2">
                <input
                  :id="`grant-type-${opt.value}`"
                  v-model="selectedGrantType"
                  type="radio"
                  :value="opt.value"
                  class="mt-1"
                >
                <label :for="`grant-type-${opt.value}`" class="text-sm">
                  <span class="font-medium">{{ opt.label }}</span>
                  <span class="text-gray-500 ml-1">{{ opt.description }}</span>
                </label>
              </div>
            </div>
          </div>

          <div v-if="selectedGrantType === 'timed'" class="space-y-2">
            <label class="text-sm font-medium text-gray-500 block">Duration</label>
            <select
              v-model="selectedDurationPreset"
              class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            >
              <option v-for="p in DURATION_PRESETS" :key="p.value" :value="p.value">
                {{ p.label }}
              </option>
            </select>
            <input
              v-if="selectedDurationPreset === 'custom'"
              v-model.number="customDuration"
              type="number"
              :min="60"
              placeholder="Duration in seconds"
              class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            >
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-3">
          <button
            :disabled="processing"
            class="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            @click="handleApprove"
          >
            {{ processing ? 'Processing...' : 'Approve' }}
          </button>
          <button
            :disabled="processing"
            class="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            @click="handleDeny"
          >
            {{ processing ? 'Processing...' : 'Deny' }}
          </button>
        </div>
      </div>

      <!-- Already decided -->
      <div v-else class="space-y-4">
        <div
          :class="[
            'rounded-md border p-4',
            grant.status === 'approved'
              ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
              : grant.status === 'denied'
                ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                : 'bg-gray-50 dark:bg-gray-900/10 border-gray-200 dark:border-gray-700',
          ]"
        >
          <h3 class="font-semibold text-sm mb-2">
            Grant {{ grant.status }}
          </h3>
          <dl class="text-sm space-y-2">
            <div>
              <dt class="text-gray-500">
                Requester
              </dt>
              <dd class="font-mono text-sm break-all">
                {{ grant.request?.requester }}
              </dd>
            </div>
            <div>
              <dt class="text-gray-500">
                Target
              </dt>
              <dd class="font-mono text-sm">
                {{ grant.request?.target }}
              </dd>
            </div>
            <div v-if="grant.request?.run_as">
              <dt class="text-gray-500">
                Run as
              </dt>
              <dd class="font-mono text-sm">
                {{ grant.request.run_as }}
              </dd>
            </div>
            <div v-if="grant.request?.command?.length">
              <dt class="text-gray-500">
                Command
              </dt>
              <dd class="font-mono text-xs bg-gray-900 text-green-400 rounded px-2 py-1 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words">
                {{ grant.request.command.join(" ") }}
              </dd>
            </div>
            <div v-if="grant.request?.reason">
              <dt class="text-gray-500">
                Reason
              </dt>
              <dd>{{ grant.request?.reason }}</dd>
            </div>
            <div v-if="grant.decided_by">
              <dt class="text-gray-500">
                Decided by
              </dt>
              <dd>{{ grant.decided_by }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </template>
  </div>
</template>
