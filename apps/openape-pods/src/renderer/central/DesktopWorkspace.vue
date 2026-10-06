<script setup lang="ts">
import { t, diagnostic } from '../i18n'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CentralCommand, CentralStatus } from '../../contracts/central'
import type { NetworkCommand, NetworkView } from '../../contracts/networks'
import type { AccessProposal, MasterCommand } from '../../contracts/master'
import type { WorkflowCommand, WorkflowView  } from '../../contracts/workflows'
import type { ScheduleCommand } from '../../contracts/scheduling'
import type { RunCommand } from '../../contracts/runs'
import CentralWorkspace from './CentralWorkspace.vue'
import AutomationsShell from './AutomationsShell.vue'
import type { NetworkControl, WorkflowControl } from './AutomationDetail.vue'
import type { MapView } from '../../contracts/map-view'
import type { SecretsCommand, SecretsView } from '../../contracts/secrets'
import { desktopWorkspaceClient } from './client'
import App from '../App.vue'
import WorkspaceFrame from '../WorkspaceFrame.vue'
import AppSettings from '../AppSettings.vue'
import AccountStatus from '../AccountStatus.vue'
import GraphPanel from '../GraphPanel.vue'
import SharingImport from '../SharingImport.vue'
import SharingExport from '../SharingExport.vue'
import type { PortableSourceSelection, SharingCommand } from '../../contracts/sharing'
import type { CollectionDescription, StoredPod, WorkspaceState } from '../../contracts/control'
import type { Organization } from '../../contracts/groups'

const invoke = window.pods.central!
const client = desktopWorkspaceClient(invoke)
const page = ref('Automations')
const map = ref<MapView | null>(null)
const networks = ref<NetworkView>({ networks: [] })
const proposals = ref<AccessProposal[]>([])
const codexConnected = ref<boolean | null>(null)
const secrets = ref<SecretsView | null>(null)
const tab = ref<'automations' | 'decisions'>('automations')
let polls = 0
const now = ref(Date.now())
const workspace = ref<InstanceType<typeof CentralWorkspace> | null>(null)
const workflows = ref<WorkflowView>({ workflows: [], runs: [] })
const pods = ref<StoredPod[]>([])
const organization = ref<Organization>({ revision: 1, groups: [] })
const descriptions = ref<CollectionDescription[]>([])
const workflowId = ref('')
const sharing = ref<{ mode: 'import' } | { mode: 'export', selection: PortableSourceSelection } | null>(null)
const sharingApi = (command: SharingCommand) => window.pods.sharing!(command)
const podResources = (podId: string) => window.pods.resources({ type: 'list', podId })
const error = ref('')
const registering = ref(false)
const status = ref<CentralStatus | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false
async function poll() {
  try {
    const [value, view, inventory, networkView] = await Promise.all([invoke({ type: 'status' }), window.pods.workflows({ type: 'list' }), window.pods.workspace({ type: 'map' }), window.pods.networks({ type: 'list' })])
    status.value = (value as CentralStatus & { enabled?: boolean }).enabled === false ? null : value as CentralStatus; workflows.value = view; workspaceChanged(inventory); map.value = inventory.map ?? null; networks.value = networkView; now.value = Date.now(); error.value = ''
    // Setup proposals change rarely; the chat registry behind them is read every tenth poll.
    if (polls++ % 10 === 0) { proposals.value = (await window.pods.master({ type: 'list' })).proposals; codexConnected.value = (await window.pods.codex({ type: 'status' })).state === 'connected'; secrets.value = window.pods.secrets ? await window.pods.secrets({ type: 'list' }) : null }
  }
  catch (cause) { error.value = String(cause) }
  if (!closed) timer = setTimeout(() => { void poll() }, 1000)
}
onMounted(poll)
onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
function workspaceChanged(state: WorkspaceState) {
  if (state.organization.revision < organization.value.revision) return
  pods.value = state.pods
  organization.value = state.organization
  descriptions.value = state.descriptions ?? []
}
async function register() {
  registering.value = true; error.value = ''
  try { await invoke({ type: 'register' }) }
  catch (cause) { error.value = String(cause) }
  finally { registering.value = false }
}
// Owner commands of the detail page go to the local worker; the next poll shows the result.
async function run(action: () => Promise<unknown>) {
  try { await action(); error.value = '' }
  catch (cause) { error.value = String(cause) }
}
function localCommand(command: CentralCommand) {
  if (command.channel === 'scheduling') void run(() => window.pods.scheduling(command.body as unknown as ScheduleCommand))
  else if (command.channel === 'runs') void run(() => window.pods.runs(command.body as unknown as RunCommand))
}
const networkCommand = (command: NetworkCommand) => void run(() => window.pods.networks(command))
const workflowCommand = (command: WorkflowCommand) => void run(() => window.pods.workflows(command))
const masterCommand = (command: MasterCommand) => void run(async () => { await window.pods.master(command); proposals.value = (await window.pods.master({ type: 'list' })).proposals })
const networkControl = (control: NetworkControl) => void run(() => window.pods.networks(control))
const workflowControl = (control: WorkflowControl) => void run(() => window.pods.workflows(control))
const openFolder = (podId: string) => void run(() => window.pods.programs({ type: 'openFolder', podId }))
const secretsCommand = (command: SecretsCommand) => void run(async () => { secrets.value = await window.pods.secrets!(command) })
// The typed value takes the existing credential path with the current resource epoch; the next poll shows the alias.
const secretSave = (podId: string, alias: string, value: string) => void run(async () => { const { epoch } = await window.pods.resources({ type: 'list', podId }); await window.pods.resources({ type: 'saveCredential', podId, alias, value, epoch }) })
function navigate(destination: string) {
  page.value = destination
  if (destination === 'Pods') workspace.value?.showInventory()
}
async function openPod(id: string) {
  page.value = 'Pods'
  if (status.value?.runtimeId) await workspace.value?.select(status.value.runtimeId, id)
}
</script>

