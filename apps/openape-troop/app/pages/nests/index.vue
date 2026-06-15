<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

// Nests list — the operations view's landing. One card per bound device;
// click into it for the nest's info + the agents running on it. Toggle to
// the Companies view.
useSeoMeta({ title: () => 'Nests' })

const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface Nest { host_id: string, display_name: string, pod_uuid: string | null, status: string, created_at: number, last_seen_at: number | null, last_ip: string | null }
interface Agent { agentName: string, hostId: string | null, hostname: string | null, nestHostId: string | null }
interface MergedNest { host_id: string, display_name: string, status: string, last_ip: string | null, last_seen_at: number | null, bound: boolean, agentCount: number }

const nests = ref<Nest[]>([])
const agents = ref<Agent[]>([])
const loading = ref(true)
const error = ref('')

function lastSeen(ts: number | null) {
  if (!ts) return '—'
  const mins = Math.floor((Date.now() / 1000 - ts) / 60)
  if (mins < 1) return 'gerade eben'
  if (mins < 60) return `vor ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `vor ${h} h`
  return `vor ${Math.floor(h / 24)} d`
}

// A nest = a host that agents actually run on. Bound devices (from /api/nests)
// carry IP/status/last-seen; but agents report their own host_id (e.g. the
// container they run in), which may not match a bound device row. Merge both,
// keyed by host_id, so every agent shows up under its host.
const mergedNests = computed<MergedNest[]>(() => {
  const map = new Map<string, MergedNest>()
  for (const n of nests.value) {
    if (n.status === 'revoked') continue
    map.set(n.host_id, { host_id: n.host_id, display_name: n.display_name, status: n.status, last_ip: n.last_ip, last_seen_at: n.last_seen_at, bound: true, agentCount: 0 })
  }
  for (const a of agents.value) {
    // Group by the nest the agent belongs to; fall back to its runtime host
    // for legacy agents that predate nest_host_id.
    const hid = a.nestHostId ?? a.hostId
    if (!hid) continue
    let m = map.get(hid)
    if (!m) {
      m = { host_id: hid, display_name: a.hostname || hid, status: 'unbound', last_ip: null, last_seen_at: null, bound: false, agentCount: 0 }
      map.set(hid, m)
    }
    m.agentCount++
  }
  return [...map.values()].sort((x, y) => y.agentCount - x.agentCount)
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [n, a] = await Promise.all([
      ($fetch as any)('/api/nests'),
      ($fetch as any)('/api/agents'),
    ])
    nests.value = n
    agents.value = a
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || 'Konnte die Nests nicht laden.'
  }
  finally { loading.value = false }
}

watch(user, (u) => { if (u) load() }, { immediate: true })
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800/80 px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-2xl shrink-0" aria-hidden="true">🦍</span>
        <ViewToggle active="nests" />
      </div>
      <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-log-out" class="shrink-0" @click="logout" />
    </header>

    <main class="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <h2 class="text-2xl font-bold mb-1">
        Nests
      </h2>
      <p class="text-zinc-400 mb-6">
        Ihre Geräte — klicken Sie ein Nest an, um Infos und die dort laufenden Agents zu sehen.
      </p>

      <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />

      <p v-if="loading" class="text-zinc-500 py-12 text-center">
        Lädt …
      </p>

      <div v-else-if="!mergedNests.length" class="rounded-xl border border-dashed border-zinc-700 py-12 text-center space-y-3">
        <div class="text-5xl">
          🪺
        </div>
        <h3 class="text-lg font-medium">
          Noch kein Nest verbunden
        </h3>
        <p class="text-sm text-zinc-400 max-w-md mx-auto">
          Starten Sie den Nest-Daemon auf einem Gerät, um Agents dort laufen zu lassen.
        </p>
      </div>

      <ul v-else class="space-y-3">
        <li v-for="n in mergedNests" :key="n.host_id">
          <NuxtLink
            :to="`/nests/${encodeURIComponent(n.host_id)}`"
            class="block rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4 hover:bg-zinc-900 transition-colors"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-3 min-w-0">
                <UIcon name="i-lucide-server" class="size-5 text-zinc-500 shrink-0" />
                <div class="min-w-0">
                  <h3 class="text-lg font-semibold truncate">
                    {{ n.display_name }}
                  </h3>
                  <p class="text-xs font-mono text-zinc-600 truncate">
                    {{ n.host_id }}
                  </p>
                </div>
              </div>
              <UIcon name="i-lucide-chevron-right" class="text-zinc-500 shrink-0 size-5 mt-1" />
            </div>
            <dl class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs max-w-xl">
              <div>
                <dt class="text-zinc-500">
                  Status
                </dt>
                <dd>
                  <UBadge :color="n.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="xs">
                    {{ n.status }}
                  </UBadge>
                </dd>
              </div>
              <div>
                <dt class="text-zinc-500">
                  IP
                </dt>
                <dd class="font-mono">
                  {{ n.last_ip || '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-zinc-500">
                  Agents
                </dt>
                <dd class="font-medium">
                  {{ n.agentCount }}
                </dd>
              </div>
              <div>
                <dt class="text-zinc-500">
                  Zuletzt
                </dt>
                <dd class="font-medium">
                  {{ lastSeen(n.last_seen_at) }}
                </dd>
              </div>
            </dl>
          </NuxtLink>
        </li>
      </ul>
    </main>
  </div>
</template>
