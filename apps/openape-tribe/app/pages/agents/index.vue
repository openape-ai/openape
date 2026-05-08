<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

useSeoMeta({ title: 'My Agents' })

const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface AgentRow {
  email: string
  agentName: string
  hostId: string | null
  hostname: string | null
  pubkeySsh: string | null
  firstSeenAt: number | null
  lastSeenAt: number | null
  createdAt: number
  taskCount: number
  lastRunStatus: 'running' | 'ok' | 'error' | null
  lastRunAt: number | null
}

const agents = ref<AgentRow[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    agents.value = await ($fetch as any)('/api/agents')
  }
  catch (err: any) {
    if (err?.statusCode === 401) {
      await navigateTo('/login')
      return
    }
    error.value = err?.data?.statusMessage || err?.message || 'failed to load agents'
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => { if (u) load() }, { immediate: true })
onMounted(() => { if (!user.value) navigateTo('/login') })

function fmtDate(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtKey(key: string | null): string {
  if (!key) return '—'
  // Show ssh-ed25519 fingerprint-style: type + first/last 6 chars of body
  const m = key.trim().match(/^(ssh-\S+)\s+(\S+)/)
  if (!m) return `${key.slice(0, 16)}…`
  const body = m[2]!
  return `${m[1]} ${body.slice(0, 6)}…${body.slice(-6)}`
}

const statusColor: Record<NonNullable<AgentRow['lastRunStatus']>, string> = {
  running: 'info',
  ok: 'success',
  error: 'error',
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-4 sm:px-6 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-2xl">🦒</span>
        <h1 class="text-xl font-semibold">
          Tribe
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted hidden sm:inline">{{ user?.sub }}</span>
        <UButton variant="ghost" size="sm" icon="i-lucide-log-out" @click="logout">
          Logout
        </UButton>
      </div>
    </header>

    <main class="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <h2 class="text-2xl font-bold mb-1">
        My Agents
      </h2>
      <p class="text-muted mb-6">
        Cron-scheduled jobs you've spawned with <code>apes agents spawn</code>.
      </p>

      <UAlert v-if="error" color="error" :title="error" class="mb-4" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          Loading…
        </p>
      </UCard>

      <UCard v-else-if="agents.length === 0">
        <div class="text-center py-8 space-y-3">
          <p class="text-muted">
            No agents registered yet.
          </p>
          <p class="text-sm text-muted">
            Run <code class="bg-(--ui-bg-elevated) px-2 py-0.5 rounded">apes agents spawn &lt;name&gt;</code>
            on a Mac to provision one. It'll show up here once it's done its first sync.
          </p>
        </div>
      </UCard>

      <UCard v-else :ui="{ body: 'p-0' }">
        <table class="w-full text-sm">
          <thead class="text-xs text-muted">
            <tr class="border-b border-(--ui-border)">
              <th class="text-left px-4 py-2 font-medium">
                Name
              </th>
              <th class="text-left px-4 py-2 font-medium">
                Host
              </th>
              <th class="text-left px-4 py-2 font-medium">
                Tasks
              </th>
              <th class="text-left px-4 py-2 font-medium">
                Last run
              </th>
              <th class="text-left px-4 py-2 font-medium">
                Last sync
              </th>
              <th />
            </tr>
          </thead>
          <tbody class="divide-y divide-(--ui-border)">
            <tr v-for="a in agents" :key="a.email">
              <td class="px-4 py-3">
                <div class="font-mono">
                  {{ a.agentName }}
                </div>
                <div class="text-xs text-muted truncate">
                  {{ a.email }}
                </div>
              </td>
              <td class="px-4 py-3">
                <div class="text-xs">
                  {{ a.hostname || '—' }}
                </div>
                <div class="text-xs text-muted font-mono">
                  {{ a.hostId ? `${a.hostId.slice(0, 8)}…` : '—' }}
                </div>
                <div class="text-xs text-muted truncate" :title="a.pubkeySsh ?? ''">
                  {{ fmtKey(a.pubkeySsh) }}
                </div>
              </td>
              <td class="px-4 py-3 text-center">
                {{ a.taskCount }}
              </td>
              <td class="px-4 py-3">
                <UBadge
                  v-if="a.lastRunStatus"
                  :color="(statusColor[a.lastRunStatus] as any)"
                  variant="subtle"
                  size="xs"
                >
                  {{ a.lastRunStatus }}
                </UBadge>
                <span v-else class="text-muted">—</span>
                <div class="text-xs text-muted">
                  {{ fmtDate(a.lastRunAt) }}
                </div>
              </td>
              <td class="px-4 py-3 text-xs text-muted">
                {{ fmtDate(a.lastSeenAt) }}
              </td>
              <td class="px-4 py-3 text-right">
                <UButton :to="`/agents/${a.agentName}`" variant="ghost" size="xs" icon="i-lucide-arrow-right">
                  Manage
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </UCard>
    </main>
  </div>
</template>
