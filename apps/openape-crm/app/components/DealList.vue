<script setup lang="ts">
import type { Phase } from '#shared/pipelines'
import type { Deal } from '../utils/board'
import { computed } from 'vue'
import { groupByStufe, PIPELINES } from '#shared/pipelines'
import { formatEuro } from '../utils/board'

const props = defineProps<{
  deals: Deal[]
  phase: Phase
  selectedId: string | null
}>()
const emit = defineEmits<{
  phase: [phase: Phase]
  open: [deal: Deal]
}>()

const groups = computed(() => groupByStufe(props.deals.filter(d => d.phase === props.phase), props.phase))
</script>

<template>
  <div class="flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-r border-[var(--crm-line)] bg-[var(--crm-panel)]">
    <header class="border-b border-[var(--crm-line)] px-3.5 py-3">
      <h2 class="mb-2.5 flex items-center text-[13px] font-semibold">
        Vorgänge
        <span class="ms-auto text-[11px] text-[var(--crm-ink-3)]">⌘K</span>
      </h2>
      <div class="flex rounded-[7px] border border-[var(--crm-line)] bg-[#0b0d12] p-0.5">
        <button
          v-for="(p, id) in PIPELINES"
          :key="id"
          type="button"
          class="flex-1 rounded-[5px] py-1 text-xs"
          :class="phase === id ? 'on bg-[var(--crm-panel-2)] text-[var(--crm-ink)] shadow' : 'text-[var(--crm-ink-3)]'"
          @click="emit('phase', id as Phase)"
        >
          {{ p.label }}
        </button>
      </div>
    </header>
    <div class="flex-1 overflow-auto p-1.5">
      <template v-for="group in groups" :key="group.stufe.id">
        <div class="flex items-center gap-1.5 px-2 pt-3 pb-1 text-[10.5px] uppercase tracking-wide text-[var(--crm-ink-3)]">
          {{ group.stufe.label }}
          <span v-if="group.stufe.endmarker" class="rounded-full border border-[rgba(124,108,255,.35)] bg-[var(--crm-accent-soft)] px-1.5 text-[var(--crm-accent-2)] normal-case tracking-normal">Endmarker</span>
          <b class="ms-auto font-medium">{{ group.items.length }}</b>
        </div>
        <button
          v-for="deal in group.items"
          :key="deal.id"
          type="button"
          class="w-full rounded-[7px] border px-2.5 py-2 text-start"
          :class="selectedId === deal.id ? 'on border-[rgba(124,108,255,.3)] bg-[var(--crm-accent-soft)]' : 'border-transparent hover:bg-[var(--crm-panel-2)]'"
          @click="emit('open', deal)"
        >
          <b class="block font-medium tracking-tight">{{ deal.org_name || deal.title }}</b>
          <div class="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-[var(--crm-ink-3)]">
            {{ deal.people[0]?.name || deal.contact_name || deal.title }}
            <span v-if="deal.value_cents" class="rounded-full border border-[var(--crm-line-2)] px-1.5 text-[var(--crm-ink-2)]">{{ formatEuro(deal.value_cents) }}</span>
          </div>
        </button>
      </template>
      <p v-if="!groups.length" class="p-3.5 text-[var(--crm-ink-3)]">
        Keine Vorgänge in dieser Phase.
      </p>
    </div>
  </div>
</template>
