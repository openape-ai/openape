<script setup lang="ts">
import { onMounted, ref } from 'vue'

// Kiosks signed in via QR. Rendered only when there are any — most visits
// have none, and an empty card would just be noise on the account hub.

interface QrSessionRow {
  id: string
  requester: { ip: string, userAgent: string }
  createdAt: number
  expiresAt: number
}

const sessions = ref<QrSessionRow[]>([])
const error = ref('')

async function load() {
  try {
    sessions.value = await $fetch<QrSessionRow[]>('/api/session/qr/sessions')
  }
  catch {
    // The hub page already handles the signed-out case; stay quiet here.
  }
}

async function revoke(id: string) {
  error.value = ''
  try {
    await $fetch(`/api/session/qr/sessions/${id}`, { method: 'DELETE' })
    sessions.value = sessions.value.filter(s => s.id !== id)
  }
  catch (err: any) {
    error.value = err?.data?.title ?? 'Could not end the session'
  }
}

onMounted(load)
</script>

<template>
  <UCard v-if="sessions.length > 0">
    <template #header>
      <h2 class="text-lg font-semibold">
        Signed in via QR code
      </h2>
      <p class="text-sm text-muted mt-1">
        Browsers you signed in by scanning a code. Each expires on its own after an hour; end one early if you left the machine.
      </p>
    </template>

    <UAlert v-if="error" color="error" :title="error" class="mb-4" />

    <ul class="space-y-3">
      <li v-for="s in sessions" :key="s.id" class="flex items-center gap-3">
        <span class="text-sm min-w-0 flex-1">
          <span class="block truncate">{{ s.requester.userAgent }}</span>
          <span class="block text-xs text-muted">{{ s.requester.ip }} · until {{ new Date(s.expiresAt).toLocaleTimeString() }}</span>
        </span>
        <UButton
          color="error"
          variant="soft"
          size="sm"
          label="End session"
          @click="revoke(s.id)"
        />
      </li>
    </ul>
  </UCard>
</template>
