<script setup lang="ts">
import { ref } from 'vue'
import { shouldSubmitComposerKey } from './composer-input'

export interface PendingFile { id: string, mime: string, name: string }

const props = defineProps<{ streaming: boolean, company: string }>()
const emit = defineEmits<{ send: [text: string, files: PendingFile[]]; stop: [] }>()
const text = ref('')
const ta = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const pending = ref<PendingFile[]>([])
const uploading = ref(false)
const uploadError = ref('')

function autoGrow(): void {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

// Upload happens on pick — send only references ids, so a slow upload never
// races the send tap. Server re-validates everything (type, size, ownership).
async function onPickFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const picked = [...(input.files ?? [])].slice(0, 4 - pending.value.length)
  input.value = ''
  uploadError.value = ''
  uploading.value = true
  try {
    for (const f of picked) {
      const form = new FormData()
      form.append('file', f)
      form.append('company', props.company)
      try {
        pending.value.push(await $fetch<PendingFile>('/api/cockpit/files', { method: 'POST', body: form }))
      }
      catch (err) {
        uploadError.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? `Upload fehlgeschlagen: ${f.name}`
      }
    }
  }
  finally { uploading.value = false }
}
function removePending(id: string): void {
  pending.value = pending.value.filter(f => f.id !== id)
}

function onSubmit(): void {
  const value = text.value.trim()
  if ((!value && !pending.value.length) || uploading.value) return
  emit('send', value, [...pending.value])
  text.value = ''
  pending.value = []
  uploadError.value = ''
  requestAnimationFrame(() => { if (ta.value) ta.value.style.height = 'auto' })
}

function onKeydown(e: KeyboardEvent): void {
  if (!shouldSubmitComposerKey(e)) return
  e.preventDefault()
  onSubmit()
}
</script>

<template>
  <form class="composer-wrap" @submit.prevent="onSubmit">
    <div v-if="pending.length || uploadError" class="attach-row">
      <span v-for="f in pending" :key="f.id" class="attach-chip">
        <span class="attach-name">{{ f.name }}</span>
        <button type="button" class="attach-remove" :aria-label="`${f.name} entfernen`" @click="removePending(f.id)">✕</button>
      </span>
      <span v-if="uploadError" class="attach-error">{{ uploadError }}</span>
    </div>
    <div class="composer">
      <input
        ref="fileInput"
        type="file"
        class="attach-input"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        multiple
        @change="onPickFiles"
      >
      <button
        type="button"
        class="icon-btn attach"
        :disabled="streaming || uploading || pending.length >= 4"
        aria-label="Datei anhängen"
        @click="fileInput?.click()"
      >
        {{ uploading ? '…' : '📎' }}
      </button>
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
        @keydown="onKeydown"
      />
      <button v-if="!streaming" class="icon-btn send" type="submit" :disabled="(!text.trim() && !pending.length) || uploading" aria-label="Senden">
        ↑
      </button>
      <button v-else class="icon-btn stop" type="button" aria-label="Stopp" @click="emit('stop')">
        ■
      </button>
    </div>
  </form>
</template>
