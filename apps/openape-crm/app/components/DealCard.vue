<script setup lang="ts">
import type { Deal } from '../utils/board'
import { computed } from 'vue'
import { STAGE_LABELS, STAGES } from '#shared/stages'
import { formatEuro } from '../utils/board'

const props = defineProps<{ deal: Deal }>()
const emit = defineEmits<{ open: [], move: [stage: string] }>()

const subtitle = computed(() => [props.deal.contact_name, props.deal.org_name].filter(Boolean).join(' · '))
const closedOn = computed(() =>
  props.deal.closed_at ? new Date(props.deal.closed_at).toLocaleDateString('de-AT') : '',
)
const stageItems = STAGES.map(stage => ({ label: STAGE_LABELS[stage], value: stage }))
</script>

<template>
  <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-3 cursor-grab active:cursor-grabbing">
    <button type="button" class="w-full text-start" @click="emit('open')">
      <p class="font-medium leading-snug">
        {{ deal.title }}
      </p>
      <p class="mt-1 text-primary-400 text-sm">
        {{ formatEuro(deal.value_cents) }}
      </p>
      <p v-if="subtitle" class="mt-1 text-xs text-zinc-400">
        {{ subtitle }}
      </p>
      <p v-if="closedOn" class="mt-1 text-xs text-zinc-500">
        Abgeschlossen am {{ closedOn }}
      </p>
    </button>

    <!-- Am Handy gibt es kein HTML5-Drag: dort wird die Stufe umgeschaltet. -->
    <USelect
      :model-value="deal.stage"
      :items="stageItems"
      size="xs"
      class="mt-2 w-full sm:hidden"
      @update:model-value="emit('move', $event as string)"
    />
  </div>
</template>
