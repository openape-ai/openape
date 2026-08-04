<script setup lang="ts">
import type { WireEvent } from '../utils/attention-inbox'
import type { Metrics } from '../utils/attention-metrics'
import { computed } from 'vue'
import { useOpenApeAuth } from '#imports'
import { callKind, cardTitle, openRequests, waitingLabel } from '../utils/attention-inbox'

// The attention inbox: only decisions where the owner is the blocker,
// longest-waiting first. Everything else is engine room.
const { t } = useI18n()
useSeoMeta({ title: () => t('inbox.tabTitle') })
const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

const { data, refresh, status } = await useFetch<{ events: WireEvent[], truncated: boolean }>('/api/events', {
  server: true,
  default: () => ({ events: [], truncated: false }),
})
const { data: stats } = await useFetch<{ metrics: Metrics }>('/api/inbox/metrics', {
  server: true,
  default: () => ({ metrics: { medianWaitSeconds: null, autonomyRate: null, reworkRate: null, answered: 0, openNow: 0 } }),
})
const now = Math.floor(Date.now() / 1000)

// One row per open call, reduced to what the list renders. Going through the
// kind rather than the raw event type also gives `call.raised` a badge — it
// used to fall through and print its own event name.
const open = computed(() => openRequests(data.value.events).map(event => ({
  id: event.id,
  kind: callKind(event),
  title: cardTitle(event),
  waiting: waitingLabel(event, now),
})))

const BADGE_CLASS: Record<'decision' | 'escalation' | 'verdict', string> = {
  decision: 'bg-amber-500/15 text-amber-400',
  escalation: 'bg-amber-500/15 text-amber-400',
  verdict: 'bg-emerald-500/15 text-emerald-400',
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <AppHeader active="inbox" :show-logout="!!user" @logout="logout" />

    <main class="max-w-3xl mx-auto px-4 sm:px-8 py-8">
      <template v-if="user">
        <MetricTiles :metrics="stats.metrics" class="mb-6" />

        <div class="flex items-baseline justify-between mb-6">
          <p class="text-zinc-400">
            {{ t('inbox.waiting', open.length) }}
          </p>
          <div class="flex items-center gap-2">
            <NuxtLink to="/inbox-agents" class="text-xs text-zinc-400 hover:text-zinc-200 underline">
              {{ t('inbox.trackRecordsLink') }}
            </NuxtLink>
            <NuxtLink to="/policies" class="text-xs text-zinc-400 hover:text-zinc-200 underline">
              {{ t('inbox.policiesLink') }}
            </NuxtLink>
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-refresh-cw" :aria-label="t('inbox.refresh')" :loading="status === 'pending'" @click="refresh()" />
          </div>
        </div>

        <div v-if="open.length" class="space-y-2">
          <NuxtLink
            v-for="row in open" :key="row.id" :to="`/c/${row.id}`"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 hover:border-zinc-600 transition-colors"
          >
            <span class="text-xs px-2 py-0.5 rounded shrink-0" :class="BADGE_CLASS[row.kind]">
              {{ t(`inbox.kind.${row.kind}`) }}
            </span>
            <span class="min-w-0 flex-1 basis-full sm:basis-auto font-medium">{{ t(row.title.key, row.title.params) }}</span>
            <span class="text-xs text-zinc-400 shrink-0">{{ t(row.waiting.key, row.waiting.params) }}</span>
            <UIcon name="i-lucide-chevron-right" class="text-zinc-600 shrink-0" />
          </NuxtLink>
        </div>
        <p v-else class="text-zinc-400 py-16 text-center">
          {{ t('inbox.empty') }}
        </p>
      </template>
      <InlineLogin v-else :hint="t('common.loginHint', { what: t('inbox.loginWhat') })" />
    </main>
  </div>
</template>
