<script setup lang="ts">
import type { Outcome, PipelineStage } from '#shared/stages'
import { computed, nextTick, ref } from 'vue'
import { MAX_STAGE_NAME } from '#shared/stages'

const props = defineProps<{
  stage: PipelineStage
  count: number
  total: string
  /** Number of stages — the ends of the pipeline must not move any further. */
  stageCount: number
  editable: boolean
}>()

const emit = defineEmits<{
  rename: [name: string]
  outcome: [value: Outcome]
  move: [position: number]
  insertAfter: []
  remove: []
}>()

const renaming = ref(false)
const draft = ref('')
const input = ref<{ inputRef?: HTMLInputElement } | null>(null)

async function startRename() {
  if (!props.editable) return
  draft.value = props.stage.name
  renaming.value = true
  await nextTick()
  input.value?.inputRef?.select()
}

function commit() {
  // Enter closes the field and fires `blur` on the way out — without this guard
  // liefe das Umbenennen zweimal.
  if (!renaming.value) return
  renaming.value = false
  const name = draft.value.trim()
  if (name && name !== props.stage.name) emit('rename', name)
}

const OUTCOME_LABELS: Record<Outcome, string> = {
  open: 'Offen',
  won: 'Gewonnen',
  lost: 'Verloren',
}

const menu = computed(() => [
  (['open', 'won', 'lost'] as Outcome[]).map(outcome => ({
    label: `Ergebnis: ${OUTCOME_LABELS[outcome]}`,
    icon: outcome === props.stage.outcome ? 'i-lucide-check' : 'i-lucide-dot',
    onSelect: () => emit('outcome', outcome),
  })),
  [
    { label: 'Umbenennen', icon: 'i-lucide-pencil', onSelect: () => void startRename() },
    {
      label: 'Nach links',
      icon: 'i-lucide-arrow-left',
      disabled: props.stage.position === 0,
      onSelect: () => emit('move', props.stage.position - 1),
    },
    {
      label: 'Nach rechts',
      icon: 'i-lucide-arrow-right',
      disabled: props.stage.position >= props.stageCount - 1,
      onSelect: () => emit('move', props.stage.position + 1),
    },
    { label: 'Stufe danach einfügen', icon: 'i-lucide-plus', onSelect: () => emit('insertAfter') },
  ],
  [
    {
      label: 'Stufe löschen',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      disabled: props.stageCount === 1,
      onSelect: () => emit('remove'),
    },
  ],
])
</script>

<template>
  <header class="flex items-center justify-between gap-2">
    <UInput
      v-if="renaming"
      ref="input"
      v-model="draft"
      :maxlength="MAX_STAGE_NAME"
      size="sm"
      class="w-full"
      autofocus
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="renaming = false"
      @blur="commit"
    />

    <template v-else>
      <button
        type="button"
        class="min-w-0 truncate text-start font-semibold"
        :class="{ 'cursor-default': !editable }"
        :title="editable ? 'Klicken zum Umbenennen' : stage.name"
        @click="startRename"
      >
        {{ stage.name }}
      </button>

      <span class="shrink-0 text-xs text-zinc-400">
        {{ count }} · {{ total }}
      </span>

      <UDropdownMenu v-if="editable" :items="menu" :popper="{ placement: 'bottom-end' }">
        <button type="button" class="shrink-0 text-zinc-500 hover:text-zinc-200" aria-label="Stufe bearbeiten">
          <UIcon name="i-lucide-ellipsis-vertical" class="size-4" />
        </button>
      </UDropdownMenu>
    </template>
  </header>
</template>
