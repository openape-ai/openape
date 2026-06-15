<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// Cost dashboard (B0 merge). Rolling 30-day spend vs the monthly budget the
// Owner set. The Sanierer writes daily roll-ups (M3); the Owner can seed test
// data via the API. Read-only view here.
const props = defineProps<{ orgId: string, budgetEur: number }>()

interface Snapshot { day: string, tokensIn: number, tokensOut: number, inferenceCostCents: number, infraCostCents: number, outputArtifactsCount: number }

const snaps = ref<Snapshot[]>([])
const loading = ref(true)

const totalCents = computed(() => snaps.value.reduce((s, r) => s + r.inferenceCostCents + r.infraCostCents, 0))
const spentEur = computed(() => totalCents.value / 100)
const burnPct = computed(() => props.budgetEur > 0 ? Math.min(100, Math.round((spentEur.value / props.budgetEur) * 100)) : 0)
const burnColor = computed(() => burnPct.value > 80 ? 'bg-red-500' : burnPct.value > 50 ? 'bg-amber-500' : 'bg-emerald-500')
const maxDayCents = computed(() => Math.max(1, ...snaps.value.map(r => r.inferenceCostCents + r.infraCostCents)))

function eur(cents: number) { return (cents / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' }) }

async function load() {
  loading.value = true
  snaps.value = await ($fetch as any)(`/api/orgs/${props.orgId}/cost-snapshots`)
  loading.value = false
}
watch(() => props.orgId, load, { immediate: true })
</script>

<template>
  <div>
    <div v-if="loading" class="text-zinc-500 py-10 text-center">
      Lädt …
    </div>
    <template v-else>
      <div class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 mb-6">
        <div class="flex items-end justify-between mb-3">
          <div>
            <p class="text-xs uppercase tracking-wider text-zinc-500">
              Ausgaben (30 Tage)
            </p>
            <p class="text-3xl font-bold mt-1">
              {{ eur(totalCents) }}
            </p>
          </div>
          <p class="text-sm text-zinc-500">
            von {{ budgetEur.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' }) }} / Monat
          </p>
        </div>
        <div class="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
          <div class="h-full rounded-full transition-all" :class="burnColor" :style="{ width: `${burnPct}%` }" />
        </div>
        <p class="text-xs text-zinc-500 mt-2">
          {{ burnPct }}% des Budgets verbraucht
        </p>
      </div>

      <p v-if="!snaps.length" class="text-zinc-500 py-6 text-center">
        Noch keine Kostendaten.
      </p>
      <div v-else class="space-y-1">
        <div v-for="r in snaps" :key="r.day" class="flex items-center gap-3">
          <span class="text-xs text-zinc-500 w-20 shrink-0">{{ r.day }}</span>
          <div class="flex-1 h-4 rounded bg-zinc-800/60 overflow-hidden">
            <div class="h-full bg-primary-500/60 rounded" :style="{ width: `${Math.round(((r.inferenceCostCents + r.infraCostCents) / maxDayCents) * 100)}%` }" />
          </div>
          <span class="text-xs text-zinc-400 w-20 text-right shrink-0">{{ eur(r.inferenceCostCents + r.infraCostCents) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
