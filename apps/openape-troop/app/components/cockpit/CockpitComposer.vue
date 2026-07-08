<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ streaming: boolean }>()
const emit = defineEmits<{ send: [text: string]; stop: [] }>()
const text = ref('')
const ta = ref<HTMLTextAreaElement | null>(null)
function autoGrow(): void {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}
function onSubmit(): void {
  const value = text.value.trim()
  if (!value) return
  emit('send', value)
  text.value = ''
  requestAnimationFrame(() => { if (ta.value) ta.value.style.height = 'auto' })
}
</script>

<template>
  <form class="composer" @submit.prevent="onSubmit">
    <textarea
      ref="ta"
      v-model="text"
      class="composer-input"
      rows="1"
      placeholder="Nachricht…"
      enterkeyhint="send"
      autocapitalize="sentences"
      autocomplete="off"
      autocorrect="off"
      @input="autoGrow"
      @keydown.enter.exact.prevent="onSubmit"
    />
    <button v-if="!streaming" class="icon-btn send" type="submit" :disabled="!text.trim()" aria-label="Senden">
      ↑
    </button>
    <button v-else class="icon-btn stop" type="button" aria-label="Stopp" @click="emit('stop')">
      ■
    </button>
  </form>
</template>
