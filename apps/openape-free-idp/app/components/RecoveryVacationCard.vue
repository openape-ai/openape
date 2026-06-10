<script setup lang="ts">
import { onMounted, ref } from 'vue'

// Vacation switch for the adaptive recovery cooldown (#462,
// story recovery-adaptive-cooldown). Reads/writes the owner-only
// /api/settings/recovery endpoints; the 14-day cap is enforced
// server-side, the UI mirrors it.

const VACATION_MAX_DAYS = 14

const vacationMode = ref(false)
const vacationDays = ref(VACATION_MAX_DAYS)
const loading = ref(true)
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    const settings = await $fetch<{ vacationMode: boolean, vacationDays: number }>('/api/settings/recovery')
    vacationMode.value = settings.vacationMode
    vacationDays.value = settings.vacationDays
  }
  catch {
    error.value = 'Could not load your recovery settings'
  }
  finally {
    loading.value = false
  }
})

async function save() {
  if (!Number.isInteger(vacationDays.value) || vacationDays.value < 1)
    vacationDays.value = 1
  if (vacationDays.value > VACATION_MAX_DAYS)
    vacationDays.value = VACATION_MAX_DAYS

  error.value = ''
  saving.value = true
  try {
    await $fetch('/api/settings/recovery', {
      method: 'PUT',
      body: { vacationMode: vacationMode.value, vacationDays: vacationDays.value },
    })
  }
  catch (err) {
    error.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? 'Failed to save recovery settings'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard id="recovery-protection" class="mt-6">
    <template #header>
      <h2 class="text-lg font-semibold">
        Recovery protection
      </h2>
      <p class="text-sm text-muted mt-1">
        Account recovery always waits before it can complete: 7 days while you are
        active, 72 hours once your account has been dormant for a month. Going
        off-grid? Vacation mode stretches the wait — up to {{ VACATION_MAX_DAYS }} days.
      </p>
    </template>

    <div v-if="loading" class="text-center text-muted">
      Loading...
    </div>
    <div v-else class="space-y-4">
      <UAlert v-if="error" color="error" :title="error" />

      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="font-medium">
            Vacation mode
          </p>
          <p class="text-sm text-muted">
            Hold every recovery attempt for the full vacation waiting period.
          </p>
        </div>
        <USwitch
          v-model="vacationMode"
          aria-label="Vacation mode"
          :disabled="saving"
          @update:model-value="save"
        />
      </div>

      <UFormField label="Waiting period (days)" :help="`1 to ${VACATION_MAX_DAYS} days — ${VACATION_MAX_DAYS} is the hard maximum.`">
        <UInput
          v-model.number="vacationDays"
          type="number"
          :min="1"
          :max="VACATION_MAX_DAYS"
          :disabled="!vacationMode || saving"
          class="w-24"
          @change="save"
        />
      </UFormField>

      <p v-if="vacationMode" class="text-sm text-primary">
        While vacation mode is on, any recovery attempt must wait
        {{ vacationDays }} {{ vacationDays === 1 ? 'day' : 'days' }} before it can
        complete — no matter how recently you signed in. Switching it off later
        never shortens a wait that is already running.
      </p>
    </div>
  </UCard>
</template>
