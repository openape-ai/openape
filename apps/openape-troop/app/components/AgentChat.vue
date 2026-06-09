<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  agentName: string
}>()

// Troop-native chat row. Mirrors the server's chat_messages schema —
// `role` is 'human' (the operator) or 'agent' (the bridge). No
// roomId/threadId because troop's chat is a 1:1 main-session per
// (owner, agent) pair; the chat row's id IS the conversation key.
interface ChatMessage {
  id: string
  chatId: string
  role: 'human' | 'agent'
  body: string
  createdAt: number
  editedAt: number | null
  streaming: boolean
  streamingStatus: string | null
  replyTo: string | null
}

interface Chat {
  id: string
  ownerEmail: string
  agentEmail: string
  createdAt: number
  lastMessageAt: number | null
}

const { t, locale } = useI18n()

const messages = ref<ChatMessage[]>([])
const chat = ref<Chat | null>(null)
const loading = ref(true)
const sending = ref(false)
const error = ref<string | null>(null)
const composer = ref('')
const scrollRoot = ref<HTMLElement | null>(null)
const composerEl = ref<HTMLTextAreaElement | null>(null)

const empty = computed(() => !loading.value && messages.value.length === 0)

async function load(): Promise<void> {
  try {
    const data = await ($fetch as any)(`/api/agents/${props.agentName}/chat`)
    chat.value = data.chat
    messages.value = data.messages
    error.value = null
    await nextTick()
    scrollToBottom()
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('chat.error.loadFailed')
  }
  finally {
    loading.value = false
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null
function startPolling(): void {
  // 2.5s polling while the tab is visible — fast enough for "live"
  // feeling without hammering the proxy. Pauses on visibilitychange
  // (browser tabs in background are throttled anyway).
  stopPolling()
  pollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    void load()
  }, 2500)
}
function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function send(): Promise<void> {
  const body = composer.value.trim()
  if (!body || sending.value || !chat.value) return
  sending.value = true
  // Optimistic: drop the message into the local view immediately so the
  // user sees their text right after pressing send; the next poll/WS
  // reconcile lands the canonical row (matching `id`).
  const localId = `local-${Date.now()}`
  messages.value.push({
    id: localId,
    chatId: chat.value.id,
    role: 'human',
    body,
    createdAt: Math.floor(Date.now() / 1000),
    editedAt: null,
    streaming: false,
    streamingStatus: null,
    replyTo: null,
  })
  composer.value = ''
  await nextTick()
  scrollToBottom()
  try {
    await ($fetch as any)(`/api/agents/${props.agentName}/chat/messages`, {
      method: 'POST',
      body: { body },
    })
    await load()
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('chat.error.sendFailed')
    messages.value = messages.value.filter(m => m.id !== localId)
  }
  finally {
    sending.value = false
    composerEl.value?.focus()
  }
}

