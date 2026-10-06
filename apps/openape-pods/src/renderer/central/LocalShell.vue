<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { diagnostic } from '../i18n'
import type { CentralCommand } from '../../contracts/central'
import type { NetworkCommand, NetworkView } from '../../contracts/networks'
import type { AccessProposal, MasterCommand } from '../../contracts/master'
import type { WorkflowCommand, WorkflowView } from '../../contracts/workflows'
import type { ScheduleCommand } from '../../contracts/scheduling'
import type { RunCommand } from '../../contracts/runs'
import type { MapView } from '../../contracts/map-view'
import type { SecretsCommand, SecretsView } from '../../contracts/secrets'
import type { PortableSourceSelection } from '../../contracts/sharing'
import AutomationsShell from './AutomationsShell.vue'
import type { NetworkControl, WorkflowControl } from './AutomationDetail.vue'

/**
 * The shell on this desktop: the local worker answers every read and owner command through the
 * native bridge. Hosts (the registered desktop workspace and the local app) only decide where the
 * editor, the portable packages and the advanced settings open.
 */
defineProps<{ sharing?: boolean }>()
const emit = defineEmits<{ openPod: [id: string], share: [selection: PortableSourceSelection], advanced: [], import: [] }>()
const map = ref<MapView | null>(null)
const networks = ref<NetworkView>({ networks: [] })
const workflows = ref<WorkflowView>({ workflows: [], runs: [] })
const proposals = ref<AccessProposal[]>([])
const codexConnected = ref<boolean | null>(null)
const secrets = ref<SecretsView | null>(null)
const tab = ref<'automations' | 'decisions'>('automations')
const now = ref(Date.now())
const error = ref('')
let polls = 0
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false
async function poll() {
  try {
    const [inventory, networkView, workflowView] = await Promise.all([window.pods.workspace({ type: 'map' }), window.pods.networks({ type: 'list' }), window.pods.workflows({ type: 'list' })])
    map.value = inventory.map ?? null; networks.value = networkView; workflows.value = workflowView; now.value = Date.now(); error.value = ''
    // Setup proposals, the Codex connection and secret requests change rarely; they are read every tenth poll.
    if (polls++ % 10 === 0) { proposals.value = (await window.pods.master({ type: 'list' })).proposals; codexConnected.value = (await window.pods.codex({ type: 'status' })).state === 'connected'; secrets.value = window.pods.secrets ? await window.pods.secrets({ type: 'list' }) : null }
  }
  catch (cause) { error.value = String(cause) }
  if (!closed) timer = setTimeout(() => { void poll() }, 1000)
}
onMounted(poll)
onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
// Owner commands go to the local worker; the next poll shows the result.
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
</script>

<template>
  <p v-if="error" role="alert" class="error-message">
    {{ diagnostic(error) }}
  </p>
  <AutomationsShell :view="map" :live="true" :now="now" :decisions="map?.kpis.decisions.reduce((sum, item) => sum + item.count, 0)" desktop :sharing="sharing" :codex="codexConnected === null ? undefined : codexConnected ? 'connected' : 'disconnected'" :tab="tab" :inbox="{ choices: networks.choices ?? [], gates: networks.gates ?? [], graphGates: workflows.gates ?? null, proposals }" :secrets="secrets" @update:tab="tab = $event" @network-command="networkCommand" @workflow-command="workflowCommand" @master="masterCommand" @command="localCommand" @network="networkControl" @workflow="workflowControl" @folder="openFolder" @secrets="secretsCommand" @secret-save="secretSave" @open-pod="emit('openPod', $event)" @share="emit('share', $event)" @advanced="emit('advanced')" @import="emit('import')" />
</template>
