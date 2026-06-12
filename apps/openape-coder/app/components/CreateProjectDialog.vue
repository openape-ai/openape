<script setup lang="ts">
import { ref, watch } from 'vue'

const emit = defineEmits<{ created: [{ id: string, name: string }] }>()
const open = defineModel<boolean>('open', { default: false })

// Only a name is required — vision and repos are back-fillable on the project
// page (coder-projects criterion 2).
const name = ref('')
const submitting = ref(false)
const error = ref('')

watch(open, (now) => {
  if (!now) return
  name.value = ''
  error.value = ''
  submitting.value = false
})

async function submit() {
  if (!name.value.trim()) return
  submitting.value = true
  error.value = ''
  try {
    const res = await ($fetch as any)('/api/projects', { method: 'POST', body: { name: name.value.trim() } })
    emit('created', res)
    open.value = false
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Could not create the project.'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-md' }">
    <template #content>
      <div class="p-5 sm:p-6 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold">
              New project
            </h3>
            <p class="text-xs text-muted mt-1">
              You become the admin. Add the vision and repos afterwards.
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="open = false" />
        </div>

        <UFormField label="Project name" required>
          <UInput
            v-model="name"
            placeholder="e.g. Payments rewrite"
            size="lg"
            class="w-full"
            :ui="{ base: 'w-full' }"
            @keydown.enter="submit"
          />
        </UFormField>

        <UAlert v-if="error" color="error" :title="error" />

        <div class="flex justify-end gap-2">
          <UButton variant="ghost" :disabled="submitting" @click="open = false">
            Cancel
          </UButton>
          <UButton color="primary" :loading="submitting" :disabled="!name.trim()" icon="i-lucide-plus" @click="submit">
            Create project
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
