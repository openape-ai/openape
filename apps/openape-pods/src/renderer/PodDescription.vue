<script lang="ts">
import { defineComponent } from 'vue'
import { t, diagnostic } from './i18n'
import type { PodDescription } from '../contracts/description'

export default defineComponent({
  props: { podId: { type: String, required: true }, assignment: { type: String, required: true } },
  emits: ['change'],
  data() { return { description: null as PodDescription | null, initial: '', error: '', closed: false, timer: null as ReturnType<typeof setTimeout> | null } },
  async mounted() { await this.load() },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, diagnostic,
    async load() {
      try { const view = await window.pods.master({ type: 'list', podId: this.podId }); this.description = view.description ?? null; this.initial = view.initialRequest?.text ?? ''; this.error = '' }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not load description' }
      if (!this.closed) this.timer = setTimeout(() => { void this.load() }, 1000)
    },
    async retry() {
      try { const view = await window.pods.master({ type: 'summarize', podId: this.podId }); this.description = view.description ?? null }
      catch (error) { this.error = String(error) }
    },
  },
})
</script>

<template>
  <article class="card">
    <h2>{{ t('Description') }}</h2>
    <p class="assignment-text">
      {{ description?.text || initial || assignment }}
    </p>
    <p class="muted" role="status">
      {{ !description ? (initial ? t('Description pending') : t('Existing assignment description')) : description.state === 'ready' ? t('Generated from this conversation') : description.state === 'failed' ? t('Description not updated') : t('Updating description…') }}
    </p>
    <p v-if="error || description?.error" role="alert" class="error-message">
      {{ diagnostic(error || description?.error) }}
    </p>
    <button v-if="description?.state === 'failed' || (!description && initial)" class="secondary" @click="retry">
      {{ t('Retry description') }}
    </button>
    <button class="text-button" @click="$emit('change')">
      {{ t('Change in chat') }}
    </button>
  </article>
</template>
