<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

interface Monitor {
  id: string
  name: string
  kind: 'http' | 'heartbeat'
  url: string
  ping_url: string | null
  last_ping_at: number | null
  interval_sec: number
  status: 'up' | 'down' | null
  last_code: number | null
  last_latency_ms: number | null
  last_error: string | null
  last_checked_at: number | null
  uptime_pct: number | null
  checks_count: number
  created_at: number
}

const { user, fetchUser, logout } = useOpenApeAuth()
const monitors = ref<Monitor[]>([])
const loading = ref(true)

const url = ref('')
const name = ref('')
const kind = ref<'http' | 'heartbeat'>('http')
const intervalSec = ref(300)
const kindOptions = [
  { label: 'URL', value: 'http' },
  { label: 'Heartbeat', value: 'heartbeat' },
]
const adding = ref(false)
const error = ref('')
const busy = ref<Record<string, boolean>>({})

const intervalOptions = [
  { label: 'every 1 min', value: 60 },
  { label: 'every 5 min', value: 300 },
  { label: 'every 15 min', value: 900 },
  { label: 'every hour', value: 3600 },
]
// Same field, different question: for a heartbeat the interval is how long a
// ping may be missing before we call it down.
const heartbeatOptions = [
  { label: 'silent for 5 min', value: 300 },
  { label: 'silent for 15 min', value: 900 },
  { label: 'silent for 1 hour', value: 3600 },
  { label: 'silent for 6 hours', value: 21600 },
]

async function load() {
  monitors.value = await $fetch<Monitor[]>('/api/monitors')
  loading.value = false
}

const canAdd = computed(() =>
  kind.value === 'heartbeat' ? !!name.value.trim() : !!url.value.trim(),
)

async function add() {
  if (!canAdd.value || adding.value) return
  adding.value = true
  error.value = ''
  try {
    await $fetch('/api/monitors', {
      method: 'POST',
      body: {
        kind: kind.value,
        url: url.value.trim() || undefined,
        name: name.value.trim() || undefined,
        intervalSec: intervalSec.value,
      },
    })
    url.value = ''
    name.value = ''
    await load()
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string }, message?: string }
    error.value = e.data?.detail ?? e.data?.title ?? e.message ?? 'Could not add monitor'
  }
  finally {
    adding.value = false
  }
}

async function checkNow(m: Monitor) {
  busy.value = { ...busy.value, [m.id]: true }
  try {
    await $fetch(`/api/monitors/${m.id}/check`, { method: 'POST' })
    await load()
  }
  finally {
    busy.value = { ...busy.value, [m.id]: false }
  }
}

async function remove(m: Monitor) {
  if (!confirm(`Delete monitor "${m.name}"?`)) return
  busy.value = { ...busy.value, [m.id]: true }
  try {
    await $fetch(`/api/monitors/${m.id}`, { method: 'DELETE' })
    await load()
  }
  finally {
    busy.value = { ...busy.value, [m.id]: false }
  }
}

function ago(ts: number | null): string {
  if (!ts) return 'never'
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  await load()
  timer = setInterval(load, 30_000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800/70 px-4 sm:px-6 py-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-xl" aria-hidden="true">📡</span>
        <span class="font-semibold tracking-tight">OpenApe Monitor</span>
      </div>
      <div class="flex items-center gap-3 text-sm text-zinc-400">
        <span class="hidden sm:inline">{{ user?.sub }}</span>
        <UButton color="neutral" variant="ghost" size="sm" @click="logout">
          Logout
        </UButton>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <form class="mb-8 space-y-2" @submit.prevent="add">
        <div class="flex flex-col sm:flex-row gap-2">
          <USelect
            v-model="kind"
            :items="kindOptions"
            size="lg"
            class="sm:w-36"
          />
          <UInput
            v-if="kind === 'http'"
            v-model="url"
            type="url"
            placeholder="https://example.com"
            size="lg"
            class="flex-1"
          />
          <UInput
            v-model="name"
            :placeholder="kind === 'heartbeat' ? 'Name, e.g. OpenClaw scheduler' : 'Name (optional)'"
            size="lg"
            :class="kind === 'heartbeat' ? 'flex-1' : 'sm:w-40'"
          />
          <USelect
            v-model="intervalSec"
            :items="kind === 'heartbeat' ? heartbeatOptions : intervalOptions"
            size="lg"
            class="sm:w-44"
          />
          <UButton
            type="submit"
            color="primary"
            size="lg"
            :loading="adding"
            :disabled="!canAdd || adding"
          >
            Add
          </UButton>
        </div>
        <p v-if="kind === 'heartbeat'" class="text-xs text-zinc-500">
          You get a ping URL. Have the thing you want watched POST to it while it is healthy —
          silence past the chosen window is the alert.
        </p>
      </form>

      <UAlert v-if="error" color="error" :title="error" class="mb-6" @close="error = ''" />

      <div v-if="loading" class="text-zinc-500 text-center py-12">
        Loading…
      </div>

      <div v-else-if="!monitors.length" class="text-zinc-500 text-center py-12">
        No monitors yet. Add a URL above to start watching it.
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="m in monitors"
          :key="m.id"
          class="flex items-center gap-4 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-4 py-3"
        >
          <span
            class="shrink-0 w-2.5 h-2.5 rounded-full"
            :class="m.status === 'up' ? 'bg-emerald-500' : m.status === 'down' ? 'bg-red-500' : 'bg-zinc-600'"
            :title="m.status ?? 'pending'"
          />

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium truncate">{{ m.name }}</span>
              <UBadge
                v-if="m.status"
                :color="m.status === 'up' ? 'success' : 'error'"
                variant="subtle"
                size="sm"
              >
                {{ m.status.toUpperCase() }}
              </UBadge>
            </div>
            <a
              v-if="m.kind === 'http'"
              :href="m.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm text-zinc-500 hover:text-zinc-300 truncate block"
            >{{ m.url }}</a>
            <p v-else class="text-sm text-zinc-500 truncate">
              heartbeat · last ping {{ ago(m.last_ping_at) }}
            </p>
            <p v-if="m.kind === 'heartbeat' && m.ping_url" class="text-xs font-mono text-zinc-600 truncate">
              {{ m.ping_url }}
            </p>
            <p v-if="m.status === 'down' && m.last_error" class="text-xs text-red-400 mt-0.5 truncate">
              {{ m.last_error }}
            </p>
          </div>

          <div class="hidden sm:block text-right text-sm text-zinc-400 shrink-0 tabular-nums">
            <div>{{ m.uptime_pct != null ? `${m.uptime_pct}% up` : '—' }}</div>
            <div class="text-xs text-zinc-600">
              {{ m.last_latency_ms != null ? `${m.last_latency_ms}ms · ` : '' }}{{ ago(m.last_checked_at) }}
            </div>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="busy[m.id]"
              title="Check now"
              @click="checkNow(m)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="busy[m.id]"
              title="Delete"
              @click="remove(m)"
            />
          </div>
        </li>
      </ul>
    </main>
  </div>
</template>
