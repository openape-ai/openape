<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { diagnostic } from '../i18n'
import type { CentralCommand } from '../../contracts/central'
import type { DomainCommand, DomainOverview } from '../../contracts/domain-admin'
import type { ScheduleCommand } from '../../contracts/scheduling'
import type { RunCommand } from '../../contracts/runs'
import type { WorkspaceCommand } from '../../contracts/control'
import type { MapView } from '../../contracts/map-view'
import type { SecretsCommand, SecretsView } from '../../contracts/secrets'
import type { PortableSourceSelection } from '../../contracts/sharing'
import AutomationsShell from './AutomationsShell.vue'
import { kpiFacts } from '../utils/kpis'

/**
 * The shell on this desktop: the local worker answers every read and owner command through the
 * native bridge. Hosts (the registered desktop workspace and the local app) only decide where the
 * editor, the portable packages and the settings page open. A host that keeps the shell mounted behind
 * another page sets `paused`: polling stops and the last map stays, so returning shows it at once.
 */
const props = defineProps<{ sharing?: boolean, paused?: boolean }>()
const emit = defineEmits<{ openPod: [id: string], share: [selection: PortableSourceSelection], settings: [] }>()
const map = ref<MapView | null>(null)
const domain = ref<DomainOverview | null>(null)
const codexConnected = ref<boolean | null>(null)
const secrets = ref<SecretsView | null>(null)
const tab = ref<'automations' | 'decisions'>('automations')
const now = ref(Date.now())
const error = ref('')
// A refused owner action stays visible until the next action succeeds; polling must not hide it.
const actionError = ref('')
let polls = 0
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false
let polling = false
async function poll() {
  if (props.paused || polling || closed) return
  polling = true; clearTimeout(timer)
  try {
    const [inventory, overview] = await Promise.all([window.pods.workspace({ type: 'map' }), window.pods.domain({ type: 'list' })])
    map.value = inventory.map ?? null; domain.value = overview as DomainOverview; now.value = Date.now(); error.value = ''
    // The Codex connection and secret requests change rarely; they are read every tenth poll.
    if (polls++ % 10 === 0) { codexConnected.value = (await window.pods.codex({ type: 'status' })).state === 'connected'; secrets.value = window.pods.secrets ? await window.pods.secrets({ type: 'list' }) : null }
  }
  catch (cause) { error.value = String(cause) }
  finally { polling = false }
  if (!closed && !props.paused) timer = setTimeout(() => { void poll() }, 1000)
}
onMounted(poll)
watch(() => props.paused, (paused) => { if (paused) clearTimeout(timer); else void poll() })
onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
// Owner commands go to the local worker; the next poll shows the result.
async function run(action: () => Promise<unknown>, settle?: (error: string | null) => void) {
  try { await action(); actionError.value = ''; settle?.(null) }
  catch (cause) { actionError.value = String(cause); settle?.(String(cause)) }
}
function localCommand(command: CentralCommand) {
  if (command.channel === 'scheduling') void run(() => window.pods.scheduling(command.body as unknown as ScheduleCommand))
  else if (command.channel === 'runs') void run(() => window.pods.runs(command.body as unknown as RunCommand))
  else if (command.channel === 'workspace') void run(() => window.pods.workspace(command.body as unknown as WorkspaceCommand))
}
const domainCommand = (command: DomainCommand, settle?: (error: string | null) => void) => void run(() => window.pods.domain(command), settle)
const openFolder = (podId: string) => void run(() => window.pods.programs({ type: 'openFolder', podId }))
const secretsCommand = (command: SecretsCommand) => void run(async () => { secrets.value = await window.pods.secrets!(command) })
// The typed value takes the existing credential path with the current resource epoch; the next poll shows the alias.
const secretSave = (podId: string, alias: string, value: string) => void run(async () => { const { epoch } = await window.pods.resources({ type: 'list', podId }); await window.pods.resources({ type: 'saveCredential', podId, alias, value, epoch }) })
</script>

<template>
  <p v-if="error" role="alert" class="error-message">
    {{ diagnostic(error) }}
  </p>
  <p v-if="actionError" role="alert" class="error-message" data-action-error>
    {{ diagnostic(actionError) }}
  </p>
  <AutomationsShell :view="map" :live="true" :now="now" :decisions="map ? kpiFacts(map).decisions.count : undefined" desktop :sharing="sharing" :codex="codexConnected === null ? undefined : codexConnected ? 'connected' : 'disconnected'" :tab="tab" :domain="domain" :secrets="secrets" @update:tab="tab = $event" @domain="domainCommand" @command="localCommand" @folder="openFolder" @secrets="secretsCommand" @secret-save="secretSave" @open-pod="emit('openPod', $event)" @share="emit('share', $event)" @settings="emit('settings')" />
</template>
