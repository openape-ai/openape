<script setup lang="ts">
import type { AgentRecord } from '../utils/attention-metrics'

// The sampling rate is a suggestion the page shows — nothing acts on it.
// That is the point: trust is earned in public, and only the owner decides
// whether to spend it.
defineProps<{ records: AgentRecord[] }>()

const { t } = useI18n()

function percent(rate: number): string {
  return t('inbox.percent', { value: Math.round(rate * 100) })
}
</script>

<template>
  <div v-if="records.length" class="rounded-xl border border-zinc-800 overflow-hidden">
    <div
      v-for="r in records" :key="r.agent"
      class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-3 border-b border-zinc-800 last:border-b-0"
    >
      <span class="min-w-0 flex-1 truncate text-sm font-mono">{{ r.agent }}</span>
      <span class="text-xs text-zinc-400 sm:shrink-0">
        {{ t('records.summary', { count: r.reviews, rate: percent(r.cleanRate) }, r.reviews) }}
      </span>
      <span
        class="text-[11px] px-2 py-0.5 rounded self-start sm:shrink-0"
        :class="r.suggestedSampling === 1 ? 'bg-zinc-800 text-zinc-400' : 'bg-emerald-500/15 text-emerald-400'"
        :title="r.reviews < 20 ? t('records.samplingTitle.fresh') : t('records.samplingTitle.suggestion')"
      >{{ t('records.sampling', { rate: percent(r.suggestedSampling) }) }}</span>
    </div>
  </div>
  <p v-else class="text-zinc-400 py-8 text-center">
    {{ t('records.empty') }}
  </p>
</template>
