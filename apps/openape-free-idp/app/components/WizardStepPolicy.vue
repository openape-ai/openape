<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export interface PolicyState {
  max_risk: 'low' | 'medium' | 'high' | 'critical'
  grant_type: 'always' | 'timed'
  duration?: number
  reason: string
}

const props = defineProps<{
  initial: PolicyState
  resolvedRisk?: 'low' | 'medium' | 'high' | 'critical'
}>()

const emit = defineEmits<{
  (e: 'update', value: PolicyState): void
}>()

const state = ref<PolicyState>({ ...props.initial })

watch(state, v => emit('update', { ...v }), { deep: true, immediate: true })

const riskOptions = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
] as const

const resolvedHint = computed(() => {
  if (!props.resolvedRisk) return ''
  return `Tipp: erkannte Risk-Stufe des Commands ist "${props.resolvedRisk}".`
})
</script>

<template>
  <div class="space-y-4">
    <div>
      <label class="text-sm text-gray-300 font-medium">Policy</label>
      <p class="text-xs text-gray-500 mt-1">
        Wie großzügig soll der Agent diese Commands ausführen dürfen?
      </p>
    </div>

    <div>
      <label class="text-xs text-gray-400 mb-1 block">Max Risk</label>
      <div class="inline-flex rounded-md bg-gray-900 p-0.5">
        <button
          v-for="r in riskOptions"
          :key="r.value"
          type="button"
          class="px-3 py-1.5 text-xs rounded min-w-[60px] min-h-[36px]"
          :class="state.max_risk === r.value ? 'bg-primary text-white' : 'text-gray-400 hover:text-gray-200'"
          @click="state.max_risk = r.value"
        >
          {{ r.label }}
        </button>
      </div>
      <p v-if="resolvedHint" class="text-xs text-gray-500 mt-1">
        {{ resolvedHint }}
      </p>
    </div>

    <div>
      <label class="text-xs text-gray-400 mb-1 block">Dauer</label>
      <div class="inline-flex rounded-md bg-gray-900 p-0.5">
        <button
          type="button"
          class="px-3 py-1.5 text-xs rounded min-w-[80px] min-h-[36px]"
          :class="state.grant_type === 'always' ? 'bg-primary text-white' : 'text-gray-400 hover:text-gray-200'"
          @click="state.grant_type = 'always'"
        >
          Immer
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs rounded min-w-[80px] min-h-[36px]"
          :class="state.grant_type === 'timed' ? 'bg-primary text-white' : 'text-gray-400 hover:text-gray-200'"
          @click="state.grant_type = 'timed'; state.duration = state.duration ?? 3600"
        >
          Zeitlich
        </button>
      </div>
    </div>

    <div v-if="state.grant_type === 'timed'">
      <label class="text-xs text-gray-400 mb-1 block">Dauer (Sekunden)</label>
      <UInput v-model.number="state.duration" type="number" :min="60" class="max-w-[200px]" />
    </div>

    <div>
      <label class="text-xs text-gray-400 mb-1 block">Grund (optional)</label>
      <UInput
        v-model="state.reason"
        placeholder="z.B. CI-Deploy, read-only Audit …"
        class="font-mono"
      />
    </div>
  </div>
</template>
