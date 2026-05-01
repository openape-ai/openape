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

const messages = ref<Message[]>([])
const reactions = ref<Map<string, Reaction[]>>(new Map())
const loading = ref(true)
const scrollEl = ref<HTMLElement>()

async function loadInitial() {
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
  await loadInitial()
  chat.connect()
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
        {{ roomId }}
      </h1>
      <span class="text-xs px-2 py-0.5 rounded-full" :class="chat.connected.value ? 'text-emerald-400' : 'text-zinc-500'">
        {{ chat.connected.value ? '● live' : '○ offline' }}
      </span>
    </header>

    <main ref="scrollEl" class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
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
    </main>

    <SendBox @send="send" />
  </div>
</template>
