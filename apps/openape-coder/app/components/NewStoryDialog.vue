<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ created: [{ id: string }] }>()
const open = defineModel<boolean>('open', { default: false })

// Only title + story sentence are required — the rest is back-fillable on the
// story page (coder-user-stories §2).
const title = ref('')
const storySentence = ref('')
const submitting = ref(false)
const error = ref('')

watch(open, (now) => {
  if (!now) return
  title.value = ''
  storySentence.value = ''
  error.value = ''
  submitting.value = false
})

async function submit() {
  if (!title.value.trim() || !storySentence.value.trim()) return
  submitting.value = true
  error.value = ''
  try {
    const res = await ($fetch as any)(`/api/projects/${props.projectId}/stories`, {
      method: 'POST',
      body: { title: title.value.trim(), storySentence: storySentence.value.trim() },
    })
    emit('created', res)
    open.value = false
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Could not create the story.'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-lg' }">
    <template #content>
      <div class="p-5 sm:p-6 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold">
              New story
            </h3>
            <p class="text-xs text-muted mt-1">
              Capture the essentials now — add criteria, repos and links later.
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="open = false" />
        </div>

        <UFormField label="Title" required>
          <UInput v-model="title" placeholder="e.g. Bulk export of invoices" size="lg" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>

        <UFormField label="Story" required description="As … I want to … so that …">
          <UTextarea
            v-model="storySentence"
            :rows="3"
            autoresize
            placeholder="As an accountant I want to export all invoices at once so that I can file them in one step."
            class="w-full"
            :ui="{ base: 'w-full' }"
          />
        </UFormField>

        <UAlert v-if="error" color="error" :title="error" />

        <div class="flex justify-end gap-2">
          <UButton variant="ghost" :disabled="submitting" @click="open = false">
            Cancel
          </UButton>
          <UButton
            color="primary"
            :loading="submitting"
            :disabled="!title.trim() || !storySentence.trim()"
            icon="i-lucide-plus"
            @click="submit"
          >
            Create story
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
