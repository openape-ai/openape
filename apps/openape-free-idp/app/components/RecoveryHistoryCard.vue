<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

// "Has anyone tried to recover my account?" (#462, story recovery-audit).
// Read-only view of /api/settings/recovery-history — every attempt with
// time, origin and outcome. Entries can neither be edited nor deleted;
// the only action is the active-owner veto on a still-running attempt
// (story recovery-broadcast: one-tap cancel, here via the session).

interface RecoveryAttempt {
  requestedAt: number
  requestIp?: string
  requestUserAgent?: string
  status: 'pending' | 'completed' | 'cancelled' | 'expired'
  usableAt?: number
}

const attempts = ref<RecoveryAttempt[]>([])
const loading = ref(true)
const error = ref('')
const cancelling = ref(false)
const justCancelled = ref(false)

const pending = computed(() => attempts.value.find(a => a.status === 'pending'))

onMounted(load)

async function load() {
  loading.value = true
  try {
    attempts.value = await $fetch<RecoveryAttempt[]>('/api/settings/recovery-history')
  }
  catch {
    error.value = 'Could not load the recovery history'
  }
  finally {
    loading.value = false
  }
}

async function cancelRecovery() {
  error.value = ''
  cancelling.value = true
  try {
    await $fetch('/api/recovery/cancel', { method: 'POST', body: {} })
    justCancelled.value = true
    await load()
  }
  catch {
    error.value = 'Failed to cancel the recovery'
  }
  finally {
    cancelling.value = false
  }
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString()
}

const STATUS = {
  pending: { label: 'running', color: 'warning' },
  completed: { label: 'completed', color: 'success' },
  cancelled: { label: 'cancelled', color: 'neutral' },
  expired: { label: 'expired', color: 'info' },
} as const

function browserOf(userAgent?: string) {
  if (!userAgent)
    return ''
  for (const [needle, name] of [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']] as const) {
    if (userAgent.includes(needle))
      return name
  }
  return 'Unknown browser'
}
</script>

<template>
  <UCard id="recovery-history" class="mt-6">
    <template #header>
      <h2 class="text-lg font-semibold">
        Recovery history
      </h2>
      <p class="text-sm text-muted mt-1">
        Has anyone tried to recover this account? Every attempt is on permanent
        record — when it happened, where it came from and how it ended. Entries
        cannot be edited or deleted, not even by you.
      </p>
    </template>

    <div v-if="loading" class="text-center text-muted">
      Loading...
    </div>
    <div v-else class="space-y-4">
      <UAlert v-if="error" color="error" :title="error" />

      <template v-if="pending">
        <UAlert
          color="warning"
          icon="i-lucide-shield-alert"
          title="A recovery for this account is waiting to complete"
          :description="`It could complete ${formatTime(pending.usableAt!)}. If you did not request it, cancel it now — a cancelled recovery can never be completed.`"
        />
        <UButton
          color="error"
          icon="i-lucide-shield-x"
          :loading="cancelling"
          @click="cancelRecovery"
        >
          Cancel recovery
        </UButton>
      </template>

      <UAlert
        v-else-if="justCancelled"
        color="success"
        icon="i-lucide-shield-check"
        title="Recovery cancelled"
        description="That attempt is dead for good — it can never be completed, and it stays on record below."
      />

      <div v-if="attempts.length === 0" class="text-center text-muted">
        No one has tried to recover this account.
      </div>
      <table v-else class="w-full">
        <thead class="border-b border-(--ui-border)">
          <tr>
            <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
              When
            </th>
            <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
              Origin
            </th>
            <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
              Outcome
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-(--ui-border)">
          <tr v-for="a in attempts" :key="a.requestedAt" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
            <td class="px-4 py-3 text-sm whitespace-nowrap">
              {{ formatTime(a.requestedAt) }}
            </td>
            <td class="px-4 py-3 text-sm">
              <span v-if="a.requestIp" class="font-mono text-xs">{{ a.requestIp }}</span>
              <span v-else class="text-muted">unknown</span>
              <div v-if="a.requestUserAgent" class="text-xs text-muted" :title="a.requestUserAgent">
                {{ browserOf(a.requestUserAgent) }}
              </div>
            </td>
            <td class="px-4 py-3">
              <UBadge :color="STATUS[a.status].color" variant="subtle" size="sm">
                {{ STATUS[a.status].label }}
              </UBadge>
              <div v-if="a.status === 'pending' && a.usableAt" class="text-xs text-muted mt-1">
                until {{ formatTime(a.usableAt) }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>
</template>
