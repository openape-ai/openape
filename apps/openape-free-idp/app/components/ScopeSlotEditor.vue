<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { previewMatches } from '../utils/glob-preview'

type Mode = 'literal' | 'any' | 'pattern'

interface ResourceRef {
  resource: string
  selector?: Record<string, string>
}

const props = defineProps<{
  resource: string
  /** The key inside the selector this editor manages (e.g. 'path', 'name'). */
  selectorKey: string
  /** Initial mode on mount. */
  initialMode?: Mode
  /** Initial literal/pattern value (ignored in 'any' mode). */
  initialValue?: string
  /** Optional sample values to live-preview glob matches against. */
  samples?: string[]
  /** Disabled state (while network request in flight). */
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', value: ResourceRef): void
}>()

const mode = ref<Mode>(props.initialMode ?? 'literal')
const value = ref<string>(props.initialValue ?? '')

const patternPreview = computed(() => {
  if (mode.value !== 'pattern' || !value.value || !props.samples?.length) return []
  return previewMatches(value.value, props.samples).slice(0, 4)
})

function build(): ResourceRef {
  if (mode.value === 'any') {
    return { resource: props.resource }
  }
  return {
    resource: props.resource,
    selector: { [props.selectorKey]: value.value },
  }
}

watch([mode, value], () => {
  emit('update', build())
}, { immediate: false })

function setMode(next: Mode) {
  if (next === mode.value) return
  mode.value = next
  if (next === 'any') value.value = ''
}

const inputPlaceholder = computed(() =>
  mode.value === 'pattern'
    ? 'e.g. /Users/me/*  oder  open*'
    : `${props.selectorKey} …`,
)
</script>

<template>
  <div class="p-3 rounded-lg border border-gray-700 bg-gray-800/60 space-y-2">
    <div class="flex items-center justify-between gap-2">
      <div class="text-xs text-gray-400 font-mono">
        {{ resource }}<span v-if="mode !== 'any'">.{{ selectorKey }}</span>
      </div>
      <div class="inline-flex rounded-md bg-gray-900 p-0.5 text-xs">
        <button
          v-for="m in (['literal', 'any', 'pattern'] as Mode[])"
          :key="m"
          type="button"
          :disabled="disabled"
          class="px-2.5 py-1 rounded min-h-[32px] min-w-[44px]"
          :class="mode === m ? 'bg-primary text-white' : 'text-gray-400 hover:text-gray-200'"
          @click="setMode(m)"
        >
          {{ m === 'literal' ? 'Literal' : m === 'any' ? 'Any' : 'Pattern' }}
        </button>
      </div>
    </div>

    <UInput
      v-if="mode !== 'any'"
      v-model="value"
      :placeholder="inputPlaceholder"
      :disabled="disabled"
      size="md"
      class="font-mono"
    />

    <div v-if="mode === 'pattern' && patternPreview.length > 0" class="text-xs space-y-1">
      <div class="text-gray-500">
        Beispiel-Matches:
      </div>
      <div
        v-for="row in patternPreview"
        :key="row.sample"
        class="flex items-center gap-2"
      >
        <UIcon
          :name="row.matches ? 'i-lucide-check' : 'i-lucide-x'"
          :class="row.matches ? 'text-green-500' : 'text-red-500'"
        />
        <code class="font-mono text-gray-300 break-all">{{ row.sample }}</code>
      </div>
    </div>

    <div v-if="mode === 'any'" class="text-xs text-gray-500 italic">
      Wildcard — matcht jeden Wert für dieses Feld.
    </div>
  </div>
</template>
