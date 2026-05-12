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
const showSpawn = ref(false)

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

// Relative time for the at-a-glance "is this agent alive?" signal —
// absolute timestamps don't work on a phone-sized card.
function fmtRelative(ts: number | null): string {
  if (!ts) return 'never'
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

const statusColor: Record<NonNullable<AgentRow['lastRunStatus']>, string> = {
  running: 'info',
  ok: 'success',
  error: 'error',
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-2xl shrink-0">🦍</span>
        <h1 class="text-xl font-semibold">
          Troop
        </h1>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <UButton
          color="primary"
          size="sm"
          icon="i-lucide-plus"
          @click="showSpawn = true"
        >
          <span class="hidden sm:inline">Spawn agent</span>
        </UButton>
        <UButton
          variant="ghost"
          size="sm"
          icon="i-lucide-log-out"
          :ui="{ base: 'shrink-0' }"
          @click="logout"
        >
          <span class="hidden sm:inline">Logout</span>
        </UButton>
      </div>
    </header>
    <SpawnAgentDialog v-model:open="showSpawn" @update:open="(v) => { if (!v) load() }" />

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

      <!-- Mobile-first card list. The table layout was unreadable on
           a phone (5 narrow columns + email truncation). One tap-target
           per agent → links to the detail page; everything secondary
           goes underneath as small badges/labels. -->
      <ul v-else class="space-y-3">
        <li v-for="a in agents" :key="a.email">
          <NuxtLink
            :to="`/agents/${a.agentName}`"
            class="block rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-4 active:bg-zinc-900 transition-colors"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="text-lg font-semibold font-mono truncate">
                    {{ a.agentName }}
                  </h3>
                  <UBadge
                    v-if="a.lastRunStatus"
                    :color="(statusColor[a.lastRunStatus] as any)"
                    variant="subtle"
                    size="xs"
                  >
                    {{ a.lastRunStatus }}
                  </UBadge>
                </div>
                <p class="text-xs text-muted mt-0.5 truncate">
                  {{ a.hostname || '—' }}
                </p>
              </div>
              <UIcon name="i-lucide-chevron-right" class="text-muted shrink-0 size-5 mt-1" />
            </div>

            <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt class="text-muted">
                  Tasks
                </dt>
                <dd class="font-medium">
                  {{ a.taskCount }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">
                  Last sync
                </dt>
                <dd class="truncate">
                  {{ fmtRelative(a.lastSeenAt) }}
                </dd>
              </div>
              <div v-if="a.lastRunAt" class="col-span-2">
                <dt class="text-muted">
                  Last run
                </dt>
                <dd>{{ fmtDate(a.lastRunAt) }}</dd>
              </div>
            </dl>
          </NuxtLink>
        </li>
      </ul>
    </main>
  </div>
</template>
