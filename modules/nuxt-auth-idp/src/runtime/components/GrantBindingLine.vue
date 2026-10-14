<script setup lang="ts">
import type { BindingLine } from '../utils/grant-card'

defineProps<{ line: BindingLine }>()
</script>

<template>
  <p v-if="line.kind === 'registry'" class="font-semibold break-words" data-binding-line="registry">
    {{ line.text }}
  </p>
  <div v-else class="flex items-start gap-2">
    <code class="block min-w-0 flex-1 font-mono text-xs bg-default text-green-400 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-words" :data-binding-line="line.kind">{{ line.text }}</code>
    <UBadge v-if="line.shell" color="neutral" variant="outline" size="xs" :label="`via ${line.shell}`" />
  </div>
</template>
