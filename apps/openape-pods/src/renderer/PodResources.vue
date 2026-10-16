<script lang="ts">
import { useHostBridge } from './host-bridge'
import { usePodAccess } from './pod-access'
import SshPermissions from './SshPermissions.vue'
import ProgramPermissions from './ProgramPermissions.vue'
import DirectoryPermissions from './DirectoryPermissions.vue'
import SandboxDenylist from './SandboxDenylist.vue'
import SecretForm from './central/SecretForm.vue'
import { t, diagnostic, label } from './i18n'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { ResourceCommand, ResourceState } from '../contracts/resources'
import type { SandboxView } from '../contracts/sandbox'

export default defineComponent({
  components: { ProgramPermissions, DirectoryPermissions, SshPermissions, SandboxDenylist, SecretForm },
  props: { requestedSecret: { type: String, default: '' }, requiredAliases: { type: Array as PropType<string[]>, default: () => [] }, mode: { type: String, default: 'permissions' }, selectedPodId: { type: String, default: '' } },
  emits: ['selected', 'discuss'],
  setup() { const access = usePodAccess(); return { hostBridge: useHostBridge(), access, remoteRevision: access.revision } },
  data() { return { pods: [] as StoredPod[], podId: '', state: { resources: [], epoch: 0 } as ResourceState, sandbox: null as SandboxView | null, busy: false, error: '', credentialAlias: this.requestedSecret, message: '' } },
  computed: { missingAliases(): string[] { return this.requiredAliases.filter(alias => !this.visibleResources.some(resource => resource.name === alias && resource.state === 'ready')) }, visibleResources() { return this.state.resources.filter(resource => this.mode === 'values' ? resource.kind === 'credential' : this.access.remote && !['reference', 'directory', 'credential'].includes(resource.kind) && !['program', 'http', 'jev', 'sshInventory'].includes(String(resource.configuration.type))) } },
  watch: { remoteRevision() { if (!this.busy && !this.error && this.podId) void this.load() } },
  async mounted() {
    try { this.pods = (await this.access.api.workspace({ type: 'list' })).pods; this.podId = this.selectedPodId || this.pods[0]?.id || ''; if (this.podId) await this.load() }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not load resources' }
  },
  methods: {
    t,
    diagnostic,
    label,
    async act(command: ResourceCommand) {
      this.busy = true; this.error = ''
      try { this.state = await this.access.api.resources(command); if (this.state.sandbox) this.sandbox = this.state.sandbox }
      catch (error) { this.error = error instanceof Error ? error.message : 'Resource operation failed' }
      finally { this.busy = false }
    },
    async saveCredential(_podId: string, alias: string, value: string) {
      await this.act({ type: 'saveCredential', podId: this.podId, alias, value, epoch: this.state.epoch })
    },
    /** File import and OpenApe Secrets requests go through the desktop's secrets channel, like the inbox does. */
    async secrets(command: { type: 'importFile', podId: string, alias: string } | { type: 'request', podId: string, alias: string, purpose: string }) {
      this.busy = true; this.error = ''; this.message = ''
      try { await this.hostBridge.secrets!(command); this.message = command.type === 'request' ? t('Request sent to OpenApe Secrets.') : ''; await this.load() }
      catch (error) { this.error = error instanceof Error ? error.message : 'Secret operation failed' }
      finally { this.busy = false }
    },
    async load() { this.sandbox = null; await this.act({ type: this.mode !== 'values' && !this.access.remote ? 'sandbox' : 'list', podId: this.podId }) },
  },
})
</script>

