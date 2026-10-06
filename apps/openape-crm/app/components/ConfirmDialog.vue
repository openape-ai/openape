<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
  /** What the user loses — the reason for asking at all. */
  consequence: string
  confirmLabel?: string
}>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'confirm': [] }>()
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="max-w-sm space-y-4 p-6">
        <h2 class="text-lg font-semibold">
          {{ title }}
        </h2>
        <p class="text-sm text-zinc-400">
          {{ consequence }}
        </p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">
            Abbrechen
          </UButton>
          <UButton color="error" @click="emit('confirm')">
            {{ confirmLabel ?? 'Löschen' }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
