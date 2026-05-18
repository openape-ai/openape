<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

interface NestGroup {
  /** Stable key — hostId when known, sentinel `__pending__` for agents
   *  whose first sync hasn't filled in the nest identity yet. */
  key: string
  /** Display label — hostname when known, friendly fallback otherwise. */
  label: string
  /** Most-recent lastSeenAt across agents in this group; drives group
   *  ordering (active nests first). null when no agent has ever synced. */
  maxLastSeenAt: number | null
  agents: AgentRow[]
}

const PENDING_SYNC_KEY = '__pending__'

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

// Group agents by nest (hostId). Agents that haven't completed their
// first /api/agents/me/sync yet have null hostId/hostname — bucket
// them under a sentinel "Pending sync" group at the bottom so the
// freshly-spawned ones don't disappear from the list during the
// few-second window before the bridge connects. Within each group:
// keep createdAt-desc (newest first); across groups: most-recently-
// seen nest first, pending last.
const nestGroups = computed<NestGroup[]>(() => {
  const buckets = new Map<string, NestGroup>()
  for (const a of agents.value) {
    const key = a.hostId ?? PENDING_SYNC_KEY
    const label = a.hostId ? (a.hostname || a.hostId) : 'Pending first sync'
    const existing = buckets.get(key)
    if (existing) {
      existing.agents.push(a)
      if (a.lastSeenAt && (!existing.maxLastSeenAt || a.lastSeenAt > existing.maxLastSeenAt)) {
        existing.maxLastSeenAt = a.lastSeenAt
      }
      // Prefer the freshest hostname (operators may have renamed
      // their Mac since this row was first written).
      if (a.hostId && a.hostname && a.lastSeenAt === existing.maxLastSeenAt) {
        existing.label = a.hostname
      }
    }
    else {
      buckets.set(key, {
        key,
        label,
        maxLastSeenAt: a.lastSeenAt,
        agents: [a],
      })
    }
  }
  const groups = Array.from(buckets.values())
  for (const g of groups) {
    g.agents.sort((x, y) => y.createdAt - x.createdAt)
  }
  groups.sort((x, y) => {
    if (x.key === PENDING_SYNC_KEY) return 1
    if (y.key === PENDING_SYNC_KEY) return -1
    const xs = x.maxLastSeenAt ?? 0
    const ys = y.maxLastSeenAt ?? 0
    if (xs !== ys) return ys - xs
    return x.label.localeCompare(y.label)
  })
  return groups
})
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

      <!-- Mobile-first card list, grouped by nest. The hostname header
           separates agents from different Macs so a multi-nest setup
           doesn't blur together. One tap-target per agent → detail
           page; secondary metadata sits underneath as small badges. -->
      <div v-else class="space-y-6">
        <section v-for="g in nestGroups" :key="g.key">
          <header class="flex items-center gap-2 mb-2 px-1">
            <UIcon
              :name="g.key === PENDING_SYNC_KEY ? 'i-lucide-loader-2' : 'i-lucide-server'"
              class="text-muted size-4 shrink-0"
              :class="{ 'animate-spin': g.key === PENDING_SYNC_KEY }"
            />
            <h3 class="text-sm font-semibold text-zinc-300 truncate">
              {{ g.label }}
            </h3>
            <span class="text-xs text-muted shrink-0">
              ({{ g.agents.length }})
            </span>
          </header>
          <ul class="space-y-3">
            <li v-for="a in g.agents" :key="a.email">
              <NuxtLink
                :to="`/agents/${a.agentName}`"
                class="block rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-4 active:bg-zinc-900 transition-colors"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h4 class="text-lg font-semibold font-mono truncate">
                        {{ a.agentName }}
                      </h4>
                      <UBadge
                        v-if="a.lastRunStatus"
                        :color="(statusColor[a.lastRunStatus] as any)"
                        variant="subtle"
                        size="xs"
                      >
                        {{ a.lastRunStatus }}
                      </UBadge>
                    </div>
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
        </section>
      </div>
    </main>
  </div>
</template>
