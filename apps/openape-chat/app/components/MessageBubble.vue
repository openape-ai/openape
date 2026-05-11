<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  message: {
    id: string
    senderEmail: string
    senderAct: 'human' | 'agent'
    body: string
    createdAt: number
    editedAt: number | null
    streaming?: boolean
    streamingStatus?: string | null
  }
  reactions?: Array<{ emoji: string, count: number, mine: boolean }>
  myEmail?: string
}

const props = defineProps<Props>()
defineEmits<{ react: [emoji: string]; unreact: [emoji: string] }>()

const isMine = computed(() => props.myEmail && props.myEmail === props.message.senderEmail)
const time = computed(() =>
  new Date(props.message.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
)

// Agent emails look like `igor30-cb6bf26a+patrick+hofmann_eco@id.openape.ai`.
// We render only the human-readable agent name — everything before
// `-<hash>+...@id.openape.ai`. Falls back to local-part for non-DDISA
// addresses (humans, federated logins).
const displayName = computed(() => {
  const email = props.message.senderEmail
  if (email.endsWith('@id.openape.ai') && email.includes('+')) {
    // DDISA agent address: <name>-<ownerHash>+<owner-local>+<owner-domain>@<idp>
    // → strip everything from the last '-' before '+' onwards.
    const local = email.split('+')[0]!
    const dash = local.lastIndexOf('-')
    return dash > 0 ? local.slice(0, dash) : local
  }
  // Human / federated address — drop the @ part for the header chip.
  return email.split('@')[0] ?? email
})

// Edit badge applies only when (a) the message isn't currently being
// streamed and (b) the edit happened more than ~2s after creation.
// The 2s window swallows the stream-end PATCH that lands within
// milliseconds of the placeholder POST — without it every agent
// message would still light up "(edited)" the moment streaming
// flips false.
const showEdited = computed(() => {
  if (props.message.streaming) return false
  if (!props.message.editedAt) return false
  return props.message.editedAt - props.message.createdAt > 2
})

const isStreaming = computed(() => props.message.streaming === true)
</script>

<template>
  <div
    class="flex flex-col gap-1"
    :class="isMine ? 'items-end' : 'items-start'"
  >
    <div class="text-xs text-zinc-500 px-1 flex items-center gap-1">
      <span class="font-medium text-zinc-300">{{ displayName }}</span>
      <span v-if="message.senderAct === 'agent'" title="agent">🤖</span>
      <span>·</span>
      <span>{{ time }}</span>
      <span v-if="showEdited" class="italic">(edited)</span>
    </div>
    <div
      class="rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words max-w-[85%] md:max-w-prose"
      :class="[
        isMine
          ? 'bg-primary-500 text-zinc-950 rounded-br-md'
          : 'bg-zinc-800 text-zinc-100 rounded-bl-md',
        isStreaming && message.body.length === 0 ? 'min-w-12' : '',
      ]"
    >
      <template v-if="message.body.length > 0">{{ message.body }}</template>
      <!-- Empty + streaming = typing placeholder. The pulsing dots are
           CSS-only so they keep animating even if the WS hiccups. -->
      <span v-if="isStreaming && message.body.length === 0" class="inline-flex items-center gap-1">
        <span class="size-1.5 rounded-full bg-zinc-400 animate-typing-dot" style="animation-delay: 0ms" />
        <span class="size-1.5 rounded-full bg-zinc-400 animate-typing-dot" style="animation-delay: 200ms" />
        <span class="size-1.5 rounded-full bg-zinc-400 animate-typing-dot" style="animation-delay: 400ms" />
      </span>
    </div>
    <!-- Tool-call subtitle: only shown while streaming AND a status
         was set by the bridge's onToolCall handler. Cleared on
         onToolResult / onToolError or on stream-end. -->
    <div
      v-if="isStreaming && message.streamingStatus"
      class="text-xs text-zinc-500 px-1 italic"
    >
      {{ message.streamingStatus }}
    </div>
    <div v-if="reactions && reactions.length" class="flex gap-1 px-1">
      <button
        v-for="r of reactions"
        :key="r.emoji"
        class="text-xs px-2 py-0.5 rounded-full border transition"
        :class="r.mine ? 'bg-primary-500/20 border-primary-500/60' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'"
        @click="r.mine ? $emit('unreact', r.emoji) : $emit('react', r.emoji)"
      >
        {{ r.emoji }} {{ r.count }}
      </button>
    </div>
  </div>
</template>

<style>
@keyframes typing-dot {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}
.animate-typing-dot {
  animation: typing-dot 1.2s ease-in-out infinite;
  display: inline-block;
}
</style>
