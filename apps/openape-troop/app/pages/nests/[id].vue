<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

// Nest detail — the device's info + the agents running on it. Each agent links
// into its chat (/agents/<name>), like everywhere in troop.
const route = useRoute()
const hostId = computed(() => String(route.params.id))

const { t } = useI18n()
useSeoMeta({ title: () => t('nestDetail.tabTitle') })

const { fmtDate } = useDateFormat()

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

interface Nest { host_id: string, display_name: string, pod_uuid: string | null, status: string, created_at: number, last_seen_at: number | null, last_ip: string | null }
interface Agent { agentName: string, email: string, hostId: string | null, hostname: string | null, nestHostId: string | null, lastSeenAt: number | null, taskCount: number, lastRunStatus: 'running' | 'ok' | 'error' | null }

const nest = ref<Nest | null>(null)
const agents = ref<Agent[]>([])
const loading = ref(true)
const error = ref('')

const nestAgents = computed(() => agents.value.filter(a => (a.nestHostId ?? a.hostId) === hostId.value))
function runColor(s: string | null) { return s === 'ok' ? 'success' : s === 'error' ? 'error' : s === 'running' ? 'primary' : 'neutral' }
function runLabel(s: string | null) { return t(`nestDetail.runStatus.${s ?? 'idle'}`) }

const STATUS_KEYS: Record<string, string> = {
  active: 'nestsIndex.status.active',
  unbound: 'nestsIndex.status.unbound',
  revoked: 'nestsIndex.status.revoked',
}
function statusLabel(status: string) {
  const key = STATUS_KEYS[status]
  return key ? t(key) : status
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [n, a] = await Promise.all([
      apiFetch<Nest[]>('/api/nests'),
      apiFetch<Agent[]>('/api/agents'),
    ])
    agents.value = a
    nest.value = n.find(x => x.host_id === hostId.value) ?? null
    if (!nest.value) {
      // Not a bound device — synthesize the nest from the agents that report
      // this host_id (e.g. a container the agents run in, not formally bound).
      const onHost = nestAgents.value
      if (onHost.length) {
        nest.value = { host_id: hostId.value, display_name: onHost[0]!.hostname || hostId.value, pod_uuid: null, status: 'unbound', created_at: 0, last_seen_at: onHost[0]!.lastSeenAt, last_ip: null }
      }
      else { error.value = t('nestDetail.notFound') }
    }
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || t('nestDetail.error.loadFailed')
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
    await apiFetch(`/api/nests/${encodeURIComponent(hostId.value)}/${verb}`, { method: 'POST' })
    toast.add({ title: pause ? t('nestDetail.pause.toast') : t('nestDetail.resume.toast'), color: pause ? 'warning' : 'success' })
  }
  catch (err: any) {
    toast.add({ title: err?.data?.statusMessage || t('nestDetail.actionFailed'), color: 'error' })
  }
  finally { fleetPausing.value = false }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <AppHeader :back="{ to: '/nests', label: $t('nestsIndex.heading') }" active="nests" :show-logout="false" />

    <main class="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <div v-if="loading" class="text-zinc-500 py-20 text-center">
        {{ $t('common.loading') }}
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
            {{ statusLabel(nest.status) }}
          </UBadge>
          <div class="ml-auto flex items-center gap-2">
            <UButton
              icon="i-lucide-pause"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="fleetPausing"
              :disabled="!nestAgents.length"
              :title="$t('nestDetail.pause.title')"
              @click="fleetPause(true)"
            >
              {{ $t('nestDetail.pause.button') }}
            </UButton>
            <UButton
              icon="i-lucide-play"
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="fleetPausing"
              :disabled="!nestAgents.length"
              :title="$t('nestDetail.resume.title')"
              @click="fleetPause(false)"
            >
              {{ $t('nestDetail.resume.button') }}
            </UButton>
          </div>
        </div>
        <dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div>
            <dt class="text-xs text-zinc-500">
              {{ $t('nestDetail.info.ip') }}
            </dt>
            <dd class="text-sm font-mono break-all">
              {{ nest.last_ip || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">
              {{ $t('nestDetail.info.hostId') }}
            </dt>
            <dd class="text-sm font-mono break-all">
              {{ nest.host_id }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">
              {{ $t('nestDetail.info.pod') }}
            </dt>
            <dd class="text-sm font-mono break-all">
              {{ nest.pod_uuid || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">
              {{ $t('nestDetail.info.lastSeen') }}
            </dt>
            <dd class="text-sm">
              {{ fmtDate(nest.last_seen_at) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">
              {{ $t('nestDetail.info.boundSince') }}
            </dt>
            <dd class="text-sm">
              {{ fmtDate(nest.created_at) }}
            </dd>
          </div>
        </dl>

        <!-- Agents on this nest -->
        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          {{ $t('nestDetail.agents.title') }} <span class="text-zinc-600">({{ nestAgents.length }})</span>
        </h3>
        <p v-if="!nestAgents.length" class="text-zinc-500 py-6 text-center">
          {{ $t('nestDetail.agents.empty') }}
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
                {{ runLabel(a.lastRunStatus) }}
              </UBadge>
              <span>{{ $t('nestDetail.agents.tasks', a.taskCount) }}</span>
            </div>
          </NuxtLink>
        </div>
      </template>
    </main>
  </div>
</template>
