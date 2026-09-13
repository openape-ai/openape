<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { ScriptVersion } from '../contracts/details'

export default defineComponent({
  props: { pod: { type: Object as PropType<StoredPod>, required: true } },
  emits: ['changed'],
  data() { return { versions: [] as ScriptVersion[], error: '', message: '', busy: false } },
  async mounted() { await this.load() },
  methods: {
    async load() {
      try { this.versions = (await window.pods.details({ type: 'list', podId: this.pod.id })).versions }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not load versions' }
    },
    async activate(hash: string) {
      this.busy = true; this.error = ''; this.message = ''
      try { this.versions = (await window.pods.details({ type: 'activate', podId: this.pod.id, hash, assignmentRevision: this.pod.revision, expectedActive: this.pod.activeScript })).versions; this.message = 'Version activated for the next run. Existing runs retain their pinned version.'; this.$emit('changed') }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not activate version' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <article class="card versions-panel">
    <h2>Script versions</h2><p class="muted">
      Only versions validated for the current assignment and permissions can be activated. Choose a retained version to roll back.
    </p>
    <p v-if="!versions.length" class="muted">
      No script versions yet. Choose a local example in Runs or prepare a script in master chat.
    </p>
    <div v-for="version in versions" :key="version.hash" class="version-row">
      <code>{{ version.hash }}</code><p class="muted">
        Assignment {{ version.assignmentRevision }} · {{ version.validated ? 'Validated' : 'Needs validation' }}<span v-if="version.active"> · Active</span>
      </p><button class="secondary" :disabled="busy || version.active || !version.validated || pod.lifecycle === 'archived'" @click="activate(version.hash)">
        Activate version {{ version.hash.slice(0, 8) }}
      </button>
    </div>
    <p v-if="error" role="alert" class="error-message">
      {{ error }}
    </p><p v-if="message" role="status" class="muted">
      {{ message }}
    </p>
  </article>
</template>

<style scoped>
.versions-panel { margin-top:20px; } .version-row { padding:16px 0; border-top:1px solid var(--border); margin-top:16px; } code { overflow-wrap:anywhere; font-size:11px; } button { margin-top:10px; }
</style>
