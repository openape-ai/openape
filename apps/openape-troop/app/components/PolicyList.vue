<script setup lang="ts">
import type { Policy } from '../utils/policies'

// Rules in force, with the decision they came from — the point is that a
// policy is never anonymous: it has an origin, a date and a place where it
// actually binds.
defineProps<{ policies: Policy[] }>()

const { fmtDate } = useDateFormat()
</script>

<template>
  <div v-if="policies.length" class="space-y-2">
    <div
      v-for="p in policies" :key="p.id"
      class="rounded-lg border px-4 py-3"
      :class="p.adopted ? 'border-zinc-800 bg-zinc-900/50' : 'border-dashed border-zinc-700'"
    >
      <div class="flex items-start gap-2">
        <span
          class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded shrink-0 mt-0.5"
          :class="p.adopted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'"
        >{{ p.adopted ? $t('policies.badge.adopted') : $t('policies.badge.proposed') }}</span>
        <p class="text-sm font-medium leading-relaxed">
          {{ p.rule }}
        </p>
      </div>
      <p v-if="p.rationale" class="text-xs text-zinc-400 mt-2 leading-relaxed">
        {{ p.rationale }}
      </p>
      <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-zinc-400">
        <span>{{ p.actor }}</span>
        <time :datetime="new Date(p.ts * 1000).toISOString()">{{ fmtDate(p.ts) }}</time>
        <span v-if="p.enforcedIn" class="font-mono">{{ p.enforcedIn }}</span>
        <NuxtLink v-if="p.sourceId" :to="`/c/${p.sourceId}`" class="underline hover:text-zinc-300">
          {{ $t('policies.source') }}
        </NuxtLink>
      </div>
    </div>
  </div>
  <p v-else class="text-zinc-400 py-8 text-center">
    {{ $t('policies.empty') }}
  </p>
</template>
