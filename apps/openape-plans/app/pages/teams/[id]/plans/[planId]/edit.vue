<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'
import { renderMarkdown } from '~/utils/markdown'

const { user, fetchUser } = useOpenApeAuth()
const route = useRoute()
const teamId = computed(() => String(route.params.id))
const planId = computed(() => String(route.params.planId))

interface Plan {
  id: string
  title: string
  body_md: string
  status: 'draft' | 'active' | 'done' | 'archived'
  caller_role: 'owner' | 'editor' | 'viewer'
}

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const title = ref('')
const bodyMd = ref('')
const status = ref<Plan['status']>('draft')
const tab = ref<'write' | 'preview'>('write')
const rendered = computed(() => renderMarkdown(bodyMd.value))

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const plan = await ($fetch as any)(`/api/plans/${planId.value}`) as Plan
    if (plan.caller_role === 'viewer') {
      error.value = 'Viewers cannot edit plans'
      return
    }
    title.value = plan.title
    bodyMd.value = plan.body_md
    status.value = plan.status
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to load plan'
  }
  finally {
    loading.value = false
  }
}

async function onSave() {
  if (!title.value.trim() || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await ($fetch as any)(`/api/plans/${planId.value}`, {
      method: 'PATCH',
      body: { title: title.value.trim(), body_md: bodyMd.value, status: status.value },
    })
    await navigateTo(`/teams/${teamId.value}/plans/${planId.value}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to save'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh py-6 px-4">
    <div class="max-w-3xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-bold">
          Edit plan
        </h1>
        <UButton :to="`/teams/${teamId}/plans/${planId}`" color="neutral" variant="ghost" icon="i-lucide-x" size="sm" />
      </div>

      <div v-if="loading" class="text-center text-gray-500 mt-10">
        Loading…
      </div>

      <UAlert v-else-if="error" color="error" :title="error" />

      <form v-else class="space-y-4" @submit.prevent="onSave">
        <UFormField label="Title" required>
          <UInput v-model="title" size="lg" class="w-full" maxlength="200" required />
        </UFormField>

        <UFormField label="Status">
          <USelect
            v-model="status"
            :items="[
              { label: 'Draft', value: 'draft' },
              { label: 'Active', value: 'active' },
              { label: 'Done', value: 'done' },
              { label: 'Archived', value: 'archived' },
            ]"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <div>
          <div class="flex items-center gap-2 mb-2">
            <UButton
              type="button"
              :variant="tab === 'write' ? 'soft' : 'ghost'"
              size="xs"
              @click="tab = 'write'"
            >
              Write
            </UButton>
            <UButton
              type="button"
              :variant="tab === 'preview' ? 'soft' : 'ghost'"
              size="xs"
              @click="tab = 'preview'"
            >
              Preview
            </UButton>
          </div>

          <UTextarea
            v-if="tab === 'write'"
            v-model="bodyMd"
            :rows="18"
            placeholder="# Overview&#10;&#10;Write your plan in Markdown…"
            class="w-full font-mono text-sm"
          />
          <article
            v-else
            class="prose prose-neutral dark:prose-invert max-w-none p-4 border border-gray-200 dark:border-gray-700 rounded-lg min-h-[300px]"
            v-html="rendered"
          />
        </div>

        <div class="flex gap-2 pt-2 sticky bottom-0 bg-white dark:bg-gray-900 py-3 pb-safe -mx-4 px-4 border-t border-gray-200 dark:border-gray-800">
          <UButton type="submit" color="primary" :loading="saving" :disabled="!title.trim() || saving">
            Save
          </UButton>
          <UButton :to="`/teams/${teamId}/plans/${planId}`" color="neutral" variant="ghost">
            Cancel
          </UButton>
        </div>
      </form>
    </div>
  </div>
</template>
