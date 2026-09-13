<script lang="ts">
import { t, diagnostic, label } from './i18n'
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
    t, diagnostic, label,
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
      <h2>{{ t("Resources") }}</h2><span class="badge">{{ t("Explicit pod access") }}</span>
    </div>
    <p class="muted">
      {{ t("{p0} Reference access is assigned separately to each pod.", { p0: state.resources.some(resource => resource.kind !== 'reference') ? t("Connections and tools use the scope assigned to this pod.") : t("No accounts or tools are connected.") }) }}
    </p>
    <p v-if="!pods.length" class="muted">
      {{ t("Create a local pod in Settings to assign its first reference.") }}
    </p>
    <template v-else>
      <label v-if="!selectedPodId">{{ t("Pod") }}<select v-model="podId" :disabled="busy" @change="load"><option v-for="pod in pods" :key="pod.id" :value="pod.id">{{ pod.name }}</option></select></label>
      <div class="resource-actions">
        <button class="secondary" :disabled="busy" @click="act({ type: 'pickReference', podId })">
          {{ t("Assign reference file") }}
        </button>
        <button class="secondary" :disabled="busy || !state.resources.some(resource => resource.state === 'ready')" @click="act({ type: 'snapshot', podId })">
          {{ t("Preview next snapshot") }}
        </button>
      </div>
      <p v-if="!state.resources.length" class="muted">
        {{ t("Nothing assigned. This pod cannot read reference files.") }}
      </p>
      <article v-for="resource in state.resources" :key="resource.id" class="resource-row">
        <div>
          <strong>{{ resource.name }}</strong><p class="resource-path">
            {{ resource.configuration.path ?? resource.configuration.account ?? resource.configuration.scope }}
          </p><span class="badge">{{ t("{p0} · revision {p1}", { p0: label(resource.state), p1: resource.revision }) }}</span><p v-if="resource.kind !== 'reference'" class="muted">
            {{ resource.configuration.scope }}
          </p><button v-if="['expired', 'missing', 'refreshRequired'].includes(resource.state)" class="text-button" @click="$emit('discuss')">
            {{ t("Resolve access in master chat") }}
          </button>
        </div>
        <button class="text-button" :disabled="busy || resource.state === 'revoked'" @click="act({ type: 'revoke', podId, id: resource.id, revision: resource.revision })">
          {{ t("Revoke access") }}
        </button>
      </article>
      <div v-if="state.snapshot" class="snapshot-result" role="status">
        <h3>{{ t("Snapshot ready") }}</h3><p>{{ t("Each file is copied and hashed. Its source remains unchanged.") }}</p>
        <p v-for="file in state.snapshot.files" :key="file.id" class="resource-path">
          {{ t("{p0} bytes · SHA-256 {p1}", { p0: file.size, p1: file.hash }) }}
        </p>
      </div>
    </template>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
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
