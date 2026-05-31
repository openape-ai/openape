<script setup lang="ts">
import { computed } from 'vue'

interface CostSnapshot {
  orgId: string
  day: string
  tokensIn: number
  tokensOut: number
  inferenceCostCents: number
  infraCostCents: number
  outputArtifactsCount: number
  updatedAt: number
}

const props = defineProps<{
  snapshots: CostSnapshot[]
  budgetMonthlyEur: number
}>()

const { fmtDay } = useDateFormat()

// Roll-up across the 30-day window the API returned. Both costs counted
// in cents; convert to € for display.
const totalCents = computed(() =>
  props.snapshots.reduce((acc, s) => acc + s.inferenceCostCents + s.infraCostCents, 0),
)
const totalEur = computed(() => (totalCents.value / 100).toFixed(2))
const totalTokens = computed(() => props.snapshots.reduce((acc, s) => acc + s.tokensIn + s.tokensOut, 0))
const totalArtifacts = computed(() => props.snapshots.reduce((acc, s) => acc + s.outputArtifactsCount, 0))
const budgetCents = computed(() => props.budgetMonthlyEur * 100)
const burnRatio = computed(() => budgetCents.value > 0 ? totalCents.value / budgetCents.value : 0)
const burnPct = computed(() => Math.min(100, Math.round(burnRatio.value * 100)))

const ratioColor = computed(() => {
  if (burnPct.value < 50) return 'bg-emerald-500'
  if (burnPct.value < 80) return 'bg-amber-500'
  return 'bg-red-500'
})

// Output/Cost ratio (Sanierer's flagship metric): artifacts per €.
// Higher is better. 0 means we're paying without producing.
const efficiency = computed(() => {
  if (totalCents.value === 0) return null
  return (totalArtifacts.value / (totalCents.value / 100)).toFixed(2)
})

// 30-day stacked bar — each bar is a day, height proportional to that
// day's cost relative to max-day. Pure CSS, no chart library.
const maxDayCents = computed(() => {
  let max = 1
  for (const s of props.snapshots) max = Math.max(max, s.inferenceCostCents + s.infraCostCents)
  return max
})
// Reverse so oldest is on the left, newest on the right (chart-natural).
const orderedSnapshots = computed(() => [...props.snapshots].reverse())
</script>

<template>
  <div class="space-y-4">
    <!-- Budget meter — the headline gauge. Owner glances at this first. -->
    <UCard>
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs text-muted uppercase tracking-wide">
              {{ $t('cost.budget.heading') }}
            </p>
            <p class="text-2xl font-bold">
              {{ totalEur }} <span class="text-base font-normal text-muted">/ {{ budgetMonthlyEur }} €</span>
            </p>
            <p class="text-xs text-muted mt-1">
              {{ $t('cost.budget.window') }}
            </p>
          </div>
          <div class="text-right">
            <p class="text-3xl font-bold" :class="burnPct >= 100 ? 'text-red-400' : 'text-zinc-100'">
              {{ burnPct }}%
            </p>
            <p class="text-xs text-muted">
              {{ $t('cost.budget.burn') }}
            </p>
          </div>
        </div>

        <div class="h-3 rounded-full bg-(--ui-bg) overflow-hidden">
          <div class="h-full transition-all" :class="[ratioColor]" :style="{ width: `${burnPct}%` }" />
        </div>

        <p v-if="burnPct >= 80" class="text-xs text-amber-400">
          {{ burnPct >= 100 ? $t('cost.budget.overrun') : $t('cost.budget.warning') }}
        </p>
      </div>
    </UCard>

    <!-- KPI grid — secondary metrics. Two on mobile, four on sm+. -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <UCard :ui="{ body: 'p-3' }">
        <p class="text-[10px] text-muted uppercase tracking-wide">
          {{ $t('cost.kpi.tokens') }}
        </p>
        <p class="text-lg font-semibold mt-1">
          {{ (totalTokens / 1000).toFixed(1) }}k
        </p>
      </UCard>
      <UCard :ui="{ body: 'p-3' }">
        <p class="text-[10px] text-muted uppercase tracking-wide">
          {{ $t('cost.kpi.artifacts') }}
        </p>
        <p class="text-lg font-semibold mt-1">
          {{ totalArtifacts }}
        </p>
      </UCard>
      <UCard :ui="{ body: 'p-3' }">
        <p class="text-[10px] text-muted uppercase tracking-wide">
          {{ $t('cost.kpi.efficiency') }}
        </p>
        <p class="text-lg font-semibold mt-1">
          {{ efficiency ?? '—' }}<span v-if="efficiency" class="text-xs font-normal text-muted">/€</span>
        </p>
      </UCard>
      <UCard :ui="{ body: 'p-3' }">
        <p class="text-[10px] text-muted uppercase tracking-wide">
          {{ $t('cost.kpi.days') }}
        </p>
        <p class="text-lg font-semibold mt-1">
          {{ snapshots.length }}<span class="text-xs font-normal text-muted">/30</span>
        </p>
      </UCard>
    </div>

    <!-- Spend trend — 30-day bar chart. Empty state when no data. -->
    <UCard>
      <p class="text-sm font-semibold mb-3">
        {{ $t('cost.trend.title') }}
      </p>
      <div v-if="snapshots.length === 0" class="text-center py-10 text-sm text-muted">
        {{ $t('cost.trend.empty') }}
      </div>
      <div v-else class="flex items-end gap-1 h-32">
        <div
          v-for="s in orderedSnapshots"
          :key="s.day"
          class="flex-1 bg-blue-500/70 hover:bg-blue-400 transition-colors rounded-t cursor-help min-w-[6px]"
          :style="{ height: `${Math.max(2, ((s.inferenceCostCents + s.infraCostCents) / maxDayCents) * 100)}%` }"
          :title="`${fmtDay(s.day)}: ${((s.inferenceCostCents + s.infraCostCents) / 100).toFixed(2)} €`"
        />
      </div>
    </UCard>
  </div>
</template>
