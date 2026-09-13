<script lang="ts">
import { defineComponent } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { ResourceCommand, ResourceState } from '../contracts/resources'

export default defineComponent({
  props: { selectedPodId: { type: String, default: '' } },
  emits: ['selected', 'discuss'],
  data() { return { pods: [] as StoredPod[], podId: '', state: { resources: [], epoch: 0 } as ResourceState, busy: false, error: '' } },
  async mounted() {
    try { this.pods = (await window.pods.workspace({ type: 'list' })).pods; this.podId = this.selectedPodId || this.pods[0]?.id || ''; if (this.podId) await this.load() }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not load resources' }
  },
  methods: {
    async act(command: ResourceCommand) {
      this.busy = true; this.error = ''
      try { this.state = await window.pods.resources(command) }
      catch (error) { this.error = error instanceof Error ? error.message : 'Resource operation failed' }
      finally { this.busy = false }
    },
    async load() { await this.act({ type: 'list', podId: this.podId }) },
  },
})
</script>

<template>
  <article class="card resource-panel">
    <div class="card-heading">
      <h2>Resources</h2><span class="badge">Explicit pod access</span>
    </div>
    <p class="muted">
      {{ state.resources.some(resource => resource.kind !== 'reference') ? 'Connections and tools use the scope assigned to this pod.' : 'No accounts or tools are connected.' }} Reference access is assigned separately to each pod.
    </p>
    <p v-if="!pods.length" class="muted">
      Create a local pod in Settings to assign its first reference.
    </p>
    <template v-else>
      <label v-if="!selectedPodId">Pod<select v-model="podId" :disabled="busy" @change="load"><option v-for="pod in pods" :key="pod.id" :value="pod.id">{{ pod.name }}</option></select></label>
      <div class="resource-actions">
        <button class="secondary" :disabled="busy" @click="act({ type: 'pickReference', podId })">
          Assign reference file
        </button>
        <button class="secondary" :disabled="busy || !state.resources.some(resource => resource.state === 'ready')" @click="act({ type: 'snapshot', podId })">
          Preview next snapshot
        </button>
      </div>
      <p v-if="!state.resources.length" class="muted">
        Nothing assigned. This pod cannot read reference files.
      </p>
      <article v-for="resource in state.resources" :key="resource.id" class="resource-row">
        <div>
          <strong>{{ resource.name }}</strong><p class="resource-path">
            {{ resource.configuration.path ?? resource.configuration.account ?? resource.configuration.scope }}
          </p><span class="badge">{{ resource.state }} · revision {{ resource.revision }}</span><p v-if="resource.kind !== 'reference'" class="muted">
            {{ resource.configuration.scope }}
          </p><button v-if="['expired', 'missing', 'refreshRequired'].includes(resource.state)" class="text-button" @click="$emit('discuss')">
            Resolve access in master chat
          </button>
        </div>
        <button class="text-button" :disabled="busy || resource.state === 'revoked'" @click="act({ type: 'revoke', podId, id: resource.id, revision: resource.revision })">
          Revoke access
        </button>
      </article>
      <div v-if="state.snapshot" class="snapshot-result" role="status">
        <h3>Snapshot ready</h3><p>Each file is copied and hashed. Its source remains unchanged.</p>
        <p v-for="file in state.snapshot.files" :key="file.id" class="resource-path">
          {{ file.size }} bytes · SHA-256 {{ file.hash }}
        </p>
      </div>
    </template>
    <p v-if="error" class="error-message" role="alert">
      {{ error }}
    </p>
  </article>
</template>

<style scoped>
.resource-panel { max-width: 840px; }
label { display: grid; gap: 8px; margin-top: 20px; }
select { padding: 10px; border: 1px solid currentColor; border-radius: 8px; font: inherit; background: transparent; color: inherit; }
.resource-actions { display: flex; gap: 10px; margin: 20px 0; flex-wrap: wrap; }
.resource-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-top: 1px solid #81908355; padding: 20px 0; }
.resource-path { overflow-wrap: anywhere; font-size: 13px; opacity: .75; }
.snapshot-result { border-top: 1px solid #81908355; padding-top: 12px; }
</style>
