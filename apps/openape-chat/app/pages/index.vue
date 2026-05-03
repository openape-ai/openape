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

const { data: allRooms } = await useFetch<RoomRow[]>('/api/rooms', {
  default: () => [],
})

// Channel-style rooms (group chats) are hidden until the contacts model
// (Phase A) ships — letting an agent loose in a multi-member room with no
// way to filter agent vs human created reply-loops between agents. DMs
// (1:1) stay visible because the membership shape inherently bounds the
// participants.
const rooms = computed(() => (allRooms.value ?? []).filter(r => r.kind === 'dm'))

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
        icon="i-lucide-log-out"
        size="sm"
        color="neutral"
        variant="ghost"
        aria-label="Sign out"
        @click="logout"
      />
    </header>

    <main class="flex-1 overflow-y-auto pb-24 md:pb-4">
      <ClientOnly>
        <EnableNotifications />
      </ClientOnly>
      <p v-if="!rooms?.length" class="p-8 text-center text-zinc-500 text-sm">
        No direct chats yet.<br>
        Spawn an agent with <code class="text-zinc-300">apes agents spawn &lt;name&gt; --bridge</code>
        to start a conversation.
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
  </div>
</template>