<template>
  <article class="card resource-panel">
    <div class="card-heading">
      <h2>{{ t(mode === 'values' ? 'Secrets' : 'Permissions') }}</h2><span class="badge">{{ t("Explicit pod access") }}</span>
    </div>
    <p v-if="mode !== 'values'" class="muted">
      {{ t('HOME and the working directory belong to this pod. Choose read or read and write access for additional folders.') }}
    </p>
    <p v-if="!pods.length" class="muted">
      {{ t("Create a local pod in Settings to assign its first reference.") }}
    </p>
    <template v-else>
      <label v-if="!selectedPodId">{{ t("Pod") }}<select v-model="podId" :disabled="busy" @change="load"><option v-for="pod in pods" :key="pod.id" :value="pod.id">{{ pod.name }}</option></select></label>
      <DirectoryPermissions v-if="mode !== 'values'" :state="state" :busy="busy" :readonly="access.remote" @add="act({ type: 'pickDirectory', podId, epoch: state.epoch })" @access="(resource, access) => act({ type: 'changeDirectory', podId, id: resource.id, revision: resource.revision, epoch: state.epoch, access })" @revoke="resource => act({ type: 'revoke', podId, id: resource.id, revision: resource.revision })" />
      <SandboxDenylist v-if="mode !== 'values' && sandbox" :sandbox="sandbox" :busy="busy" @save="deny => act({ type: 'saveSandboxDeny', podId, deny })" />
      <p v-if="mode === 'values' && access.remote" class="muted">
        {{ t('Manage secrets on the desktop.') }}
      </p>
      <template v-if="mode === 'values'">
        <article v-for="alias in missingAliases" :key="alias" class="resource-row">
          <div>
            <strong>{{ alias }}</strong><p class="muted">
              {{ t('Requested secret · Not set') }}
            </p>
          </div>
          <button class="text-button" :disabled="busy || access.remote" @click="credentialAlias = alias">
            {{ t('Set secret') }}
          </button>
        </article>
      </template>
      <div v-if="mode === 'values' && !access.remote" class="credential-form">
        <h3>{{ t('Script credentials') }}</h3>
        <p class="muted">
          {{ t('Store a protected value for this pod. HTTP authentication keys stay with the runtime. Saving or replacing pauses the pod and requires script validation again.') }}
        </p>
        <SecretForm :key="credentialAlias" :pod-id="podId" :alias="credentialAlias || null" desktop @save="saveCredential" @file="(podId, alias) => secrets({ type: 'importFile', podId, alias })" @request="(podId, alias, purpose) => secrets({ type: 'request', podId, alias, purpose })" @cancel="credentialAlias = ''" />
        <p v-if="message" role="status">
          {{ message }}
        </p>
      </div>
      <p v-if="mode === 'values' && !visibleResources.length && !missingAliases.length" class="muted">
        {{ t('No secrets assigned.') }}
      </p>
      <article v-for="resource in visibleResources" :key="resource.id" class="resource-row">
        <div>
          <strong>{{ resource.name }}</strong><p class="resource-path">
            {{ resource.configuration.path ?? resource.configuration.account ?? resource.configuration.scope }}
          </p><span class="badge">{{ t("{p0} · revision {p1}", { p0: label(resource.state), p1: resource.revision }) }}</span><p v-if="resource.kind !== 'reference'" class="muted">
            {{ resource.configuration.scope }}
          </p><button v-if="['expired', 'missing', 'refreshRequired'].includes(resource.state)" class="text-button" @click="$emit('discuss')">
            {{ t("Work from Codex") }}
          </button>
        </div>
        <button v-if="mode === 'values'" class="text-button" :disabled="busy || access.remote" @click="credentialAlias = resource.name">
          {{ t('Replace secret') }}
        </button>
        <button class="text-button" :disabled="busy || resource.state === 'revoked'" @click="act({ type: 'revoke', podId, id: resource.id, revision: resource.revision })">
          {{ t("Revoke access") }}
        </button>
      </article>
      <SshPermissions v-if="mode !== 'values'" :state="state" :busy="busy" :read-only="access.remote" @assign="target => act({ type: 'assignSsh', podId, epoch: state.epoch, target })" @revoke="resource => act({ type: 'revoke', podId, id: resource.id, revision: resource.revision })" />
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
