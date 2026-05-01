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
</script>

<template>
  <div
    class="flex flex-col gap-1"
    :class="isMine ? 'items-end' : 'items-start'"
  >
    <div class="text-xs text-zinc-500 px-1 flex items-center gap-1">
      <span>{{ message.senderEmail }}</span>
      <span v-if="message.senderAct === 'agent'" title="agent">🤖</span>
      <span>·</span>
      <span>{{ time }}</span>
      <span v-if="message.editedAt" class="italic">(edited)</span>
    </div>
    <div
      class="rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words max-w-[85%] md:max-w-prose"
      :class="isMine
        ? 'bg-primary-500 text-zinc-950 rounded-br-md'
        : 'bg-zinc-800 text-zinc-100 rounded-bl-md'"
    >
      {{ message.body }}
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
