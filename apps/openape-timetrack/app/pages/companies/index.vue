<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, loading: authLoading, fetchUser, logout } = useOpenApeAuth()

interface Company { id: string, name: string, role: string | null }

const companies = ref<Company[]>([])
const loading = ref(true)
const error = ref('')
const creating = ref(false)
const newName = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) { await navigateTo('/login'); return }
  await load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    companies.value = await ($fetch as any)('/api/companies') as Company[]
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Failed to load companies'
  }
  finally {
    loading.value = false
  }
}

async function create() {
  const name = newName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  try {
    await ($fetch as any)('/api/companies', { method: 'POST', body: { name } })
    newName.value = ''
    await load()
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Create failed'
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 pb-24">
    <div class="max-w-2xl mx-auto px-4 pt-6">
      <div class="flex items-center justify-between mb-6">
        <div class="min-w-0">
          <h1 class="text-2xl font-bold">
            Companies
          </h1>
          <p v-if="user" class="text-sm text-zinc-500 truncate">
            {{ user.sub }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton to="/me" color="neutral" variant="soft" size="sm" icon="i-lucide-clock">
            Meine Stunden
          </UButton>
          <UButton to="/report" color="neutral" variant="soft" size="sm" icon="i-lucide-bar-chart-3">
            Report
          </UButton>
          <UButton color="neutral" variant="ghost" size="sm" @click="logout">
            Logout
          </UButton>
        </div>
      </div>

      <form class="flex gap-2 mb-6" @submit.prevent="create">
        <UInput v-model="newName" placeholder="New company name" size="lg" class="flex-1" />
        <UButton type="submit" color="primary" size="lg" icon="i-lucide-plus" :loading="creating" :disabled="!newName.trim()">
          Add
        </UButton>
      </form>

      <div v-if="authLoading || loading" class="text-center text-zinc-500 mt-10">
        Loading…
      </div>
      <UAlert v-else-if="error" color="error" :title="error" class="mb-4" />
      <div v-else-if="companies.length === 0" class="text-center py-10 text-zinc-500">
        <UIcon name="i-lucide-building-2" class="size-10 mx-auto mb-3 opacity-40" />
        <p>No companies yet. Add one above.</p>
      </div>
      <ul v-else class="divide-y divide-zinc-900">
        <li v-for="c in companies" :key="c.id">
          <NuxtLink
            :to="`/companies/${c.id}`"
            class="flex items-center gap-3 py-3 min-h-[56px] hover:bg-zinc-900/50 -mx-4 px-4 transition"
          >
            <div class="size-9 shrink-0 rounded-full bg-primary-500 flex items-center justify-center">
              <UIcon name="i-lucide-building-2" class="size-5 text-white" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-semibold truncate">
                {{ c.name }}
              </div>
              <div class="text-xs text-zinc-500">
                {{ c.role ?? 'via project' }}
              </div>
            </div>
            <UIcon name="i-lucide-chevron-right" class="size-5 text-zinc-700" />
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
