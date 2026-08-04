<script setup lang="ts">
import type { AgentRecord } from '../utils/attention-metrics'

// The sampling rate is a suggestion the page shows — nothing acts on it.
// That is the point: trust is earned in public, and only the owner decides
// whether to spend it.
defineProps<{ records: AgentRecord[] }>()

function percent(rate: number): string {
  return `${Math.round(rate * 100)} %`
}
</script>

<template>
  <div v-if="records.length" class="rounded-xl border border-zinc-800 overflow-hidden">
    <div
      v-for="r in records" :key="r.agent"
      class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 last:border-b-0"
    >
      <span class="min-w-0 flex-1 truncate text-sm font-mono">{{ r.agent }}</span>
      <span class="text-xs text-zinc-400 shrink-0">
        {{ r.reviews }} Review{{ r.reviews === 1 ? '' : 's' }} · {{ percent(r.cleanRate) }} ohne Nacharbeit
      </span>
      <span
        class="text-[11px] px-2 py-0.5 rounded shrink-0"
        :class="r.suggestedSampling === 1 ? 'bg-zinc-800 text-zinc-400' : 'bg-emerald-500/15 text-emerald-400'"
        :title="r.reviews < 20 ? 'Unter 20 Reviews gibt es keine belastbare Historie' : 'Vorschlag, keine Regel'"
      >Sampling {{ percent(r.suggestedSampling) }}</span>
    </div>
  </div>
  <p v-else class="text-zinc-500 py-8 text-center">
    Noch keine Reviews. Sobald Agenten PRs zur Entscheidung stellen, entsteht hier ihre Historie.
  </p>
</template>
