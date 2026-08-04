<script setup lang="ts">
import type { WireEvent } from '../utils/attention-inbox'
import { computed } from 'vue'
import { useOpenApeAuth } from '#imports'
import { policiesFromEvents } from '../utils/policies'

// The rules that outlived their decision. Kept next to the inbox on purpose:
// deciding and governing are the same surface, one is just the residue.
useSeoMeta({ title: () => 'Regeln' })
const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

const { data } = await useFetch<{ events: WireEvent[] }>('/api/events', {
  server: true,
  default: () => ({ events: [] }),
})
const policies = computed(() => policiesFromEvents(data.value.events))
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="app-header">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-2xl shrink-0" aria-hidden="true">🦍</span>
        <NuxtLink to="/inbox" class="font-semibold hover:underline">
          Inbox
        </NuxtLink>
        <span class="text-zinc-600">/</span>
        <h1 class="font-semibold">
          Regeln
        </h1>
      </div>
      <UButton v-if="user" color="neutral" variant="ghost" size="sm" icon="i-lucide-log-out" @click="logout" />
    </header>

    <main class="max-w-3xl mx-auto px-4 sm:px-8 py-8">
      <InlineLogin v-if="!user" hint="Melde dich an, um die geltenden Regeln zu sehen." />
      <template v-else>
        <p class="text-zinc-400 mb-6">
          Was aus Entscheidungen geblieben ist — mit Herkunft, Datum und dem Ort, an dem die Regel bindet.
        </p>
        <PolicyList :policies="policies" />
      </template>
    </main>
  </div>
</template>
