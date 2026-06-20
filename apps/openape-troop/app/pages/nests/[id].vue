<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

// Nest detail — the device's info + the agents running on it. Each agent links
// into its chat (/agents/<name>), like everywhere in troop.
const route = useRoute()
const hostId = computed(() => String(route.params.id))

useSeoMeta({ title: () => 'Nest' })

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

interface Nest { host_id: string, display_name: string, pod_uuid: string | null, status: string, created_at: number, last_seen_at: number | null, last_ip: string | null }
interface Agent { agentName: string, email: string, hostId: string | null, hostname: string | null, nestHostId: string | null, lastSeenAt: number | null, taskCount: number, lastRunStatus: 'running' | 'ok' | 'error' | null }

const nest = ref<Nest | null>(null)
const agents = ref<Agent[]>([])
const loading = ref(true)
const error = ref('')

const nestAgents = computed(() => agents.value.filter(a => (a.nestHostId ?? a.hostId) === hostId.value))
function fmtTs(ts: number | null) { return ts ? new Date(ts * 1000).toLocaleString('de-AT') : '—' }
function runColor(s: string | null) { return s === 'ok' ? 'success' : s === 'error' ? 'error' : s === 'running' ? 'primary' : 'neutral' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [n, a] = await Promise.all([
      ($fetch as any)('/api/nests'),
      ($fetch as any)('/api/agents'),
    ])
    agents.value = a
    nest.value = (n as Nest[]).find(x => x.host_id === hostId.value) ?? null
    if (!nest.value) {
      // Not a bound device — synthesize the nest from the agents that report
      // this host_id (e.g. a container the agents run in, not formally bound).
      const onHost = nestAgents.value
      if (onHost.length) {
        nest.value = { host_id: hostId.value, display_name: onHost[0]!.hostname || hostId.value, pod_uuid: null, status: 'unbound', created_at: 0, last_seen_at: onHost[0]!.lastSeenAt, last_ip: null }
      }
      else { error.value = 'Nest nicht gefunden.' }
    }
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || 'Konnte das Nest nicht laden.'
  }
  finally { loading.value = false }
}

watch(user, (u) => { if (u) load() }, { immediate: true })

// Fleet pause — the kill-switch for every agent on this nest. They stay
// connected; none run LLM turns until resumed. Fire-and-confirm (the nest-wide
// flag is authoritative on the nest, not mirrored per-agent here).
const toast = useToast()
const fleetPausing = ref(false)
async function fleetPause(pause: boolean) {
  fleetPausing.value = true
  try {
    const verb = pause ? 'pause' : 'resume'
    await ($fetch as any)(`/api/nests/${encodeURIComponent(hostId.value)}/${verb}`, { method: 'POST' })
    toast.add({ title: pause ? 'Nest pausiert — alle Agents idle' : 'Nest fortgesetzt', color: pause ? 'warning' : 'success' })
  }
  catch (err: any) {
    toast.add({ title: err?.data?.statusMessage || 'Aktion fehlgeschlagen', color: 'error' })
  }
  finally { fleetPausing.value = false }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800/80 px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
      <UButton to="/nests" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-left">
        Nests
      </UButton>
      <ViewToggle active="nests" />
    </header>

    <main class="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <div v-if="loading" class="text-zinc-500 py-20 text-center">
        Lädt …
      </div>
      <UAlert v-else-if="error" color="error" variant="subtle" :title="error" />

      <template v-else-if="nest">
        <!-- Nest info -->
        <div class="flex items-center gap-3 mb-2">
          <UIcon name="i-lucide-server" class="size-6 text-primary-400" />
          <h2 class="text-3xl font-bold tracking-tight">
            {{ nest.display_name }}
          </h2>
          <UBadge :color="nest.status === 'active' ? 'success' : 'neutral'" variant="subtle">
            {{ nest.status }}
          </UBadge>
          <div class="ml-auto flex items-center gap-2">
            <UButton
              icon="i-lucide-pause"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="fleetPausing"
              :disabled="!nestAgents.length"
              title="Alle Agents auf diesem Nest pausieren (bleiben verbunden, 0 Tokens)"
              @click="fleetPause(true)"
            >
              Nest pausieren
            </UButton>
            <UButton
              icon="i-lucide-play"
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="fleetPausing"
              :disabled="!nestAgents.length"
              title="Nest fortsetzen (per-Agent-Pausen bleiben bestehen)"
              @click="fleetPause(false)"
            >
              Fortsetzen
            </UButton>
          </div>
        </div>
        <dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div>
            <dt class="text-xs text-zinc-500">
              Aktuelle IP
            </dt>
            <dd class="text-sm font-mono break-all">
              {{ nest.last_ip || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">
              Host-ID
            </dt>
            <dd class="text-sm font-mono break-all">
              {{ nest.host_id }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">
              Pod
            </dt>
            <dd class="text-sm font-mono break-all">
              {{ nest.pod_uuid || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">
              Zuletzt gesehen
            </dt>
            <dd class="text-sm">
              {{ fmtTs(nest.last_seen_at) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">
              Gebunden seit
            </dt>
            <dd class="text-sm">
              {{ fmtTs(nest.created_at) }}
            </dd>
          </div>
        </dl>

        <!-- Agents on this nest -->
        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          Agents auf diesem Nest <span class="text-zinc-600">({{ nestAgents.length }})</span>
        </h3>
        <p v-if="!nestAgents.length" class="text-zinc-500 py-6 text-center">
          Keine Agents auf diesem Nest.
        </p>
        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NuxtLink
            v-for="a in nestAgents"
            :key="a.email"
            :to="`/agents/${a.agentName}`"
            class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 hover:bg-zinc-900 transition-colors block"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium truncate">{{ a.agentName }}</span>
              <UIcon name="i-lucide-message-circle" class="size-4 text-zinc-500 shrink-0" />
            </div>
            <div class="mt-2 flex items-center gap-2 text-xs text-zinc-500">
              <UBadge :color="runColor(a.lastRunStatus)" variant="subtle" size="xs">
                {{ a.lastRunStatus ?? 'idle' }}
              </UBadge>
              <span>{{ a.taskCount }} Tasks</span>
            </div>
          </NuxtLink>
        </div>
      </template>
    </main>
  </div>
</template>
