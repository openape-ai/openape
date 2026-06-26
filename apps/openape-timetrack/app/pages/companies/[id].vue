<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser } = useOpenApeAuth()
const route = useRoute()
const companyId = String(route.params.id)

interface Detail {
  id: string
  name: string
  role: string | null
  projects: Array<{ id: string, name: string, description: string }>
  members: Array<{ user_email: string, role: string }>
}

const data = ref<Detail | null>(null)
const loading = ref(true)
const error = ref('')
const newProject = ref('')
const creating = ref(false)
const inviteUrl = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) { await navigateTo('/login'); return }
  await load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await ($fetch as any)(`/api/companies/${companyId}`) as Detail
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Failed to load company'
  }
  finally {
    loading.value = false
  }
}

async function addProject() {
  const name = newProject.value.trim()
  if (!name || creating.value) return
  creating.value = true
  try {
    await ($fetch as any)('/api/projects', { method: 'POST', body: { company_id: companyId, name } })
    newProject.value = ''
    await load()
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Create failed'
  }
  finally {
    creating.value = false
  }
}

async function makeInvite() {
  try {
    const r = await ($fetch as any)(`/api/companies/${companyId}/invite`, {
      method: 'POST', body: { role: 'member' },
    }) as { url: string }
    inviteUrl.value = r.url
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Invite failed'
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 pb-24">
    <div class="max-w-2xl mx-auto px-4 pt-6">
      <NuxtLink to="/companies" class="text-sm text-zinc-500 hover:text-primary-500">
        ← Companies
      </NuxtLink>

      <div v-if="loading" class="text-center text-zinc-500 mt-10">
        Loading…
      </div>
      <UAlert v-else-if="error" color="error" :title="error" class="mt-4" />
      <template v-else-if="data">
        <h1 class="text-2xl font-bold mt-2 mb-1">
          {{ data.name }}
        </h1>
        <p class="text-sm text-zinc-500 mb-6">
          {{ data.role ?? 'via project' }}
        </p>

        <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          Projects
        </h2>
        <form v-if="data.role === 'owner'" class="flex gap-2 mb-4" @submit.prevent="addProject">
          <UInput v-model="newProject" placeholder="New project name" size="lg" class="flex-1" />
          <UButton type="submit" color="primary" size="lg" icon="i-lucide-plus" :loading="creating" :disabled="!newProject.trim()">
            Add
          </UButton>
        </form>
        <ul v-if="data.projects.length" class="divide-y divide-zinc-900 mb-8">
          <li v-for="p in data.projects" :key="p.id">
            <NuxtLink
              :to="`/projects/${p.id}`"
              class="flex items-center gap-3 py-3 min-h-[56px] hover:bg-zinc-900/50 -mx-4 px-4 transition"
            >
              <UIcon name="i-lucide-folder" class="size-5 text-primary-500" />
              <div class="min-w-0 flex-1">
                <div class="font-semibold truncate">
                  {{ p.name }}
                </div>
                <div v-if="p.description" class="text-xs text-zinc-500 truncate">
                  {{ p.description }}
                </div>
              </div>
              <UIcon name="i-lucide-chevron-right" class="size-5 text-zinc-700" />
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="text-zinc-500 mb-8">
          No visible projects.
        </p>

        <template v-if="data.members.length">
          <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Members
          </h2>
          <ul class="space-y-1 mb-6">
            <li v-for="m in data.members" :key="m.user_email" class="flex justify-between text-sm">
              <span class="truncate">{{ m.user_email }}</span>
              <span class="text-zinc-500">{{ m.role }}</span>
            </li>
          </ul>
        </template>

        <template v-if="data.role === 'owner'">
          <UButton color="neutral" variant="soft" icon="i-lucide-link" @click="makeInvite">
            Create member invite link
          </UButton>
          <UInput v-if="inviteUrl" :model-value="inviteUrl" readonly class="mt-3" />
        </template>
      </template>
    </div>
  </div>
</template>
