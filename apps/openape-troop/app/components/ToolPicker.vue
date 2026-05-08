<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface ToolEntry {
  name: string
  description: string
  inputs: string
  risk: 'low' | 'medium' | 'high'
}

defineProps<{ disabled?: boolean }>()
const model = defineModel<string[]>({ default: () => [] })
const catalog = ref<ToolEntry[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const res = await ($fetch as any)('/api/tool-catalog') as { tools: ToolEntry[] }
    catalog.value = res.tools
  }
  catch (err: any) {
    error.value = err?.message ?? 'failed to load tool catalog'
  }
  finally {
    loading.value = false
  }
})

function toggle(name: string) {
  const i = model.value.indexOf(name)
  if (i >= 0) model.value = model.value.filter(n => n !== name)
  else model.value = [...model.value, name]
}

const selectedSet = computed(() => new Set(model.value))

const riskColor: Record<ToolEntry['risk'], 'success' | 'warning' | 'error'> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
}
</script>

<template>
  <div class="space-y-2">
    <p v-if="loading" class="text-sm text-muted">
      Loading tools…
    </p>
    <p v-else-if="error" class="text-sm text-error">
      {{ error }}
    </p>
    <div v-else class="space-y-1.5">
      <button
        v-for="tool in catalog"
        :key="tool.name"
        type="button"
        class="w-full text-left p-2.5 rounded-md border border-(--ui-border) bg-(--ui-bg) hover:bg-(--ui-bg-elevated) flex items-start gap-3 transition-colors"
        :class="{ 'ring-2 ring-(--ui-color-primary-500)': selectedSet.has(tool.name) }"
        :disabled="disabled"
        @click="toggle(tool.name)"
      >
        <UCheckbox
          :model-value="selectedSet.has(tool.name)"
          class="mt-0.5 pointer-events-none"
        />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <code class="font-mono text-sm">{{ tool.name }}</code>
            <UBadge :color="riskColor[tool.risk]" variant="subtle" size="xs">
              {{ tool.risk }}
            </UBadge>
          </div>
          <p class="text-xs text-muted mt-0.5">
            {{ tool.description }}
          </p>
        </div>
      </button>
    </div>
  </div>
</template>