<template>
  <WorkspaceFrame automations :page="page" :count="pods.filter(pod => pod.lifecycle !== 'archived').length" @navigate="navigate">
    <template #account>
      <AccountStatus @open="page = 'App settings'" />
    </template>
    <template #status>
      <span class="muted">{{ status?.state === 'online' ? t('Desktop online') : t('Desktop offline') }}</span>
    </template>
    <p v-if="status?.networkReadError" role="status" class="error-message">
      {{ t('Network details are temporarily unavailable; desktop execution remains connected.') }} {{ diagnostic(status.networkReadError) }}
    </p>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <AutomationsShell v-if="page === 'Automations'" :view="map" :live="true" :now="now" :decisions="map?.kpis.decisions.reduce((sum, item) => sum + item.count, 0)" desktop :codex="codexConnected === null ? undefined : codexConnected ? 'connected' : 'disconnected'" :tab="tab" :inbox="{ choices: networks.choices ?? [], gates: networks.gates ?? [], graphGates: workflows.gates ?? null, proposals }" :secrets="secrets" @update:tab="tab = $event" @network-command="networkCommand" @workflow-command="workflowCommand" @master="masterCommand" @command="localCommand" @network="networkControl" @workflow="workflowControl" @folder="openFolder" @secrets="secretsCommand" @secret-save="secretSave" />
    <section v-show="page === 'Workflows'">
      <template v-if="sharing">
        <button class="text-button" @click="sharing = null">
          ‹ {{ t('Networks & workflows') }}
        </button>
        <SharingImport v-if="sharing.mode === 'import'" :api="sharingApi" :organization="organization" desktop :resources="podResources" @open-pod="openPod" />
        <SharingExport v-else :key="sharing.selection.id" :selection="sharing.selection" :api="sharingApi" @done="sharing = null" />
      </template>
      <GraphPanel v-else :active="page === 'Workflows'" :view="workflows" :pods="pods" :organization="organization" :descriptions="descriptions" :selected-id="workflowId" @changed="workflows = $event" @workspace="workspaceChanged" @select="workflowId = $event" @open-pod="openPod" @share="sharing = { mode: 'export', selection: $event }" @import="sharing = { mode: 'import' }" />
    </section>
    <AppSettings v-if="page === 'App settings'">
      <template #connection>
        <section class="desktop-connection">
          <h3>{{ t('Desktop connection') }}</h3><p class="muted">
            {{ t('Connect this desktop to make its Pods available in your central workspace. The desktop executes your runs.') }}
          </p><button class="secondary" :disabled="registering" @click="register">
            {{ registering ? t('Waiting for sign-in…') : t('Register this desktop') }}
          </button>
        </section>
      </template>
    </AppSettings>
    <CentralWorkspace v-show="page === 'Pods'" ref="workspace" :client="client" :desktop-status="status" :workflows="workflows" desktop embedded>
      <template #local-editor="{ podId }">
        <App :key="podId" embedded :initial-pod-id="podId" @settings="page = 'App settings'" />
      </template>
    </CentralWorkspace>
  </WorkspaceFrame>
</template>

<style scoped>
.desktop-connection{margin-top:24px}.desktop-connection h3{margin-bottom:10px}
</style>
