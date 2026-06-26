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
  open_task_count: number
  total_task_count: number
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
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 pb-24">
    <div class="max-w-2xl mx-auto px-4 pt-6">
      <div class="flex items-center justify-between mb-6">
        <div class="min-w-0">
          <h1 class="text-2xl font-bold">
            My Lists
          </h1>
          <p v-if="user" class="text-sm text-zinc-500 truncate">
            {{ user.sub }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton to="/teams/new" color="primary" icon="i-lucide-plus" size="sm">
            New list
          </UButton>
          <UButton color="neutral" variant="ghost" size="sm" @click="logout">
            Logout
          </UButton>
        </div>
      </div>

      <div v-if="authLoading || loading" class="text-center text-zinc-500 mt-10">
        Loading…
      </div>

      <UAlert v-else-if="error" color="error" :title="error" class="mb-4" />

      <div v-else-if="teams.length === 0" class="text-center py-10 text-zinc-500">
        <UIcon name="i-lucide-list-checks" class="size-10 mx-auto mb-3 opacity-40" />
        <p class="mb-4">
          No lists yet.
        </p>
        <UButton to="/teams/new" color="primary" icon="i-lucide-plus">
          Create your first list
        </UButton>
      </div>

      <ul v-else class="divide-y divide-zinc-900">
        <li v-for="team in teams" :key="team.id">
          <NuxtLink
            :to="`/teams/${team.id}`"
            class="flex items-center gap-3 py-3 min-h-[56px] hover:bg-zinc-900/50 -mx-4 px-4 transition"
          >
            <div class="size-9 shrink-0 rounded-full bg-primary-500 flex items-center justify-center">
              <UIcon name="i-lucide-list-checks" class="size-5 text-white" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-semibold truncate">
                {{ team.name }}
              </div>
              <div class="text-xs text-zinc-500 truncate">
                {{ team.member_count }} member{{ team.member_count === 1 ? '' : 's' }}
                <span v-if="team.role !== 'owner'"> · {{ team.role }}</span>
              </div>
            </div>
            <div class="text-lg tabular-nums text-zinc-400 pr-1">
              {{ team.open_task_count }}
            </div>
            <UIcon name="i-lucide-chevron-right" class="size-5 text-zinc-700" />
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
