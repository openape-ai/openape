<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ScopeSlotEditor from './ScopeSlotEditor.vue'
import type { ResolvedCommand } from '../composables/useShapeResolver'

export interface ScopeSlot {
  resource: string
  selectorKey: string
  mode: 'literal' | 'any' | 'pattern'
  value: string
  initialLiteral: string
}

const props = defineProps<{
  resolved: ResolvedCommand
}>()

const emit = defineEmits<{
  (e: 'update', slots: ScopeSlot[]): void
}>()

function seedSlotsFromResolved(r: ResolvedCommand): ScopeSlot[] {
  const slots: ScopeSlot[] = []
  for (const ref of r.detail.resource_chain) {
    const selector = ref.selector ?? {}
    const keys = Object.keys(selector)
    if (keys.length === 0) {
      slots.push({ resource: ref.resource, selectorKey: 'name', mode: 'any', value: '', initialLiteral: '' })
      continue
    }
    for (const key of keys) {
      const literal = String(selector[key] ?? '')
      slots.push({
        resource: ref.resource,
        selectorKey: key,
        mode: 'literal',
        value: literal,
        initialLiteral: literal,
      })
    }
  }
  return slots
}

const slots = ref<ScopeSlot[]>(seedSlotsFromResolved(props.resolved))

watch(() => props.resolved, (r) => {
  slots.value = seedSlotsFromResolved(r)
}, { deep: false })

watch(slots, (v) => {
  emit('update', v.map(s => ({ ...s })))
}, { deep: true, immediate: true })

function onSlotUpdate(i: number, ref: { resource: string, selector?: Record<string, string> }) {
  const slot = slots.value[i]
  if (!slot) return
  if (!ref.selector) {
    slot.mode = 'any'
    slot.value = ''
  }
  else {
    const v = ref.selector[slot.selectorKey] ?? ''
    slot.value = v
    if (v.includes('*')) slot.mode = 'pattern'
    else slot.mode = 'literal'
  }
}

const samplesForSlot = computed(() => {
  // Derive one or two example values from the resolved command so pattern-mode
  // can preview whether the current glob would match the user's typed example.
  const out: Record<number, string[]> = {}
  for (let i = 0; i < slots.value.length; i++) {
    const slot = slots.value[i]!
    out[i] = slot.initialLiteral ? [slot.initialLiteral] : []
  }
  return out
})
</script>

<template>
  <div class="space-y-3">
    <div>
      <label class="text-sm text-gray-300 font-medium">Scope</label>
      <p class="text-xs text-gray-500 mt-1">
        Pro Slot wählen: <code>Literal</code> (exakt), <code>Any</code> (Wildcard) oder <code>Pattern</code> (glob mit <code>*</code>).
      </p>
    </div>

    <div v-if="slots.length === 0" class="text-sm text-gray-500 italic">
      Kein Slot — dieser Command hat keine scoped Parameter. Er wird für die gesamte CLI-Klasse pre-authorisiert.
    </div>

    <ScopeSlotEditor
      v-for="(slot, i) in slots"
      :key="`${i}-${slot.resource}-${slot.selectorKey}`"
      :resource="slot.resource"
      :selector-key="slot.selectorKey"
      :initial-mode="slot.mode"
      :initial-value="slot.initialLiteral"
      :samples="samplesForSlot[i]"
      @update="onSlotUpdate(i, $event)"
    />
  </div>
</template>
