<script setup lang="ts">
import type { Metrics } from '../utils/attention-metrics'

// These three measure the human, not the machine. If the wait time climbs,
// the bottleneck is the owner; if the autonomy rate falls, the specs are thin;
// if the rework rate climbs, the specs are wrong.
defineProps<{ metrics: Metrics }>()

const { t } = useI18n()

function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 90) return t('inbox.duration.seconds', { value: seconds })
  if (seconds < 5400) return t('inbox.duration.minutes', { value: Math.round(seconds / 60) })
  if (seconds < 172800) return t('inbox.duration.hours', { value: Math.round(seconds / 3600) })
  return t('inbox.duration.days', { value: Math.round(seconds / 86400) })
}

function percent(rate: number | null): string {
  return rate === null ? '—' : t('inbox.percent', { value: Math.round(rate * 100) })
}
</script>

<template>
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <div class="rounded-lg bg-zinc-900/60 px-4 py-3">
      <div class="text-xs text-zinc-400">
        {{ t('inbox.metrics.wait.label') }}
      </div>
      <div class="text-xl font-medium mt-1">
        {{ duration(metrics.medianWaitSeconds) }}
      </div>
      <div class="text-[11px] text-zinc-400 mt-0.5">
        {{ t('inbox.metrics.wait.hint') }}
      </div>
    </div>
    <div class="rounded-lg bg-zinc-900/60 px-4 py-3">
      <div class="text-xs text-zinc-400">
        {{ t('inbox.metrics.autonomy.label') }}
      </div>
      <div class="text-xl font-medium mt-1">
        {{ percent(metrics.autonomyRate) }}
      </div>
      <div class="text-[11px] text-zinc-400 mt-0.5">
        {{ t('inbox.metrics.autonomy.hint') }}
      </div>
    </div>
    <div class="rounded-lg bg-zinc-900/60 px-4 py-3">
      <div class="text-xs text-zinc-400">
        {{ t('inbox.metrics.rework.label') }}
      </div>
      <div class="text-xl font-medium mt-1">
        {{ percent(metrics.reworkRate) }}
      </div>
      <div class="text-[11px] text-zinc-400 mt-0.5">
        {{ t('inbox.metrics.rework.hint') }}
      </div>
    </div>
    <div class="rounded-lg bg-zinc-900/60 px-4 py-3">
      <div class="text-xs text-zinc-400">
        {{ t('inbox.metrics.answered.label') }}
      </div>
      <div class="text-xl font-medium mt-1">
        {{ metrics.answered }}
      </div>
      <div class="text-[11px] text-zinc-400 mt-0.5">
        {{ t('inbox.metrics.answered.hint', { count: metrics.openNow }) }}
      </div>
    </div>
  </div>
</template>
