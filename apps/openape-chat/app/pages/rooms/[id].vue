<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface Message {
  id: string
  roomId: string
  senderEmail: string
  senderAct: 'human' | 'agent'
  body: string
  replyTo: string | null
  createdAt: number
  editedAt: number | null
}

interface Reaction {
  messageId: string
  userEmail: string
  emoji: string
  createdAt: number
}

const route = useRoute()
const roomId = computed(() => route.params.id as string)

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()
if (!user.value && import.meta.client) navigateTo('/login')

interface RoomInfo {
  id: string
  name: string
  kind: 'channel' | 'dm'
  createdByEmail: string
  createdAt: number
  role: 'member' | 'admin'
}

const messages = ref<Message[]>([])
const reactions = ref<Map<string, Reaction[]>>(new Map())
const loading = ref(true)
const scrollEl = ref<HTMLElement>()
const roomInfo = ref<RoomInfo | null>(null)
const roomError = ref<string | null>(null)
const membersOpen = ref(false)

// Per-page title — falls back to a generic placeholder while the
// metadata loads, then updates to the room name. The titleTemplate
// from nuxt.config appends " — OpenApe Chat".
useHead({
  title: () => roomInfo.value?.name ?? 'Room',
})

async function loadRoomInfo() {
  roomError.value = null
  try {
    roomInfo.value = await $fetch<RoomInfo>(`/api/rooms/${roomId.value}`)
  }
  catch (err) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 404) {
      // The server returns 404 both for "room doesn't exist" and "you're
      // not a member" — this is intentional, non-members should not be
      // able to discover that a room exists at all.
      roomError.value = 'Raum für diesen User nicht verfügbar.'
    }
    else if (status === 401) {
      navigateTo('/login')
    }
    else {
      roomError.value = err instanceof Error ? err.message : 'Could not load room info.'
    }
    roomInfo.value = null
  }
}

async function loadMessages() {
  if (!roomInfo.value) {
    messages.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const rows = await $fetch<Message[]>(`/api/rooms/${roomId.value}/messages?limit=50`)
    messages.value = rows
  }
  finally {
    loading.value = false
    await nextTick()
    scrollToBottom('instant')
  }
}

async function loadInitial() {
  await loadRoomInfo()
  await loadMessages()
}

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  if (!scrollEl.value) return
  scrollEl.value.scrollTo({ top: scrollEl.value.scrollHeight, behavior })
}

function addReactionLocal(r: Reaction) {
  const list = reactions.value.get(r.messageId) ?? []
  if (!list.some(x => x.userEmail === r.userEmail && x.emoji === r.emoji)) {
    list.push(r)
    reactions.value.set(r.messageId, list)
    reactions.value = new Map(reactions.value) // trigger reactivity
  }
}

function removeReactionLocal(messageId: string, userEmail: string, emoji: string) {
  const list = reactions.value.get(messageId)
  if (!list) return
  const next = list.filter(r => !(r.userEmail === userEmail && r.emoji === emoji))
  if (next.length === 0) reactions.value.delete(messageId)
  else reactions.value.set(messageId, next)
  reactions.value = new Map(reactions.value)
}

const chat = useChat()
let off: (() => void) | undefined

onMounted(async () => {
  // Connect WS first so the live indicator updates regardless of whether
  // we can read messages. Non-members watching a Join screen still get
  // a fresh socket — when they join, broadcasts start flowing immediately
  // without a reconnect dance.
  chat.connect()
  await loadInitial()
  off = chat.on((frame) => {
    if (frame.room_id !== roomId.value) return
    if (frame.type === 'message') {
      const m = frame.payload as Message
      if (!messages.value.some(x => x.id === m.id)) {
        messages.value.push(m)
        nextTick(() => scrollToBottom())
      }
    }
    else if (frame.type === 'edit') {
      const m = frame.payload as Message
      const idx = messages.value.findIndex(x => x.id === m.id)
      if (idx >= 0) messages.value[idx] = m
    }
    else if (frame.type === 'reaction') {
      addReactionLocal(frame.payload as Reaction)
    }
    else if (frame.type === 'reaction-removed') {
      const p = frame.payload as { messageId: string, userEmail: string, emoji: string }
      removeReactionLocal(p.messageId, p.userEmail, p.emoji)
    }
    else if (frame.type === 'membership-removed') {
      const p = frame.payload as { roomId: string, userEmail: string }
      // If I'm the one being removed, kick myself out of the room view.
      // The next loadRoomInfo would 404 anyway; this just makes the
      // transition immediate instead of waiting for the next interaction.
      if (p.userEmail === user.value?.sub) {
        navigateTo('/')
      }
    }
    else if (frame.type === 'membership-changed') {
      const p = frame.payload as { roomId: string, userEmail: string, role: 'member' | 'admin' }
      // Refresh local role so the admin UI flips when someone promotes
      // or demotes me without requiring a page reload.
      if (p.userEmail === user.value?.sub && roomInfo.value) {
        roomInfo.value = { ...roomInfo.value, role: p.role }
      }
    }
  })
})

