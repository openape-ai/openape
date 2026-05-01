<script setup lang="ts">
interface RoomRow {
  id: string
  name: string
  kind: 'channel' | 'dm'
  createdByEmail: string
  createdAt: number
  role: 'member' | 'admin'
}

// Driven by the SP module's composable. `user` becomes null on 401, so a
// missing session bounces to /login (which the module renders via its own
// OpenApeAuth component).
const { user, fetchUser, logout: spLogout } = useOpenApeAuth()
await fetchUser()
if (!user.value && import.meta.client) {
  navigateTo('/login')
}

const { data: rooms, refresh } = await useFetch<RoomRow[]>('/api/rooms', {
  default: () => [],
})

const showCreate = ref(false)
const createName = ref('')
const createKind = ref<'channel' | 'dm'>('channel')
const createMembers = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

async function createRoom() {
  createError.value = null
  if (!createName.value.trim()) return
  creating.value = true
  try {
    const members = createMembers.value
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
    const room = await $fetch<{ id: string }>('/api/rooms', {
      method: 'POST',
      body: { name: createName.value.trim(), kind: createKind.value, members },
    })
    showCreate.value = false
    createName.value = ''
    createMembers.value = ''
    await refresh()
    navigateTo(`/rooms/${room.id}`)
  }
  catch (err) {
    createError.value = err instanceof Error ? err.message : 'Failed to create room'
  }
  finally {
    creating.value = false
  }
}

async function logout() {
  await spLogout()
  navigateTo('/login')
}
</script>

<template>
  <div class="min-h-dvh flex flex-col">
    <header class="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <h1 class="font-semibold text-lg flex-1">
        OpenApe Chat
      </h1>
      <span v-if="user" class="text-xs text-zinc-400 hidden sm:inline">
        {{ user.sub }}
        <span v-if="user.act === 'agent'">🤖</span>
      </span>
      <UButton
        icon="i-lucide-plus"
        size="sm"
        color="primary"
        aria-label="New room"
        @click="showCreate = true"
      />
      <UButton
        icon="i-lucide-log-out"
        size="sm"
        color="neutral"
        variant="ghost"
        aria-label="Sign out"
        @click="logout"
      />
    </header>

    <main class="flex-1 overflow-y-auto pb-24 md:pb-4">
      <p v-if="!rooms?.length" class="p-8 text-center text-zinc-500 text-sm">
        No rooms yet. Create one to start chatting.
      </p>
      <ul v-else class="divide-y divide-zinc-800">
        <li v-for="room of rooms" :key="room.id">
          <NuxtLink
            :to="`/rooms/${room.id}`"
            class="block px-4 py-3 hover:bg-zinc-900 active:bg-zinc-800 transition-colors"
          >
            <div class="flex items-center gap-2">
              <UIcon
                :name="room.kind === 'dm' ? 'i-lucide-message-circle' : 'i-lucide-hash'"
                class="text-zinc-500 size-4 shrink-0"
              />
              <span class="font-medium truncate">{{ room.name }}</span>
              <span v-if="room.role === 'admin'" class="text-xs text-zinc-500 shrink-0">admin</span>
            </div>
          </NuxtLink>
        </li>
      </ul>
    </main>

    <UModal v-model:open="showCreate">
      <template #content>
        <form class="p-6 space-y-4" @submit.prevent="createRoom">
          <h2 class="text-lg font-semibold">
            New room
          </h2>
          <UFormField label="Name" required>
            <UInput v-model="createName" placeholder="team-alpha" autofocus />
          </UFormField>
          <UFormField label="Type">
            <URadioGroup
              v-model="createKind"
              :items="[
                { value: 'channel', label: 'Channel — many members can join later' },
                { value: 'dm', label: 'DM — fixed member set' },
              ]"
            />
          </UFormField>
          <UFormField label="Members (emails, comma or space separated)" :hint="createKind === 'dm' ? 'You + at least one other email' : 'Optional — anyone can join later'">
            <UTextarea v-model="createMembers" :rows="2" placeholder="alice@example.com, bob@example.com" />
          </UFormField>
          <p v-if="createError" class="text-sm text-red-400">
            {{ createError }}
          </p>
          <div class="flex gap-2 justify-end">
            <UButton color="neutral" variant="ghost" @click="showCreate = false">
              Cancel
            </UButton>
            <UButton type="submit" color="primary" :loading="creating">
              Create
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
