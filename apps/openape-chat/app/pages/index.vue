<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface ContactRow {
  peerEmail: string
  myStatus: 'accepted' | 'pending' | 'blocked'
  theirStatus: 'accepted' | 'pending' | 'blocked'
  connected: boolean
  roomId: string | null
  requestedAt: number
  acceptedAt: number | null
}

// Driven by the SP module's composable. `user` becomes null on 401, so a
// missing session bounces to /login (which the module renders via its own
// OpenApeAuth component).
const { user, fetchUser, logout: spLogout } = useOpenApeAuth()
await fetchUser()
if (!user.value && import.meta.client) {
  navigateTo('/login')
}

const { data: contacts, refresh: refreshContacts } = await useFetch<ContactRow[]>('/api/contacts', {
  default: () => [],
})

// Three buckets — keeps the sidebar scannable. Sorted by most-recent
// activity (acceptedAt for connected, requestedAt for pending).
const incoming = computed(() => (contacts.value ?? [])
  .filter(c => c.myStatus === 'pending' && c.theirStatus === 'accepted')
  .sort((a, b) => b.requestedAt - a.requestedAt))
// Connected = mutual + has an active room. After a delete, the
// contact stays in the DB (the friendship is intact) but its
// `roomId` is null until the next message provisions a fresh
// room — see `ensureDmRoomFor`. We filter those out of the list
// so the deleted chat disappears from the overview immediately;
// agent contacts naturally come back when the bridge posts the
// next message (it calls ensureDmRoomFor before sending).
const connected = computed(() => (contacts.value ?? [])
  .filter(c => c.connected && c.roomId)
  .sort((a, b) => (b.acceptedAt ?? 0) - (a.acceptedAt ?? 0)))
const outgoing = computed(() => (contacts.value ?? [])
  .filter(c => c.myStatus === 'accepted' && c.theirStatus === 'pending')
  .sort((a, b) => b.requestedAt - a.requestedAt))

const showAdd = ref(false)
const addEmail = ref('')
const adding = ref(false)
const addError = ref<string | null>(null)

async function addContact() {
  addError.value = null
  const email = addEmail.value.trim().toLowerCase()
  if (!email) return
  adding.value = true
  try {
    await $fetch('/api/contacts', { method: 'POST', body: { email } })
    addEmail.value = ''
    showAdd.value = false
    await refreshContacts()
  }
  catch (err: unknown) {
    addError.value = err instanceof Error ? err.message : 'Failed to add contact'
  }
  finally {
    adding.value = false
  }
}

const acting = ref<Set<string>>(new Set())
function startAct(email: string) { acting.value = new Set([...acting.value, email]) }
function endAct(email: string) {
  const next = new Set(acting.value)
  next.delete(email)
  acting.value = next
}

async function acceptContact(email: string) {
  startAct(email)
  try {
    await $fetch(`/api/contacts/${encodeURIComponent(email)}/accept`, { method: 'POST' })
    await refreshContacts()
  }
  finally {
    endAct(email)
  }
}

async function removeContact(email: string) {
  startAct(email)
  try {
    await $fetch(`/api/contacts/${encodeURIComponent(email)}`, { method: 'DELETE' })
    await refreshContacts()
  }
  finally {
    endAct(email)
  }
}

// Live refresh on membership-* WS frames (peer accepted / contact change).
// The chat-app already broadcasts these; we just consume them.
let ws: WebSocket | null = null
async function openLiveSocket() {
  if (!import.meta.client) return
  const tok = await $fetch<{ token: string }>('/api/ws-token')
  const url = `${location.origin.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(tok.token)}`
  ws = new WebSocket(url)
  ws.addEventListener('message', (ev) => {
    try {
      const frame = JSON.parse(ev.data) as { type?: string }
      if (frame.type?.startsWith('membership-')) {
        void refreshContacts()
      }
    }
    catch {
      // ignore
    }
  })
  ws.addEventListener('close', () => { ws = null })
}

onMounted(() => { void openLiveSocket() })
onBeforeUnmount(() => { ws?.close() })

async function logout() {
  await spLogout()
  navigateTo('/login')
}

function shortEmail(email: string): string {
  // Agents are very long: agent-bot1+patrick+hofmann_eco@id.openape.ai →
  // "agent-bot1". Humans stay full.
  if (email.endsWith('@id.openape.ai') && email.includes('+')) {
    return email.split('+')[0] ?? email
  }
  return email
}

