<script setup lang="ts">
import type { AgentRecord, Metrics } from '../utils/attention-metrics'
import { useOpenApeAuth } from '#imports'

// Stufe 2 in nuce: what each agent's history says, and what sampling rate that
// would justify. Shown, never enforced — see AgentRecords.vue.
useSeoMeta({ title: () => 'Track-Records' })
const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

const { data } = await useFetch<{ metrics: Metrics, agents: AgentRecord[], events_considered: number }>('/api/inbox/metrics', {
  server: true,
  default: () => ({ metrics: { medianWaitSeconds: null, autonomyRate: null, reworkRate: null, answered: 0, openNow: 0 }, agents: [], events_considered: 0 }),
})
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <AppHeader active="inbox" title="Track-Records" :show-logout="!!user" @logout="logout" />

    <main class="max-w-3xl mx-auto px-4 sm:px-8 py-8">
      <InlineLogin v-if="!user" hint="Melde dich an, um die Historie deiner Agenten zu sehen." />
      <template v-else>
        <MetricTiles :metrics="data.metrics" class="mb-6" />
        <p class="text-zinc-400 mb-4 text-sm">
          Aus {{ data.events_considered }} Events. Die Sampling-Rate ist ein Vorschlag — jede PR läuft weiterhin durch die Inbox.
        </p>
        <AgentRecords :records="data.agents" />
      </template>
    </main>
  </div>
</template>
