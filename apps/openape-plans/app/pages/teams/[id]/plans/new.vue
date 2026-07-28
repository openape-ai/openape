<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser } = useOpenApeAuth()
const route = useRoute()
const teamId = computed(() => String(route.params.id))

const title = ref('')
const bodyMd = ref('')
const status = ref<'draft' | 'active' | 'done' | 'archived'>('draft')
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) await navigateTo('/login')
})

async function onSubmit() {
  if (!title.value.trim() || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const plan = await ($fetch as any)(`/api/teams/${teamId.value}/plans`, {
      method: 'POST',
      body: { title: title.value.trim(), body_md: bodyMd.value, status: status.value },
    }) as { id: string }
    await navigateTo(`/teams/${teamId.value}/plans/${plan.id}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to create plan'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh py-8 px-4">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">
          New plan
        </h1>
        <UButton :to="`/teams/${teamId}`" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm" />
      </div>

      <UCard>
        <form class="space-y-4" @submit.prevent="onSubmit">
          <UFormField label="Title" required>
            <UInput
              v-model="title"
              size="lg"
              placeholder="Migrate auth to DDISA"
              class="w-full"
              maxlength="200"
              required
            />
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

          <UFormField label="Body (Markdown)" help="Optional. You can start empty and edit later.">
            <UTextarea
              v-model="bodyMd"
              :rows="10"
              placeholder="# Overview&#10;&#10;- Goal: ...&#10;- Approach: ..."
              class="w-full font-mono text-sm"
            />
          </UFormField>

          <UAlert v-if="error" color="error" :title="error" @close="error = ''" />

          <div class="flex gap-2 pt-2">
            <UButton
              type="submit"
              color="primary"
              :loading="submitting"
              :disabled="!title.trim() || submitting"
            >
              Create plan
            </UButton>
            <UButton :to="`/teams/${teamId}`" color="neutral" variant="ghost">
              Cancel
            </UButton>
          </div>
        </form>
      </UCard>
    </div>
  </div>
</template>
