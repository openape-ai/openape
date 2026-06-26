<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser } = useOpenApeAuth()

const name = ref('')
const description = ref('')
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
  }
})

async function onSubmit() {
  if (!name.value.trim() || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const team = await ($fetch as any)('/api/teams', {
      method: 'POST',
      body: { name: name.value.trim(), description: description.value.trim() || undefined },
    }) as { id: string }
    await navigateTo(`/teams/${team.id}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to create team'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh py-8 px-4">
    <div class="max-w-md mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">
          New team
        </h1>
        <UButton to="/teams" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm" />
      </div>

      <UCard>
        <form class="space-y-4" @submit.prevent="onSubmit">
          <UFormField label="Name" required>
            <UInput
              v-model="name"
              size="lg"
              placeholder="Delta Mind"
              class="w-full"
              maxlength="120"
              required
            />
          </UFormField>

          <UFormField label="Description" help="Optional. Max 500 characters.">
            <UTextarea
              v-model="description"
              :rows="3"
              placeholder="What this team works on"
              class="w-full"
              maxlength="500"
            />
          </UFormField>

          <UAlert v-if="error" color="error" :title="error" @close="error = ''" />

          <div class="flex gap-2 pt-2">
            <UButton
              type="submit"
              color="primary"
              :loading="submitting"
              :disabled="!name.trim() || submitting"
            >
              Create team
            </UButton>
            <UButton to="/teams" color="neutral" variant="ghost">
              Cancel
            </UButton>
          </div>
        </form>
      </UCard>
    </div>
  </div>
</template>
