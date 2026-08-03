<script setup lang="ts">
import type { WireEvent } from '../utils/attention-inbox'
import { computed } from 'vue'
import { useOpenApeAuth } from '#imports'
import { cardTitle, openRequests, waitingLabel } from '../utils/attention-inbox'

// The attention inbox: only decisions where the owner is the blocker,
// longest-waiting first. Everything else is engine room.
useSeoMeta({ title: () => 'Inbox' })
const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

const { data, refresh } = await useFetch<{ events: WireEvent[] }>('/api/events', {
  server: true,
  default: () => ({ events: [] }),
})
const now = Math.floor(Date.now() / 1000)
const open = computed(() => openRequests(data.value.events))

const badge: Record<string, { label: string, class: string }> = {
  'decision.requested': { label: 'Entscheidung', class: 'bg-amber-500/15 text-amber-400' },
  'work.blocked': { label: 'Eskalation', class: 'bg-amber-500/15 text-amber-400' },
  'verdict.requested': { label: 'Verdict', class: 'bg-emerald-500/15 text-emerald-400' },
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="app-header">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-2xl shrink-0" aria-hidden="true">🦍</span>
        <h1 class="font-semibold">
          Inbox
        </h1>
      </div>
      <UButton v-if="user" color="neutral" variant="ghost" size="sm" icon="i-lucide-log-out" @click="logout" />
    </header>

    <main class="max-w-3xl mx-auto px-4 sm:px-8 py-8">
      <template v-if="user">
        <div class="flex items-baseline justify-between mb-6">
          <p class="text-zinc-400">
            {{ open.length }} Entscheidung{{ open.length === 1 ? '' : 'en' }} warten auf dich — älteste zuerst.
          </p>
          <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-refresh-cw" @click="refresh()" />
        </div>

        <div v-if="open.length" class="space-y-2">
          <NuxtLink
            v-for="e in open" :key="e.id" :to="`/d/${e.id}`"
            class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 hover:border-zinc-600 transition-colors"
          >
            <span class="text-xs px-2 py-0.5 rounded shrink-0" :class="badge[e.type]?.class">
              {{ badge[e.type]?.label ?? e.type }}
            </span>
            <span class="min-w-0 flex-1 truncate font-medium">{{ cardTitle(e) }}</span>
            <span class="text-xs text-zinc-500 shrink-0">{{ waitingLabel(e, now) }}</span>
            <UIcon name="i-lucide-chevron-right" class="text-zinc-600 shrink-0" />
          </NuxtLink>
        </div>
        <p v-else class="text-zinc-500 py-16 text-center">
          Inbox Zero — nichts wartet auf dich.
        </p>
      </template>
      <p v-else class="text-zinc-400 py-16 text-center">
        Bitte zuerst <NuxtLink to="/" class="underline">
          einloggen
        </NuxtLink>.
      </p>
    </main>
  </div>
</template>
