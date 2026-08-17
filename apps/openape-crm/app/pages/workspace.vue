<script setup lang="ts">
import { useOpenApeAuth } from '#imports'
import { onMounted, ref, watch } from 'vue'
import { apiFetch } from '../utils/api'

interface Member { user_email: string, role: string, joined_at: number }

const { user, fetchUser } = useOpenApeAuth()
const { active, activeId, load: loadWorkspaces, create: createWorkspace } = useWorkspaces()

const members = ref<Member[]>([])
const inviteUrl = ref('')
const inviteRole = ref('member')
const newWorkspaceName = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  await loadWorkspaces()
  await reload()
})

watch(activeId, reload)

async function reload() {
  inviteUrl.value = ''
  if (!activeId.value) {
    members.value = []
    return
  }
  members.value = await apiFetch<Member[]>(`/api/workspaces/${activeId.value}/members`)
}

async function createInvite() {
  const invite = await apiFetch<{ url: string }>(`/api/workspaces/${activeId.value}/invites`, {
    method: 'POST',
    body: { role: inviteRole.value },
  })
  inviteUrl.value = invite.url
}

async function addWorkspace() {
  await createWorkspace(newWorkspaceName.value)
  newWorkspaceName.value = ''
  await reload()
}
</script>

<template>
  <main class="mx-auto grid max-w-5xl gap-8 px-4 py-6 lg:grid-cols-2">
    <section>
      <h1 class="text-xl font-semibold">
        {{ active?.name ?? 'Workspace' }}
      </h1>
      <p class="text-sm text-zinc-400">
        Deine Rolle: {{ active?.role ?? '—' }}
      </p>

      <ul class="mt-4 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        <li v-for="member in members" :key="member.user_email" class="flex items-center justify-between p-3">
          <span class="truncate">{{ member.user_email }}</span>
          <span class="text-xs text-zinc-400">{{ member.role }}</span>
        </li>
      </ul>
    </section>

    <section class="space-y-8">
      <UCard v-if="active?.role !== 'member'">
        <template #header>
          <h2 class="font-semibold">
            Einladen
          </h2>
        </template>
        <div class="space-y-3">
          <UFormField label="Rolle">
            <USelect
              v-model="inviteRole"
              :items="[{ label: 'Mitglied', value: 'member' }, { label: 'Manager', value: 'manager' }]"
              class="w-full"
            />
          </UFormField>
          <UButton block @click="createInvite">
            Einladungslink erzeugen
          </UButton>
          <UInput v-if="inviteUrl" :model-value="inviteUrl" readonly class="w-full" />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Weiterer Workspace
          </h2>
        </template>
        <form class="space-y-3" @submit.prevent="addWorkspace">
          <UInput v-model="newWorkspaceName" placeholder="Name" class="w-full" />
          <UButton type="submit" block :disabled="!newWorkspaceName.trim()">
            Anlegen
          </UButton>
        </form>
      </UCard>
    </section>
  </main>
</template>
