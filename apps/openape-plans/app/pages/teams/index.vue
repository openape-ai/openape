<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, loading: authLoading, fetchUser, logout } = useOpenApeAuth()

interface TeamListItem {
  id: string
  name: string
  description: string | null
  role: string
  member_count: number
  plan_count: number
  created_at: number
  updated_at: number
}

const teams = ref<TeamListItem[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await loadTeams()
})

async function loadTeams() {
  loading.value = true
  error.value = ''
  try {
    teams.value = await ($fetch as any)('/api/teams') as TeamListItem[]
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to load teams'
    teams.value = []
  }
  finally {
    loading.value = false
  }
}

function formatRelative(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
</script>

<template>
  <div class="min-h-dvh py-8 px-4">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            Teams
          </h1>
          <p v-if="user" class="text-sm text-gray-500">
            {{ user.sub }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton to="/teams/new" color="primary" icon="i-lucide-plus" size="sm">
            New team
          </UButton>
          <UButton color="neutral" variant="ghost" size="sm" @click="logout">
            Logout
          </UButton>
        </div>
      </div>

      <div v-if="authLoading || loading" class="text-center text-gray-500 mt-10">
        Loading…
      </div>

      <UAlert v-else-if="error" color="error" :title="error" class="mb-4" />

      <div v-else-if="teams.length === 0" class="text-center py-10 text-gray-500">
        <p class="mb-4">
          You are not in any teams yet.
        </p>
        <UButton to="/teams/new" color="primary" icon="i-lucide-plus">
          Create your first team
        </UButton>
      </div>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NuxtLink
          v-for="team in teams"
          :key="team.id"
          :to="`/teams/${team.id}`"
          class="block p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary hover:shadow-sm transition"
        >
          <div class="flex items-start justify-between">
            <div class="min-w-0 flex-1">
              <div class="font-semibold truncate">
                {{ team.name }}
              </div>
              <div v-if="team.description" class="text-sm text-gray-500 truncate mt-0.5">
                {{ team.description }}
              </div>
            </div>
            <UBadge :color="team.role === 'owner' ? 'primary' : 'neutral'" variant="subtle" size="xs">
              {{ team.role }}
            </UBadge>
          </div>
          <div class="flex items-center gap-3 mt-3 text-xs text-gray-500">
            <span class="flex items-center gap-1">
              <UIcon name="i-lucide-users" />
              {{ team.member_count }}
            </span>
            <span class="flex items-center gap-1">
              <UIcon name="i-lucide-file-text" />
              {{ team.plan_count }}
            </span>
            <span class="ml-auto">{{ formatRelative(team.updated_at) }}</span>
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
