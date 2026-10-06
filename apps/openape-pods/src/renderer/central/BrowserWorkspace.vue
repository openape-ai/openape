<script setup lang="ts">
import SharingImport from '../SharingImport.vue'
import type { SharingCommand, SharingState } from '../../contracts/sharing'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CentralNetworkRead } from '../../contracts/central-networks'
import type { NetworkView } from '../../contracts/networks'
import type { CentralRuntime } from '../../contracts/central'
import type { BrowserWorkspaceClient } from './client'
import { WorkspaceRequestError } from './client'
import WorkspaceFrame from '../WorkspaceFrame.vue'
import AccountStatus from '../AccountStatus.vue'
import AppSettings from '../AppSettings.vue'
import WorkflowPanel from '../WorkflowPanel.vue'
import GraphPanel from '../GraphPanel.vue'
import CentralWorkspace from './CentralWorkspace.vue'
import AutomationsShell from './AutomationsShell.vue'
import { t, diagnostic } from '../i18n'

const props = defineProps<{ client: BrowserWorkspaceClient }>()
const emit = defineEmits<{ login: [], logout: [] }>()
const subject = ref('')
const error = ref('')
const connectionError = ref('')
const page = ref('Automations')
const now = ref(Date.now())
const runtimes = ref<CentralRuntime[]>([])
const runtimeId = ref('')
const workflowId = ref('')
const loaded = ref(false)
const importing = ref(false)
const workspace = ref<InstanceType<typeof CentralWorkspace> | null>(null)
const runtime = computed(() => runtimes.value.find(item => item.id === runtimeId.value) ?? runtimes.value[0])
const sharingApi = (command: SharingCommand) => workspace.value!.command('sharing', command as unknown as Record<string, unknown>, runtime.value) as Promise<SharingState>
const count = computed(() => runtimes.value.reduce((sum, host) => sum + host.workspace.pods.filter(pod => pod.lifecycle !== 'archived').length, 0))
let closed = false
async function signIn() {
  error.value = ''
  try {
    const session = await props.client.session()
    if (!closed) subject.value = session.subject
  }
  catch (cause) {
    if (closed) return
    if (cause instanceof WorkspaceRequestError && cause.status === 401) emit('login')
    else error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
function inventory(value: CentralRuntime[]) {
  runtimes.value = value; loaded.value = true; now.value = Date.now()
  if (!value.some(host => host.id === runtimeId.value)) { runtimeId.value = value[0]?.id ?? ''; workflowId.value = '' }
}
function navigate(destination: string) {
  workspace.value?.requestNavigation(() => { workspace.value?.showInventory(true); workflowId.value = ''; page.value = destination })
}
async function readNetwork(command: CentralNetworkRead): Promise<NetworkView> {
  const host = runtime.value
  if (!host) throw new Error('Desktop is unavailable')
  if (command.type === 'list') return host.networks ?? { networks: [] }
  if (!host.online) throw new Error('Desktop offline: network details require the connected runtime')
  if (!props.client.network) throw new Error('Network details require a newer relay')
  return props.client.network(host.id, command)
}
async function openPod(id: string) {
  if (!runtime.value) return
  await workspace.value?.select(runtime.value.id, id)
  page.value = 'Pods'
}
function expired() { subject.value = ''; runtimes.value = []; emit('login') }
function logout() { workspace.value?.requestNavigation(() => emit('logout')) }
onMounted(signIn)
onBeforeUnmount(() => { closed = true })
</script>

<template>
  <WorkspaceFrame automations :page="page" :count="loaded ? count : undefined" browser @navigate="navigate">
    <template #account>
      <AccountStatus v-if="subject" :subject="subject" @open="navigate('App settings')" />
    </template>
    <template #status>
      <span class="muted" role="status">{{ !loaded ? t('Loading workspace…') : runtime?.online ? t('Desktop online') : t('Desktop offline') }}</span>
    </template>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }} <button class="secondary" @click="signIn">
        {{ t('Retry') }}
      </button>
    </p>
    <p v-if="connectionError && page !== 'Pods'" class="error-message" role="alert">
      {{ diagnostic(connectionError) }} <button class="secondary" @click="workspace?.refresh()">
        {{ t('Retry') }}
      </button>
    </p>
    <AutomationsShell v-if="subject && page === 'Automations'" :view="runtime?.workspace.map ?? null" :live="!!runtime?.online" :now="now" :decisions="runtime?.workspace.map?.kpis.decisions.reduce((sum, item) => sum + item.count, 0)" @settings="navigate('App settings')" @open="openPod" />
    <section v-if="subject" v-show="page === 'Workflows'">
      <template v-if="importing && runtime">
        <button class="text-button" @click="importing = false">
          ‹ {{ t('Networks & workflows') }}
        </button>
        <SharingImport :api="sharingApi" :organization="runtime.workspace.organization" :desktop="false" @open-pod="openPod" />
      </template>
      <p v-else-if="runtime?.online" class="graph-overview-actions">
        <button class="secondary" @click="importing = true">
          {{ t('Import') }}
        </button>
      </p>
      <header v-if="!importing && !(runtime?.workflows?.graphs || runtime?.networks)" class="inventory-heading">
        <div>
          <h1>{{ t('Networks & workflows') }}</h1><p class="muted">
            {{ t('Networks connect Pods. Workflows define ordered processes.') }}
          </p>
        </div>
      </header>
      <label v-if="runtimes.length > 1 && !importing" class="runtime-picker">{{ t('Desktop') }}<select v-model="runtimeId" @change="workflowId = ''"><option v-for="host in runtimes" :key="host.id" :value="host.id">{{ host.id }} · {{ host.online ? t('Online') : t('Offline') }}</option></select></label>
      <p v-if="!loaded" class="muted" role="status">
        {{ t('Loading workspace…') }}
      </p>
      <p v-else-if="!runtime" class="muted">
        {{ t('Connect your desktop to bring your Pods online.') }}
      </p>
      <template v-else-if="!importing">
        <p v-if="!runtime.online" class="muted">
          {{ t('Desktop offline') }} · {{ t('Showing the last synchronized networks and workflows.') }}
        </p>
        <GraphPanel v-if="runtime.workflows?.graphs || runtime.networks" :key="`graphs:${runtime.id}`" :view="runtime.workflows ?? { workflows: [], runs: [] }" :read-network="readNetwork" :pods="runtime.workspace.pods" :organization="runtime.workspace.organization" :descriptions="runtime.workspace.descriptions ?? []" :selected-id="workflowId" read-only @select="workflowId = $event" @open-pod="openPod" />
        <WorkflowPanel v-else-if="runtime.workflows" :key="runtime.id" :view="runtime.workflows" :pods="runtime.workspace.pods" :selected-id="workflowId" read-only @select="workflowId = $event" @open-pod="openPod" />
        <p v-else class="muted" role="status">
          {{ t('Workflow data is not available yet. Reconnect the desktop to synchronize it.') }}
        </p>
      </template>
    </section>
    <AppSettings v-if="subject && page === 'App settings'" browser :subject="subject" @logout="logout" />
    <CentralWorkspace v-if="subject" v-show="page === 'Pods'" ref="workspace" :client="client" embedded shared-editor @settings="navigate('App settings')" @inventory="inventory" @network="(host, id) => { runtimeId = host; workflowId = id; page = 'Workflows' }" @connection="connectionError = $event" @login="expired" />
  </WorkspaceFrame>
</template>

<style scoped>
.runtime-picker{display:grid;gap:8px;margin-bottom:20px}.runtime-picker select{max-width:100%;padding:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px;font:inherit}
</style>
