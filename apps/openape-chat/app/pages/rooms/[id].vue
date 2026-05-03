<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface Message {
  id: string
  roomId: string
  threadId: string
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

interface Thread {
  id: string
  roomId: string
  name: string
  createdByEmail: string
  createdAt: number
  archivedAt: number | null
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
const threads = ref<Thread[]>([])
const activeThreadId = ref<string | null>(null)
const newThreadName = ref('')
const showNewThread = ref(false)

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

async function loadThreads(): Promise<void> {
  if (!roomInfo.value) {
    threads.value = []
    activeThreadId.value = null
    return
  }
  // Server lazily creates a "main" thread on first GET for legacy rooms,
  // so the result is guaranteed non-empty for any room the caller is in.
  const rows = await $fetch<Thread[]>(`/api/rooms/${roomId.value}/threads`)
  threads.value = rows
  if (!activeThreadId.value || !rows.some(t => t.id === activeThreadId.value)) {
    const firstOpen = rows.find(t => !t.archivedAt) ?? rows[0]
    activeThreadId.value = firstOpen?.id ?? null
  }
}

async function loadMessages() {
  if (!roomInfo.value || !activeThreadId.value) {
    messages.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const rows = await $fetch<Message[]>(`/api/rooms/${roomId.value}/messages`, {
      query: { limit: 50, thread_id: activeThreadId.value },
    })
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
  await loadThreads()
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
    reactions.value = new Map(reactions.value)
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
  chat.connect()
  await loadInitial()
  off = chat.on((frame) => {
    if (frame.room_id !== roomId.value) return
    if (frame.type === 'message') {
      const m = frame.payload as Message
      // Only append messages that belong to the currently-viewed thread.
      // Other threads still get the broadcast (so a future "unread badge"
      // hook can pick it up here without server changes), but the active
      // message list stays scoped.
      if (m.threadId && m.threadId !== activeThreadId.value) return
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
      const p = frame.payload as { roomId: string, userEmail: string, thread?: Thread }
      // Two flavours: (a) a member was removed from the room — if it's
      // me, navigate out; (b) a thread was archived — refresh the
      // thread list so the tab disappears (or moves to "Archived").
      if (p.thread) {
        void loadThreads()
        return
      }
      if (p.userEmail === user.value?.sub) {
        navigateTo('/')
      }
    }
    else if (frame.type === 'membership-changed') {
      const p = frame.payload as {
        roomId: string
        userEmail?: string
        role?: 'member' | 'admin'
        thread?: Thread
      }
      // Either a role change for a member (existing v1 behaviour) or a
      // new/renamed thread (Phase B). Disambiguate via payload shape.
      if (p.thread) {
        void loadThreads()
        return
      }
      if (p.userEmail === user.value?.sub && p.role && roomInfo.value) {
        roomInfo.value = { ...roomInfo.value, role: p.role }
      }
    }
  })
})

onBeforeUnmount(() => {
  off?.()
})

watch(roomId, loadInitial)
watch(activeThreadId, () => { void loadMessages() })

async function send(body: string) {
  if (!activeThreadId.value) return
  await $fetch(`/api/rooms/${roomId.value}/messages`, {
    method: 'POST',
    body: { body, thread_id: activeThreadId.value },
  })
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

const visibleThreads = computed(() => threads.value.filter(t => !t.archivedAt))

async function selectThread(id: string): Promise<void> {
  if (activeThreadId.value === id) return
  activeThreadId.value = id
}

async function createThread(): Promise<void> {
  const name = newThreadName.value.trim()
  if (!name) return
  const created = await $fetch<Thread>(`/api/rooms/${roomId.value}/threads`, {
    method: 'POST',
    body: { name },
  })
  newThreadName.value = ''
  showNewThread.value = false
  await loadThreads()
  activeThreadId.value = created.id
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

    <nav
      v-if="roomInfo && visibleThreads.length"
      class="sticky top-[52px] z-10 flex items-center gap-1 px-2 py-1 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur overflow-x-auto"
      aria-label="Threads"
    >
      <button
        v-for="t of visibleThreads"
        :key="t.id"
        type="button"
        class="shrink-0 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors"
        :class="activeThreadId === t.id
          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
          : 'text-zinc-400 border border-transparent hover:bg-zinc-900'"
        @click="selectThread(t.id)"
      >
        {{ t.name }}
      </button>
      <button
        type="button"
        class="shrink-0 px-3 py-1.5 rounded-full text-sm text-zinc-400 border border-zinc-800 hover:bg-zinc-900"
        aria-label="New thread"
        @click="showNewThread = !showNewThread"
      >
        +
      </button>
    </nav>

    <div
      v-if="showNewThread"
      class="px-3 py-2 border-b border-zinc-800 flex gap-2"
    >
      <UInput
        v-model="newThreadName"
        placeholder="Thread name…"
        size="sm"
        class="flex-1"
        @keydown.enter="createThread"
      />
      <UButton size="sm" color="primary" :disabled="!newThreadName.trim()" @click="createThread">
        Create
      </UButton>
      <UButton
        size="sm"
        color="neutral"
        variant="ghost"
        @click="showNewThread = false; newThreadName = ''"
      >
        Cancel
      </UButton>
    </div>

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

    <SendBox v-if="roomInfo && activeThreadId" @send="send" />

    <MemberManager
      v-if="roomInfo"
      v-model:open="membersOpen"
      :room-id="roomId"
      :my-email="user?.sub"
      :my-role="roomInfo.role"
    />
  </div>
</template>
