<script setup lang="ts">
import type { Outcome, PipelineStage } from '#shared/stages'
import type { Column, Deal } from '../utils/board'
import { computed } from 'vue'
import { formatEuro } from '../utils/board'

const props = defineProps<{
  column: Column
  stages: PipelineStage[]
  editable: boolean
}>()

const emit = defineEmits<{
  dropOn: [beforeId: string | null]
  dragCard: [dealId: string]
  open: [deal: Deal]
  move: [deal: Deal, stage: string]
  rename: [name: string]
  outcome: [value: Outcome]
  reposition: [position: number]
  insertAfter: []
  remove: []
}>()

/** Closing columns stand out — otherwise the end of the board looks like any other stage. */
const tone = computed(() => ({
  open: 'bg-zinc-900/40',
  won: 'bg-emerald-950/40 ring-1 ring-emerald-900/50',
  lost: 'bg-rose-950/30 ring-1 ring-rose-900/40',
}[props.column.stage.outcome]))
</script>

<template>
  <section
    class="flex w-72 shrink-0 flex-col gap-2 rounded-xl p-3"
    :class="tone"
    @dragover.prevent
    @drop.prevent="emit('dropOn', null)"
  >
    <StageHeader
      :stage="column.stage"
      :count="column.deals.length"
      :total="formatEuro(column.totalCents)"
      :stage-count="stages.length"
      :editable="editable"
      @rename="emit('rename', $event)"
      @outcome="emit('outcome', $event)"
      @move="emit('reposition', $event)"
      @insert-after="emit('insertAfter')"
      @remove="emit('remove')"
    />

    <DealCard
      v-for="deal in column.deals"
      :key="deal.id"
      :deal="deal"
      :stages="stages"
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