onBeforeUnmount(() => {
  off?.()
})

watch(roomId, loadInitial)

async function send(body: string) {
  await $fetch(`/api/rooms/${roomId.value}/messages`, {
    method: 'POST',
    body: { body },
  })
  // Server will broadcast via WS; the inbound frame appends + scrolls.
}

async function react(messageId: string, emoji: string) {
  if (!user.value?.sub) return
  addReactionLocal({ messageId, userEmail: user.value.sub, emoji, createdAt: Math.floor(Date.now() / 1000) })
  await $fetch(`/api/messages/${messageId}/reactions`, {
    method: 'POST',
    body: { emoji },
  })
}

async function unreact(messageId: string, emoji: string) {
  if (!user.value?.sub) return
  removeReactionLocal(messageId, user.value.sub, emoji)
  await $fetch(`/api/messages/${messageId}/reactions`, {
    method: 'DELETE',
    query: { emoji },
  })
}

function reactionsFor(messageId: string) {
  const list = reactions.value.get(messageId) ?? []
  if (list.length === 0) return []
  const myEmail = user.value?.sub
  const counts = new Map<string, { count: number, mine: boolean }>()
  for (const r of list) {
    const cur = counts.get(r.emoji) ?? { count: 0, mine: false }
    cur.count += 1
    if (r.userEmail === myEmail) cur.mine = true
    counts.set(r.emoji, cur)
  }
  return Array.from(counts.entries(), ([emoji, c]) => ({ emoji, ...c }))
}
</script>

<template>
  <div class="min-h-dvh flex flex-col">
    <header class="sticky top-0 z-10 flex items-center gap-2 px-3 py-3 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <UButton
        to="/"
        icon="i-lucide-arrow-left"
        size="sm"
        color="neutral"
        variant="ghost"
        aria-label="Back to rooms"
      />
      <h1 class="font-semibold flex-1 truncate">
        {{ roomInfo?.name ?? roomId }}
      </h1>
      <UButton
        v-if="roomInfo"
        :icon="roomInfo.role === 'admin' ? 'i-lucide-settings' : 'i-lucide-users'"
        size="sm"
        color="neutral"
        variant="ghost"
        :aria-label="roomInfo.role === 'admin' ? 'Manage members' : 'View members'"
        @click="membersOpen = true"
      />
      <span class="text-xs px-2 py-0.5 rounded-full" :class="chat.connected.value ? 'text-emerald-400' : 'text-zinc-500'">
        {{ chat.connected.value ? '● live' : '○ offline' }}
      </span>
    </header>

    <main ref="scrollEl" class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
      <div v-if="roomError" class="max-w-sm mx-auto py-12 text-center space-y-3">
        <UIcon name="i-lucide-circle-alert" class="size-10 text-zinc-600 mx-auto" />
        <p class="text-sm text-zinc-400">
          {{ roomError }}
        </p>
        <UButton to="/" color="neutral" variant="soft" size="sm">
          Back to rooms
        </UButton>
      </div>

      <template v-else>
        <p v-if="loading" class="text-center text-sm text-zinc-500 py-8">
          Loading…
        </p>
        <p v-else-if="!messages.length" class="text-center text-sm text-zinc-500 py-8">
          No messages yet. Be the first.
        </p>
        <MessageBubble
          v-for="m of messages"
          :key="m.id"
          :message="m"
          :reactions="reactionsFor(m.id)"
          :my-email="user?.sub"
          @react="emoji => react(m.id, emoji)"
          @unreact="emoji => unreact(m.id, emoji)"
        />
      </template>
    </main>

    <SendBox v-if="roomInfo" @send="send" />

    <MemberManager
      v-if="roomInfo"
      v-model:open="membersOpen"
      :room-id="roomId"
      :my-email="user?.sub"
      :my-role="roomInfo.role"
    />
  </div>
</template>
