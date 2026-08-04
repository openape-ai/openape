<script setup lang="ts">
import type { Metrics } from '../utils/attention-metrics'

// These three measure the human, not the machine. If the wait time climbs,
// the bottleneck is the owner; if the autonomy rate falls, the specs are thin;
// if the rework rate climbs, the specs are wrong.
defineProps<{ metrics: Metrics }>()

function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 90) return `${seconds} s`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h`
  return `${Math.round(seconds / 86400)} d`
}

function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)} %`
}
</script>

<template>
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <div class="rounded-lg bg-zinc-900/60 px-4 py-3">
      <div class="text-xs text-zinc-500">
        Wartezeit auf dich
      </div>
      <div class="text-xl font-medium mt-1">
        {{ duration(metrics.medianWaitSeconds) }}
      </div>
      <div class="text-[11px] text-zinc-600 mt-0.5">
        Median, ohne Fristablauf
      </div>
    </div>
    <div class="rounded-lg bg-zinc-900/60 px-4 py-3">
      <div class="text-xs text-zinc-500">
        Autonomie-Quote
      </div>
      <div class="text-xl font-medium mt-1">
        {{ percent(metrics.autonomyRate) }}
      </div>
      <div class="text-[11px] text-zinc-600 mt-0.5">
        geliefert ohne Rückfrage
      </div>
    </div>
    <div class="rounded-lg bg-zinc-900/60 px-4 py-3">
      <div class="text-xs text-zinc-500">
        Nacharbeit-Rate
      </div>
      <div class="text-xl font-medium mt-1">
        {{ percent(metrics.reworkRate) }}
      </div>
      <div class="text-[11px] text-zinc-600 mt-0.5">
        Verdicts, die zurückgingen
      </div>
    </div>
    <div class="rounded-lg bg-zinc-900/60 px-4 py-3">
      <div class="text-xs text-zinc-500">
        Entschieden
      </div>
      <div class="text-xl font-medium mt-1">
        {{ metrics.answered }}
      </div>
      <div class="text-[11px] text-zinc-600 mt-0.5">
        {{ metrics.openNow }} offen
      </div>
    </div>
  </div>
</template>
