<script lang="ts">
import ProgramPermissions from './ProgramPermissions.vue'
import ScriptAccess from './ScriptAccess.vue'
import { t, diagnostic, label } from './i18n'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { ResourceCommand, ResourceState } from '../contracts/resources'

export default defineComponent({
  components: { ProgramPermissions, ScriptAccess },
  props: { requiredAliases: { type: Array as PropType<string[]>, default: () => [] }, mode: { type: String, default: 'permissions' }, selectedPodId: { type: String, default: '' } },
  emits: ['selected', 'discuss'],
  data() { return { pods: [] as StoredPod[], podId: '', state: { resources: [], epoch: 0 } as ResourceState, busy: false, error: '', credentialAlias: '', credentialValue: '' } },
  computed: { missingAliases(): string[] { return this.requiredAliases.filter(alias => !this.visibleResources.some(resource => resource.name === alias)) }, visibleResources() { return this.state.resources.filter(resource => this.mode === 'values' ? resource.kind === 'credential' : resource.kind === 'reference') } },
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
    async saveCredential() {
      const value = this.credentialValue; this.credentialValue = ''
      await this.act({ type: 'saveCredential', podId: this.podId, alias: this.credentialAlias, value, epoch: this.state.epoch })
    },
    async load() { this.credentialValue = ''; await this.act({ type: 'list', podId: this.podId }) },
  },
})
</script>

<template>
  <article class="card resource-panel">
    <div class="card-heading">
      <h2>{{ t(mode === 'values' ? 'Secrets' : 'Permissions') }}</h2><span class="badge">{{ t("Explicit pod access") }}</span>
    </div>
    <p v-if="mode !== 'values'" class="muted">
      {{ t('This pod can read and write its own workspace. Additional files are provided as read-only snapshots.') }}
    </p>
    <p v-if="!pods.length" class="muted">
      {{ t("Create a local pod in Settings to assign its first reference.") }}
    </p>
    <template v-else>
      <label v-if="!selectedPodId">{{ t("Pod") }}<select v-model="podId" :disabled="busy" @change="load"><option v-for="pod in pods" :key="pod.id" :value="pod.id">{{ pod.name }}</option></select></label>
      <h3 v-if="mode !== 'values'">
        {{ t('Directory permissions') }}
      </h3>
      <p v-if="mode !== 'values'">
        {{ t('Pod workspace · read and write') }}
      </p>
      <div v-if="mode !== 'values'" class="resource-actions">
        <button class="secondary" :disabled="busy" @click="act({ type: 'pickReference', podId })">
          {{ t("Assign reference file") }}
        </button>
        <button class="secondary" :disabled="busy || !state.resources.some(resource => resource.state === 'ready')" @click="act({ type: 'snapshot', podId })">
          {{ t("Preview next snapshot") }}
        </button>
      </div>
      <template v-if="mode === 'values'">
        <article v-for="alias in missingAliases" :key="alias" class="resource-row">
          <div>
            <strong>{{ alias }}</strong><p class="muted">
              {{ t('Requested secret · Not set') }}
            </p>
          </div>
          <button class="text-button" :disabled="busy" @click="credentialAlias = alias">
            {{ t('Set secret') }}
          </button>
        </article>
      </template>
      <form v-if="mode === 'values'" class="credential-form" @submit.prevent="saveCredential">
        <h3>{{ t('Script credentials') }}</h3>
        <p class="muted">
          {{ t('Store an encrypted value for this pod. The alias is visible; the value is never shown again. Saving or replacing pauses the pod and requires script validation and credential approval again.') }}
        </p>
        <label>{{ t('Credential alias') }}<input v-model="credentialAlias" name="credential-alias" pattern="[a-z][a-z0-9_-]{0,63}" maxlength="64" required :disabled="busy" autocomplete="off"></label>
        <label>{{ t('Credential value') }}<input v-model="credentialValue" name="credential-value" type="password" maxlength="16384" required :disabled="busy" autocomplete="new-password"></label>
        <button class="secondary" :disabled="busy || !credentialAlias || !credentialValue">
          {{ t('Save or replace credential') }}
        </button>
      </form>
      <p v-if="!visibleResources.length && !missingAliases.length" class="muted">
        {{ t(mode === 'values' ? 'No secrets assigned.' : 'Nothing assigned. This pod cannot read reference files.') }}
      </p>
      <article v-for="resource in visibleResources" :key="resource.id" class="resource-row">
        <div>
          <strong>{{ resource.name }}</strong><p class="resource-path">
            {{ resource.configuration.path ?? resource.configuration.account ?? resource.configuration.scope }}
          </p><span class="badge">{{ t("{p0} · revision {p1}", { p0: label(resource.state), p1: resource.revision }) }}</span><p v-if="resource.kind !== 'reference'" class="muted">
            {{ resource.configuration.scope }}
          </p><button v-if="['expired', 'missing', 'refreshRequired'].includes(resource.state)" class="text-button" @click="$emit('discuss')">
            {{ t("Resolve access in master chat") }}
          </button>
        </div>
        <button v-if="mode === 'values'" class="text-button" :disabled="busy" @click="credentialAlias = resource.name">
          {{ t('Replace secret') }}
        </button>
        <button class="text-button" :disabled="busy || resource.state === 'revoked'" @click="act({ type: 'revoke', podId, id: resource.id, revision: resource.revision })">
          {{ t("Revoke access") }}
        </button>
      </article>
      <ScriptAccess v-if="mode === 'values' && podId" :key="state.epoch" :pod-id="podId" kind="secrets" />
      <ProgramPermissions v-if="mode !== 'values'" :pod-id="podId" :state="state" @updated="value => { state = value }" />
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
select, input { min-width:0; padding: 10px; border: 1px solid currentColor; border-radius: 8px; font: inherit; background: transparent; color: inherit; }
.credential-form { border-top:1px solid #81908355; padding:16px 0; } .credential-form button { margin-top:16px; }
.resource-actions { display: flex; gap: 10px; margin: 20px 0; flex-wrap: wrap; }
.resource-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; border-top: 1px solid #81908355; padding: 20px 0; }
.resource-row > div { min-width:0; overflow-wrap:anywhere; }
.resource-path { overflow-wrap: anywhere; font-size: 13px; opacity: .75; }
.snapshot-result { border-top: 1px solid #81908355; padding-top: 12px; }
.resource-row>div { flex:1 1 260px; min-width:0; overflow-wrap:anywhere; }
</style>
