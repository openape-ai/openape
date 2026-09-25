<script setup lang="ts">
import { ref, watch } from 'vue'
import { issueError } from '../utils/issue-ui'

defineProps<{ label?: string, disabled?: boolean }>()
const body = defineModel<string>({ required: true })
const preview = ref(false)
const html = ref('')
const error = ref('')
const loading = ref(false)
watch(body, () => { preview.value = false })
async function showPreview() {
  loading.value = true
  error.value = ''
  try {
    const result = await $fetch<{ bodyHtml: string }>('/api/issue-preview', { method: 'POST', body: { body: body.value } })
    html.value = result.bodyHtml
    preview.value = true
  }
  catch (err) { error.value = issueError(err) }
  finally { loading.value = false }
}
</script>

<template>
  <div class="issue-editor border border-zinc-800 rounded-lg overflow-hidden">
    <div class="flex gap-2 bg-zinc-900 p-2 border-b border-zinc-800">
      <UButton size="sm" color="neutral" :variant="!preview ? 'soft' : 'ghost'" :aria-pressed="!preview" @click="preview = false">
        Write
      </UButton>
      <UButton size="sm" color="neutral" :variant="preview ? 'soft' : 'ghost'" :aria-pressed="preview" :loading="loading" @click="showPreview">
        Preview
      </UButton>
    </div>
    <div class="p-3">
      <UAlert v-if="error" color="error" :title="error" />
      <IssueMarkdown v-if="preview" :html="html" />
      <label v-else class="block text-sm text-zinc-400">
        {{ label || 'Description' }}
        <UTextarea v-model="body" :aria-label="label || 'Description'" :disabled="disabled" :rows="7" class="w-full mt-2" placeholder="Markdown supported. Describe what happened and what you expected." />
      </label>
    </div>
    <p class="px-3 pb-3 text-xs text-zinc-500">
      Markdown supported. Remote images are shown as links.
    </p>
  </div>
</template>
