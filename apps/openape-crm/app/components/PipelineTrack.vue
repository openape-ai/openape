<script setup lang="ts">
import type { Phase } from '#shared/pipelines'
import { computed } from 'vue'
import { PIPELINES } from '#shared/pipelines'

const props = defineProps<{ phase: Phase, stufe: string }>()
const emit = defineEmits<{ select: [stufe: string] }>()

const stages = computed(() => PIPELINES[props.phase].stufen)
const currentIndex = computed(() => stages.value.findIndex(s => s.id === props.stufe))
</script>

<template>
  <div class="mx-[22px] mt-4 flex overflow-hidden rounded-[9px] border border-[var(--crm-line)] bg-[var(--crm-panel)]">
    <button
      v-for="(s, i) in stages"
      :key="s.id"
      type="button"
      class="relative min-w-0 flex-1 truncate border-r border-[var(--crm-line)] px-1.5 py-2 text-[11.5px] last:border-r-0"
      :class="[
        s.id === props.stufe ? 'on bg-[var(--crm-accent)] font-medium text-white' : '',
        i < currentIndex && s.id !== props.stufe ? 'done bg-[rgba(124,108,255,.06)] text-[var(--crm-ink-2)]' : '',
        s.id !== props.stufe && i >= currentIndex ? 'text-[var(--crm-ink-3)] hover:bg-[var(--crm-panel-2)] hover:text-[var(--crm-ink)]' : '',
        s.endmarker ? 'mark' : '',
      ]"
      @click="emit('select', s.id)"
    >
      {{ s.label }}
    </button>
  </div>
</template>
