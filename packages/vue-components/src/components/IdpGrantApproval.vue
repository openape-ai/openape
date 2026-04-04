<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useIdpApi } from '../composables/useIdpApi'

interface GrantRequest {
  requester?: string
  target_host?: string
  target?: string
  grant_type?: string
  duration?: number
  command?: string[]
  cmd_hash?: string
  reason?: string
  permissions?: string[]
  run_as?: string
  authorization_details?: unknown[]
}

interface Grant {
  id: string
  status: string
  request?: GrantRequest
  decided_by?: string
}

interface ApproveResult {
  grant: Grant
  authz_jwt: string
}

const props = defineProps<{
  baseUrl?: string
  grantId: string
  callbackUrl?: string
}>()

const emit = defineEmits<{
  approved: [grant: Grant, authzJwt: string]
  denied: [grantId: string]
  error: [message: string]
}>()

const { get, post } = useIdpApi(props.baseUrl)
const grant = ref<Grant | null>(null)
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
  if (selectedGrantType.value !== 'timed') return undefined
  return selectedDurationPreset.value === 'custom' ? customDuration.value : Number(selectedDurationPreset.value)
})

onMounted(async () => {
  if (!props.grantId) {
    error.value = 'Missing grant_id parameter'
    loading.value = false
    return
  }
  try {
    grant.value = await get<Grant>(`/api/grants/${props.grantId}`)
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
    const resolvedGrantType = selectedGrantType.value === 'as_requested'
      ? (grant.value?.request?.grant_type || 'once')
      : selectedGrantType.value
    const resolvedDuration = selectedGrantType.value === 'as_requested'
      ? grant.value?.request?.duration
      : effectiveDuration.value

    const result = await post<ApproveResult>(
      `/api/grants/${props.grantId}/approve`,
      {
        grant_type: resolvedGrantType,
        ...(resolvedGrantType === 'timed' && resolvedDuration ? { duration: resolvedDuration } : {}),
      },
    )

    if (props.callbackUrl) {
      const url = new URL(props.callbackUrl)
      url.searchParams.set('grant_id', props.grantId)
      url.searchParams.set('authz_jwt', result.authz_jwt)
      url.searchParams.set('status', 'approved')
      window.location.href = url.toString()
    }
    else {
      grant.value = result.grant
      emit('approved', result.grant, result.authz_jwt)
    }
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : 'Approval failed'
    error.value = msg
    emit('error', msg)
  }
  finally {
    processing.value = false
  }
}

async function handleDeny() {
  processing.value = true
  try {
    await post(`/api/grants/${props.grantId}/deny`)

    if (props.callbackUrl) {
      const url = new URL(props.callbackUrl)
      url.searchParams.set('grant_id', props.grantId)
      url.searchParams.set('status', 'denied')
      window.location.href = url.toString()
    }
    else {
      grant.value = { ...grant.value!, status: 'denied' }
      emit('denied', props.grantId)
    }
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : 'Denial failed'
    error.value = msg
    emit('error', msg)
  }
  finally {
    processing.value = false
  }
}
</script>

<template>
  <div>
    <div v-if="loading" class="text-center text-muted">
      Loading...
    </div>

    <UAlert v-else-if="error && !grant" color="error" :title="error" />

    <template v-else-if="grant">
      <!-- Pending: show approval form -->
      <div v-if="grant.status === 'pending'" class="space-y-4">
        <UAlert color="warning" title="An application is requesting permission:">
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
                <dd class="font-mono text-xs bg-gray-900 text-green-400 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-words">
                  {{ grant.request.command.join(" ") }}
                </dd>
              </div>
              <div v-if="grant.request?.reason">
                <dt class="text-muted">
                  Reason
                </dt>
                <dd>{{ grant.request.reason }}</dd>
              </div>
              <div v-if="grant.request?.permissions?.length">
                <dt class="text-muted">
                  Permissions
                </dt>
                <dd class="font-mono text-sm">
                  {{ grant.request.permissions.join(", ") }}
                </dd>
              </div>
            </dl>
          </template>
        </UAlert>

        <!-- Grant type selection -->
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

        <UAlert v-if="error" color="error" :title="error" class="mt-2" />

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

      <!-- Already decided -->
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
                  {{ grant.request?.target || grant.request?.target_host }}
                </dd>
              </div>
              <div v-if="grant.request?.reason">
                <dt class="text-muted">
                  Reason
                </dt>
                <dd>{{ grant.request.reason }}</dd>
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
      </div>
    </template>
  </div>
</template>
