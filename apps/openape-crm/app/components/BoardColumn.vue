<script setup lang="ts">
import type { Column, Deal } from '../utils/board'
import { STAGE_LABELS } from '#shared/stages'
import { formatEuro } from '../utils/board'

defineProps<{ column: Column }>()
const emit = defineEmits<{
  dropOn: [beforeId: string | null]
  dragCard: [dealId: string]
  open: [deal: Deal]
  move: [deal: Deal, stage: string]
}>()
</script>

<template>
  <section
    class="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-zinc-900/40 p-3"
    @dragover.prevent
    @drop.prevent="emit('dropOn', null)"
  >
    <header class="flex items-baseline justify-between">
      <h2 class="font-semibold">
        {{ STAGE_LABELS[column.stage] }}
      </h2>
      <span class="text-xs text-zinc-400">
        {{ column.deals.length }} · {{ formatEuro(column.totalCents) }}
      </span>
    </header>

    <DealCard
      v-for="deal in column.deals"
      :key="deal.id"
      :deal="deal"
      draggable="true"
      @dragstart="emit('dragCard', deal.id)"
      @drop.prevent.stop="emit('dropOn', deal.id)"
      @open="emit('open', deal)"
      @move="emit('move', deal, $event)"
    />

    <p v-if="!column.deals.length" class="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-600">
      Karte hierher ziehen
    </p>
  </section>
</template>