function isAgent(email: string): boolean {
  return email.endsWith('@id.openape.ai')
}

// ── Room delete (kebab-menu on every device) ──
//
// The first cut used a swipe gesture on touch + hover-button on
// desktop. Swipe was unreliable (iOS Safari competing for scroll
// gestures, false-positive deletes from a fast scroll-flick). Kebab
// is the universal alternative: visible icon at the right of every
// row, tap → small popover with the destructive action. Same input
// affordance everywhere.

// Delete-confirm modal state. We don't auto-delete on tap because a
// chat is irrecoverable (no undo, no soft-delete in v1) — confirm
// guards against a wrong-row tap on a phone.
const confirmDelete = ref<{ roomId: string, peerEmail: string } | null>(null)
const confirmDeleteOpen = computed({
  get: () => confirmDelete.value !== null,
  set: (v) => { if (!v) confirmDelete.value = null },
})
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function requestDeleteRoom(roomId: string): void {
  const c = (contacts.value ?? []).find(x => x.roomId === roomId)
  if (!c) return
  confirmDelete.value = { roomId, peerEmail: c.peerEmail }
}

async function doDelete(): Promise<void> {
  if (!confirmDelete.value || deleting.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/rooms/${encodeURIComponent(confirmDelete.value.roomId)}`, { method: 'DELETE' })
    confirmDelete.value = null
    await refreshContacts()
  }
  catch (err: unknown) {
    deleteError.value = err instanceof Error ? err.message : 'Delete failed'
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh flex flex-col">
    <header class="safe-pt sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-950">
      <div class="flex-1 min-w-0">
        <h1 class="font-semibold text-lg leading-tight">
          OpenApe Chat
        </h1>
        <p v-if="user" class="text-xs text-zinc-400 truncate leading-tight">
          {{ user.sub }}<span v-if="user.act === 'agent'"> 🤖</span>
        </p>
      </div>
      <UButton
        icon="i-lucide-user-plus"
        size="sm"
        color="primary"
        aria-label="Add contact"
        @click="showAdd = true"
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
      <ClientOnly>
        <EnableNotifications />
      </ClientOnly>

      <!-- Empty state -->
      <p
        v-if="!incoming.length && !connected.length && !outgoing.length"
        class="p-8 text-center text-zinc-500 text-sm"
      >
        No contacts yet.<br>
        Tap <UIcon name="i-lucide-user-plus" class="size-3 inline-block align-text-top" /> to add one,
        or spawn an agent with
        <code class="text-zinc-300">apes agents spawn &lt;name&gt;</code>
        to start a conversation.
      </p>

      <!-- Incoming pending -->
      <section v-if="incoming.length" class="border-b border-zinc-800">
        <h2 class="px-4 pt-4 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Pending requests · {{ incoming.length }}
        </h2>
        <ul class="divide-y divide-zinc-800">
          <li v-for="c of incoming" :key="c.peerEmail" class="px-4 py-3 flex items-center gap-3">
            <UIcon
              :name="isAgent(c.peerEmail) ? 'i-lucide-bot' : 'i-lucide-user'"
              class="text-zinc-500 size-5 shrink-0"
            />
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">
                {{ shortEmail(c.peerEmail) }}
              </div>
              <div class="text-xs text-zinc-500 truncate">
                {{ c.peerEmail }}
              </div>
            </div>
            <UButton
              size="sm"
              color="primary"
              :loading="acting.has(c.peerEmail)"
              :disabled="acting.has(c.peerEmail)"
              @click="acceptContact(c.peerEmail)"
            >
              Accept
            </UButton>
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              aria-label="Decline"
              :disabled="acting.has(c.peerEmail)"
              @click="removeContact(c.peerEmail)"
            />
          </li>
        </ul>
      </section>

      <!-- Connected contacts -->
      <section v-if="connected.length">
        <h2 class="px-4 pt-4 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Contacts · {{ connected.length }}
        </h2>
        <ul class="divide-y divide-zinc-800">
          <li
            v-for="c of connected"
            :key="c.peerEmail"
            class="flex items-stretch"
          >
            <NuxtLink
              v-if="c.roomId"
              :to="`/rooms/${c.roomId}`"
              class="flex-1 min-w-0 px-4 py-3 hover:bg-zinc-900 active:bg-zinc-800 transition-colors"
            >
              <div class="flex items-center gap-3">
                <UIcon
                  :name="isAgent(c.peerEmail) ? 'i-lucide-bot' : 'i-lucide-user'"
                  class="text-zinc-500 size-5 shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate">
                    {{ shortEmail(c.peerEmail) }}
                  </div>
                  <div class="text-xs text-zinc-500 truncate">
                    {{ c.peerEmail }}
                  </div>
                </div>
              </div>
            </NuxtLink>
            <!-- Kebab menu. Same affordance on every device — the
                 swipe variant was too easy to mis-fire on a scroll-
                 flick. Single tap opens a small action sheet; one
                 destructive action for now (Delete chat), space for
                 more if/when needed (Mute, Archive, …). -->
            <UDropdownMenu
              v-if="c.roomId"
              :items="[[{ label: 'Delete chat', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => requestDeleteRoom(c.roomId!) }]]"
              :popper="{ placement: 'bottom-end' }"
            >
              <button
                type="button"
                class="px-3 self-stretch flex items-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
                aria-label="More actions"
              >
                <UIcon name="i-lucide-ellipsis-vertical" class="size-5" />
              </button>
            </UDropdownMenu>
          </li>
        </ul>
      </section>

      <!-- Outgoing pending -->
      <section v-if="outgoing.length" class="border-t border-zinc-800">
        <h2 class="px-4 pt-4 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Waiting for · {{ outgoing.length }}
        </h2>
        <ul class="divide-y divide-zinc-800">
          <li v-for="c of outgoing" :key="c.peerEmail" class="px-4 py-3 flex items-center gap-3">
            <UIcon
              :name="isAgent(c.peerEmail) ? 'i-lucide-bot' : 'i-lucide-user'"
              class="text-zinc-500 size-5 shrink-0 opacity-50"
            />
            <div class="flex-1 min-w-0 opacity-70">
              <div class="truncate">
                {{ shortEmail(c.peerEmail) }}
              </div>
              <div class="text-xs text-zinc-500 truncate">
                {{ c.peerEmail }} · pending
              </div>
            </div>
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              aria-label="Cancel request"
              :disabled="acting.has(c.peerEmail)"
              @click="removeContact(c.peerEmail)"
            />
          </li>
        </ul>
      </section>
    </main>

    <UModal v-model:open="showAdd">
      <template #content>
        <form class="p-6 space-y-4" @submit.prevent="addContact">
          <h2 class="text-lg font-semibold">
            Add contact
          </h2>
          <p class="text-sm text-zinc-400">
            Sends a friend request to the email below. Once they accept (or send a request back) you can chat.
          </p>
          <UFormField label="Email" required>
            <UInput
              v-model="addEmail"
              type="email"
              placeholder="alice@example.com"
              autocomplete="email"
              autofocus
            />
          </UFormField>
          <p v-if="addError" class="text-sm text-red-400">
            {{ addError }}
          </p>
          <div class="flex gap-2 justify-end">
            <UButton color="neutral" variant="ghost" @click="showAdd = false">
              Cancel
            </UButton>
            <UButton type="submit" color="primary" :loading="adding" :disabled="!addEmail.trim()">
              Send request
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <!-- Delete-confirm modal — no soft-delete, so we make the user
         confirm. Both DM participants lose access on a single press
         from either side; once gone, gone. -->
    <UModal v-model:open="confirmDeleteOpen" :ui="{ content: 'sm:max-w-md' }">
      <template #content>
        <div class="p-6 space-y-4">
          <h2 class="text-lg font-semibold">
            Delete chat?
          </h2>
          <p class="text-sm text-zinc-400">
            This deletes the entire conversation with
            <span class="font-medium text-zinc-200">{{ confirmDelete?.peerEmail }}</span>
            for both sides. Messages, threads, and reactions are gone — no undo.
            You stay contacts; a new chat starts blank if either side sends a message later.
          </p>
          <p v-if="deleteError" class="text-sm text-red-400">
            {{ deleteError }}
          </p>
          <div class="flex gap-2 justify-end">
            <UButton color="neutral" variant="ghost" :disabled="deleting" @click="confirmDelete = null">
              Cancel
            </UButton>
            <UButton color="error" :loading="deleting" @click="doDelete">
              Delete forever
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
