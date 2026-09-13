<script lang="ts">
import PodVersions from './PodVersions.vue'
import PodSchedule from './PodSchedule.vue'
import { defineComponent } from 'vue'
import type { StoredPod } from '../contracts/control'

export default defineComponent({
  components: { PodSchedule, PodVersions },
  props: { selectedPodId: { type: String, default: '' } },
  emits: ['selected'],
  data() { return { pods: [] as StoredPod[], selectedId: '', name: '', assignment: '', revision: 0, error: '', message: '', busy: false } },
  computed: { selectedPod(): StoredPod | undefined { return this.pods.find(pod => pod.id === this.selectedId) } },
  watch: { async selectedPodId(id: string) { if (id === this.selectedId) return; await this.reload(); const pod = this.pods.find(pod => pod.id === id); if (pod) this.select(pod); else this.newPod() } },
  async mounted() { await this.reload(); const selected = this.pods.find(pod => pod.id === this.selectedPodId); if (selected) this.select(selected) },
  methods: {
    async reload() {
      this.busy = true
      try { this.pods = (await window.pods.workspace({ type: 'list' })).pods }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not load pods' }
      finally { this.busy = false }
    },
    select(pod: StoredPod) { this.selectedId = pod.id; this.name = pod.name; this.assignment = pod.assignment; this.revision = pod.revision; this.$emit('selected', pod.id); this.message = ''; this.error = '' },
    newPod() { this.selectedId = ''; this.name = ''; this.assignment = ''; this.revision = 0; this.$emit('selected', ''); this.message = ''; this.error = '' },
    async archive() {
      const pod = this.selectedPod; if (!pod) return
      this.busy = true; this.error = ''
      try { this.pods = (await window.pods.workspace({ type: 'update', id: pod.id, revision: pod.revision, name: pod.name, assignment: pod.assignment, lifecycle: 'archived' })).pods; this.select(this.pods.find(item => item.id === pod.id)!); this.message = 'Archived. History is retained.' }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not archive pod' }
      finally { this.busy = false }
    },
    async save() {
      this.busy = true; this.error = ''; this.message = ''
      try {
        const command = this.selectedId ? { type: 'update' as const, id: this.selectedId, revision: this.revision, name: this.name, assignment: this.assignment, lifecycle: 'paused' as const } : { type: 'create' as const, name: this.name, assignment: this.assignment }
        const state = await window.pods.workspace(command)
        this.pods = state.pods
        const saved = this.selectedId ? this.pods.find(pod => pod.id === this.selectedId) : this.pods.at(-1)
        if (!saved) throw new Error('Saved pod is missing from response')
        this.select(saved); this.message = 'Saved locally. Automatic execution is paused.'
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not save pod' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <article class="card pod-settings">
    <div class="card-heading">
      <h2>Local pods</h2><button class="text-button" :disabled="busy" @click="newPod">
        New local pod
      </button>
    </div>
    <p class="muted">
      Assignments are saved on this Mac. No accounts or schedules are activated.
    </p>
    <div class="saved-pods">
      <button v-for="pod in pods" :key="pod.id" class="secondary" :aria-pressed="selectedId === pod.id" @click="select(pod)">
        {{ pod.name }}
      </button>
    </div>
    <form @submit.prevent="save">
      <label>Pod name<input v-model="name" required maxlength="100" :disabled="busy"></label>
      <label>Assignment<textarea v-model="assignment" required maxlength="20000" rows="5" :disabled="busy" /></label>
      <p v-if="revision" class="muted">
        Assignment revision {{ revision }} · {{ selectedPod?.lifecycle }}
      </p>
      <p v-if="error" role="alert" class="error-message">
        {{ error }}
      </p>
      <p v-if="message" role="status">
        {{ message }}
      </p>
      <button class="primary" type="submit" :disabled="busy || !name.trim() || !assignment.trim()">
        {{ busy ? 'Saving…' : 'Save pod' }}
      </button>
    </form>
  </article>
  <PodSchedule v-if="selectedPod" :key="selectedPod.id" :pod="selectedPod" @changed="reload" />
  <PodVersions v-if="selectedPod" :key="`${selectedPod.id}:${selectedPod.activeScript}`" :pod="selectedPod" @changed="reload" />
  <article v-if="selectedPod" class="card lifecycle-panel">
    <h2>Pod lifecycle</h2><p class="muted">
      Archiving stops intake and preserves knowledge and run history.
    </p><button class="secondary" :disabled="busy || selectedPod.lifecycle === 'archived'" @click="archive">
      Archive pod
    </button>
  </article>
</template>

<style scoped>
.lifecycle-panel { margin-top:20px; } .lifecycle-panel button { margin-top:12px; }
.pod-settings { max-width: 780px; }
.saved-pods { display: flex; gap: 8px; flex-wrap: wrap; margin: 20px 0; }
form, label { display: grid; gap: 10px; }
form { gap: 20px; }
input, textarea { font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 8px; padding: 10px; width: 100%; box-sizing: border-box; }
form .primary { justify-self: start; }
</style>
