<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{ send: [body: string] }>()
const draft = ref('')
const sending = ref(false)

async function submit() {
  const body = draft.value.trim()
  if (!body || sending.value) return
  sending.value = true
  try {
    emit('send', body)
    draft.value = ''
  }
  finally {
    sending.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  // Enter sends, Shift+Enter for newline. Mobile keyboards typically expose
  // a "send" button that triggers Enter so this works on phones too.
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <form
    class="flex gap-2 p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] border-t border-zinc-800 bg-zinc-950/95 backdrop-blur sticky bottom-0"
    @submit.prevent="submit"
  >
    <UTextarea
      v-model="draft"
      placeholder="Write a message…"
      :disabled="sending"
      :rows="1"
      autoresize
      class="flex-1"
      :ui="{ base: 'resize-none' }"
      @keydown="onKeydown"
    />
    <UButton
      type="submit"
      color="primary"
      icon="i-lucide-send"
      :loading="sending"
      :disabled="!draft.trim() || sending"
      square
      aria-label="Send"
    />
  </form>
</template>
