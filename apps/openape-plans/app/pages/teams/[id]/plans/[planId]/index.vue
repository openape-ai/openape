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
  team_id: string
  title: string
  body_md: string
  status: 'draft' | 'active' | 'done' | 'archived'
  owner_email: string
  created_at: number
  updated_at: number
  updated_by: string
  caller_role: 'owner' | 'editor' | 'viewer'
}

const plan = ref<Plan | null>(null)
const loading = ref(true)
const error = ref('')

const canEdit = computed(() => plan.value?.caller_role === 'owner' || plan.value?.caller_role === 'editor')
const canDelete = computed(() => {
  if (!plan.value || !user.value) return false
  const callerEmail = user.value.sub
  return plan.value.owner_email === callerEmail || plan.value.caller_role === 'owner'
})
const rendered = computed(() => plan.value ? renderMarkdown(plan.value.body_md) : '')

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
    plan.value = await ($fetch as any)(`/api/plans/${planId.value}`) as Plan
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to load plan'
    plan.value = null
  }
  finally {
    loading.value = false
  }
}

async function changeStatus(next: Plan['status']) {
  if (!plan.value || plan.value.status === next) return
  try {
    plan.value = await ($fetch as any)(`/api/plans/${planId.value}`, {
      method: 'PATCH',
      body: { status: next },
    }) as Plan
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to update status'
  }
}

async function deletePlan() {
  if (!plan.value) return
  if (!confirm(`Delete "${plan.value.title}"? This can only be undone from the DB.`)) return
  try {
    await ($fetch as any)(`/api/plans/${planId.value}`, { method: 'DELETE' })
    await navigateTo(`/teams/${teamId.value}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to delete plan'
  }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

function statusColor(s: Plan['status']): 'neutral' | 'primary' | 'success' | 'warning' {
  if (s === 'active') return 'primary'
  if (s === 'done') return 'success'
  if (s === 'archived') return 'warning'
  return 'neutral'
}
</script>

<template>
  <div class="min-h-dvh py-8 px-4 pb-24">
    <div class="max-w-3xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <UButton :to="`/teams/${teamId}`" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm">
          Team
        </UButton>
      </div>

      <div v-if="loading" class="text-center text-gray-500 mt-10">
        Loading…
      </div>

      <UAlert v-else-if="error" color="error" :title="error" />

      <div v-else-if="plan">
        <div class="flex items-start gap-3 mb-2">
          <h1 class="text-2xl font-bold flex-1 min-w-0 break-words">
            {{ plan.title }}
          </h1>
          <UBadge :color="statusColor(plan.status)" variant="subtle">
            {{ plan.status }}
          </UBadge>
        </div>
        <div class="text-sm text-gray-500 mb-6">
          Owner {{ plan.owner_email }} · Updated {{ formatDate(plan.updated_at) }} by {{ plan.updated_by }}
        </div>

        <div v-if="canEdit" class="flex flex-wrap gap-2 mb-6">
          <UButton
            v-for="s in (['draft', 'active', 'done', 'archived'] as const)"
            :key="s"
            :color="s === plan.status ? statusColor(s) : 'neutral'"
            :variant="s === plan.status ? 'soft' : 'ghost'"
            size="xs"
            @click="changeStatus(s)"
          >
            {{ s }}
          </UButton>
        </div>

        <article
          class="prose prose-neutral dark:prose-invert max-w-none"
          v-html="rendered"
        />

        <div v-if="!plan.body_md.trim()" class="text-gray-500 italic">
          This plan has no body yet.
        </div>
      </div>
    </div>

    <!-- Edit FAB -->
    <div v-if="plan && canEdit" class="fixed bottom-safe right-6 flex flex-col gap-2">
      <UButton
        v-if="canDelete"
        color="error"
        variant="solid"
        icon="i-lucide-trash-2"
        size="lg"
        class="rounded-full shadow-lg"
        @click="deletePlan"
      />
      <UButton
        :to="`/teams/${teamId}/plans/${planId}/edit`"
        color="primary"
        variant="solid"
        icon="i-lucide-pencil"
        size="lg"
        class="rounded-full shadow-lg"
      />
    </div>
  </div>
</template>