function scrollToBottom(): void {
  const el = scrollRoot.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function onComposerKey(e: KeyboardEvent): void {
  // Enter = send, Shift+Enter = newline. ChatGPT convention.
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

function formatTs(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `${hh}:${mm}`
  return `${d.toLocaleDateString(locale.value)} ${hh}:${mm}`
}

watch(() => props.agentName, () => {
  loading.value = true
  messages.value = []
  void load()
})

onMounted(() => {
  void load().then(() => startPolling())
})
onBeforeUnmount(() => stopPolling())
</script>

<template>
  <div class="agent-chat">
    <div
      v-if="error"
      class="banner banner-error"
    >
      {{ error }}
      <button
        v-if="loading === false"
        class="banner-action"
        @click="error = null; loading = true; void load()"
      >
        {{ $t('common.retry') }}
      </button>
    </div>

    <div
      ref="scrollRoot"
      class="scroll"
    >
      <div
        v-if="loading"
        class="state state-loading"
      >
        {{ $t('chat.loading') }}
      </div>
      <div
        v-else-if="empty"
        class="state state-empty"
      >
        <p class="empty-title">
          {{ $t('chat.empty.title') }}
        </p>
        <p class="empty-sub">
          {{ $t('chat.empty.sub') }}
        </p>
      </div>

      <ul
        v-else
        class="messages"
      >
        <li
          v-for="m in messages"
          :key="m.id"
          class="msg" :class="[`msg-${m.role}`]"
        >
          <div class="bubble">
            <div
              v-if="m.streaming && !m.body"
              class="typing"
            >
              <span /> <span /> <span />
            </div>
            <pre v-else class="body">{{ m.body }}</pre>
            <div
              v-if="m.streamingStatus"
              class="status"
            >
              {{ m.streamingStatus }}
            </div>
          </div>
          <div class="meta">
            {{ formatTs(m.createdAt) }}<span v-if="m.editedAt"> · {{ $t('chat.edited') }}</span>
          </div>
        </li>
      </ul>
    </div>

    <div class="composer">
      <textarea
        ref="composerEl"
        v-model="composer"
        rows="1"
        :placeholder="$t('chat.composer.placeholder')"
        :disabled="sending || loading || !chat"
        @keydown="onComposerKey"
      />
      <button
        class="send"
        :disabled="!composer.trim() || sending || !chat"
        @click="send"
      >
        <span v-if="sending">…</span>
        <svg v-else viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M3 11L21 3l-8 18-2-7-8-3z" fill="currentColor" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Mobile-first ChatGPT-style: single column, max 720px on wide screens,
   sticky composer at the bottom, soft bubbles, alternating alignment. */

.agent-chat {
  display: flex;
  flex-direction: column;
  /* Mobile-first: take the bulk of the viewport so the chat doesn't
     feel cramped between header + other agent sections. dvh handles
     the iOS URL bar resize correctly; vh stays as a fallback. The
     90 / 80 split gives the agent-details accordion a peek-of-card
     hint at the bottom so the operator knows there's more below. */
  height: 80vh;
  height: 80dvh;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
  background: var(--ui-bg, #fafafa);
}

.banner {
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.banner-error {
  background: #fef2f2;
  color: #991b1b;
  border-bottom: 1px solid #fecaca;
}
.banner-action {
  margin-left: auto;
  background: #991b1b;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 1rem;
  /* iOS overscroll feels right with rubber-band on the chat list */
  -webkit-overflow-scrolling: touch;
  scroll-behavior: smooth;
}

.state {
  text-align: center;
  color: #6b7280;
  padding: 3rem 1rem;
  font-size: 0.875rem;
}
.empty-title {
  font-weight: 500;
  margin: 0 0 0.25rem;
}
.empty-sub {
  margin: 0;
  font-size: 0.8125rem;
}

.messages {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.msg {
  display: flex;
  flex-direction: column;
  max-width: 86%;
}
.msg-human {
  align-self: flex-end;
  align-items: flex-end;
}
.msg-agent {
  align-self: flex-start;
  align-items: flex-start;
}

.bubble {
  padding: 0.625rem 0.875rem;
  border-radius: 18px;
  font-size: 0.9375rem;
  line-height: 1.45;
  word-wrap: break-word;
  position: relative;
}
.msg-human .bubble {
  background: #f97316;
  color: white;
  border-bottom-right-radius: 4px;
}
.msg-agent .bubble {
  background: #fff;
  color: #111827;
  border: 1px solid #e5e7eb;
  border-bottom-left-radius: 4px;
}

.body {
  margin: 0;
  font-family: inherit;
  white-space: pre-wrap;
}
.status {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  opacity: 0.7;
  font-style: italic;
}

.typing {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 4px 0;
}
.typing span {
  width: 6px;
  height: 6px;
  background: currentColor;
  border-radius: 50%;
  opacity: 0.35;
  animation: typing-bounce 1.2s infinite ease-in-out;
}
.typing span:nth-child(2) { animation-delay: 0.15s; }
.typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes typing-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.35; }
  40% { transform: scale(1); opacity: 0.85; }
}

.meta {
  margin-top: 0.1875rem;
  font-size: 0.6875rem;
  color: #9ca3af;
  padding: 0 0.5rem;
}

.composer {
  flex: 0 0 auto;
  padding: 0.625rem 0.75rem calc(env(safe-area-inset-bottom, 0) + 0.625rem);
  background: #fff;
  border-top: 1px solid #e5e7eb;
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  /* Make sure the composer is the bottom row of the chat container
     even when the messages list has no overflow yet (empty chat). */
  margin-top: auto;
}
.composer textarea {
  flex: 1 1 auto;
  resize: none;
  border: 1px solid #d1d5db;
  border-radius: 22px;
  padding: 0.625rem 0.875rem;
  /* 1rem = 16px on iOS prevents the auto-zoom on focus that makes the
     textarea look "squeezed" in screenshots. Minimum height bumped so
     the input doesn't collapse to a single-char-tall pill when empty. */
  font-size: 1rem;
  line-height: 1.4;
  font-family: inherit;
  outline: none;
  min-height: 44px;
  max-height: 140px;
  /* Explicit colors — without these the textarea inherits the page's
     light text colour from troop's dark-themed wrapper, which lands as
     near-invisible faint text on the composer's white background.
     Override here for both light + dark; placeholder gets its own
     darker grey so it doesn't look like real typed-in text. */
  background: #ffffff;
  color: #111827;
}
.composer textarea::placeholder {
  color: #9ca3af;
  opacity: 1;
}
.composer textarea:focus {
  border-color: #f97316;
  box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.15);
}
.composer textarea:disabled {
  background: #f3f4f6;
  color: #9ca3af;
}

.send {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: #f97316;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}
.send:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}
.send:not(:disabled):active {
  background: #ea580c;
}

@media (min-width: 768px) {
  .agent-chat {
    height: 75vh;
    border-radius: 12px;
    border: 1px solid #e5e7eb;
    overflow: hidden;
  }
}

@media (prefers-color-scheme: dark) {
  .agent-chat {
    background: #0a0a0a;
  }
  .msg-agent .bubble {
    background: #1f1f1f;
    color: #f3f4f6;
    border-color: #2e2e2e;
  }
  .composer {
    background: #0f0f0f;
    border-top-color: #2e2e2e;
  }
  .composer textarea {
    background: #1f1f1f;
    color: #f3f4f6;
    border-color: #3a3a3a;
  }
  .composer textarea::placeholder {
    color: #6b7280;
  }
  .composer textarea:disabled {
    background: #161616;
  }
  .meta {
    color: #6b7280;
  }
  @media (min-width: 768px) {
    .agent-chat {
      border-color: #2e2e2e;
    }
  }
}
</style>
