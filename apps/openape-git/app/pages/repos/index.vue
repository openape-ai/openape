<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'
import { ownerSlugFromEmail } from '~/utils/git-ui'

interface Repo {
  id: string
  owner: string
  name: string
  defaultBranch: string
  createdAt: number
}

const { user, fetchUser, logout } = useOpenApeAuth()
const repos = ref<Repo[]>([])
const loading = ref(true)
const newOwner = ref('')
const newName = ref('')
const creating = ref(false)
const error = ref('')

const identity = computed(() => {
  const u = user.value as { email?: string, sub?: string } | null
  return u?.email ?? u?.sub ?? ''
})

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  newOwner.value = ownerSlugFromEmail(identity.value)
  await load()
})

async function load() {
  loading.value = true
  repos.value = await $fetch<Repo[]>('/api/repos')
  loading.value = false
}

async function onCreate() {
  if (creating.value) return
  creating.value = true
  error.value = ''
  try {
    const repo = await $fetch<Repo>('/api/repos', {
      method: 'POST',
      body: { owner: newOwner.value, name: newName.value },
    })
    await navigateTo(`/repos/${repo.owner}/${repo.name}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Create failed'
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
      <NuxtLink to="/repos" class="font-bold text-lg">
        🦍 ape-git
      </NuxtLink>
      <div class="flex items-center gap-3 text-sm text-zinc-400">
        <span>{{ identity }}</span>
        <UButton size="xs" color="neutral" variant="ghost" @click="logout()">
          Logout
        </UButton>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <section>
        <h2 class="text-xl font-semibold mb-4">
          New repository
        </h2>
        <form class="flex flex-col sm:flex-row gap-2" @submit.prevent="onCreate">
          <UInput v-model="newOwner" placeholder="owner" class="sm:w-40" />
          <UInput v-model="newName" placeholder="name" class="flex-1" />
          <UButton type="submit" color="primary" :loading="creating" :disabled="!newOwner.trim() || !newName.trim()">
            Create
          </UButton>
        </form>
        <UAlert v-if="error" color="error" :title="error" class="mt-3" @close="error = ''" />
      </section>

      <section>
        <h2 class="text-xl font-semibold mb-4">
          Your repositories
        </h2>
        <p v-if="loading" class="text-zinc-500">
          Loading…
        </p>
        <p v-else-if="repos.length === 0" class="text-zinc-500">
          No repositories yet.
        </p>
        <ul v-else class="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
          <li v-for="repo in repos" :key="repo.id">
            <NuxtLink
              :to="`/repos/${repo.owner}/${repo.name}`"
              class="flex items-center justify-between px-4 py-3 hover:bg-zinc-900"
            >
              <span class="font-mono">{{ repo.owner }}/{{ repo.name }}</span>
              <span class="text-xs text-zinc-500">{{ repo.defaultBranch }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
