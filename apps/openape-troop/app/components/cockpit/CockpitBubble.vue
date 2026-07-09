<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '../../utils/cockpit/types'
import { renderMarkdown } from '../../utils/cockpit/markdown'

const props = defineProps<{ message: ChatMessage }>()
const html = computed(() => props.message.role === 'assistant' ? renderMarkdown(props.message.content) : '')
const showWaiting = computed(() => props.message.streaming && !props.message.content && !!props.message.waiting)
const showThoughts = computed(() => props.message.streaming && !props.message.content && !props.message.waiting && (props.message.thoughts?.length ?? 0) > 0)
const latestThought = computed(() => props.message.thoughts?.at(-1) ?? '')

function onCopyClick(e: MouseEvent): void {
  const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLElement | null
  if (!btn) return
  const code = btn.closest('.code-block')?.querySelector('code')?.textContent ?? ''
  void navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Kopiert'
    setTimeout(() => { btn.textContent = 'Copy' }, 1200)
  })
}
</script>

<template>
  <div class="bubble" :class="[message.role]">
    <template v-if="message.role === 'assistant'">
      <div v-if="message.content" class="md-wrap">
        <!-- eslint-disable-next-line vue/no-v-html -- assistant content is our own trusted mock/agent markdown -->
        <div class="md" @click="onCopyClick" v-html="html" />
      </div>
      <div v-else-if="message.system" class="sys-notice">
        {{ message.system }}
      </div>
      <div v-else-if="showWaiting" class="waiting">
        <span class="think-dot" />
        <span class="thought">{{ message.waiting }}</span>
      </div>
      <div v-else-if="showThoughts" class="thoughts">
        <span class="think-dot" />
        <span class="thought">{{ latestThought }}</span>
      </div>
      <span v-else-if="message.streaming" class="typing" aria-label="tippt"><i /><i /><i /></span>
    </template>
    <div v-else class="plain">
      {{ message.content }}
    </div>
  </div>
</template>
