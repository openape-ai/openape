<script setup lang="ts">
import SharingImport from '../SharingImport.vue'
import type { SharingCommand, SharingState } from '../../contracts/sharing'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { NetworkChoiceView } from '../../contracts/networks'
import type { NetworkGateView } from '../../contracts/network-gate-view'
import type { CentralCommand, CentralRuntime } from '../../contracts/central'
import type { BrowserWorkspaceClient } from './client'
import { WorkspaceRequestError } from './client'
import WorkspaceFrame from '../WorkspaceFrame.vue'
import AccountStatus from '../AccountStatus.vue'
import CentralWorkspace from './CentralWorkspace.vue'
import AutomationsShell from './AutomationsShell.vue'
import { kpiFacts } from '../utils/kpis'
import { t, diagnostic } from '../i18n'

/**
 * The browser renders the same shell from the published snapshot of the selected desktop; owner
 * commands travel through the relay. The remote Pod editor and the package import open from it.
 */
const props = defineProps<{ client: BrowserWorkspaceClient }>()
const emit = defineEmits<{ login: [], logout: [] }>()
const subject = ref('')
const error = ref('')
const connectionError = ref('')
const page = ref<'Automations' | 'Pods' | 'Import'>('Automations')
const now = ref(Date.now())
const tab = ref<'automations' | 'decisions'>('automations')
const inbox = ref<{ choices: NetworkChoiceView[], gates: NetworkGateView[] }>({ choices: [], gates: [] })
const runtimes = ref<CentralRuntime[]>([])
const runtimeId = ref('')
const loaded = ref(false)
const workspace = ref<InstanceType<typeof CentralWorkspace> | null>(null)
const runtime = computed(() => runtimes.value.find(item => item.id === runtimeId.value) ?? runtimes.value[0])
const sharingApi = (command: SharingCommand) => workspace.value!.command('sharing', command as unknown as Record<string, unknown>, runtime.value) as Promise<SharingState>
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
  void loadInbox()
  if (!value.some(host => host.id === runtimeId.value)) runtimeId.value = value[0]?.id ?? ''
}
function back() {
  workspace.value?.requestNavigation(() => { workspace.value?.showInventory(true); page.value = 'Automations' })
}
// Choices and batches are bounded reads served by the online desktop, one per network with open decisions.
async function loadInbox() {
  const host = runtime.value
  if (!host?.online || !props.client.network) { inbox.value = { choices: [], gates: [] }; return }
  const pending = (host.networks?.networks ?? []).filter(network => network.decisions)
  try {
    const details = await Promise.all(pending.map(network => props.client.network!(host.id, { type: 'detail', id: network.id, revision: network.revision })))
    inbox.value = { choices: details.flatMap(detail => detail.choices ?? []), gates: details.flatMap(detail => detail.gates ?? []) }
  }
  catch (cause) { connectionError.value = cause instanceof Error ? cause.message : String(cause) }
}
async function openPod(id: string) {
  if (!runtime.value) return
  await workspace.value?.select(runtime.value.id, id)
  page.value = 'Pods'
}
const remoteCommand = (command: CentralCommand) => void workspace.value?.command(command.channel, command.body, runtime.value)
function expired() { subject.value = ''; runtimes.value = []; emit('login') }
function logout() { workspace.value?.requestNavigation(() => emit('logout')) }
onMounted(signIn)
onBeforeUnmount(() => { closed = true })
defineExpose({ openPod })
</script>

<template>
  <WorkspaceFrame browser>
    <template #account>
      <AccountStatus v-if="subject" :subject="subject" />
    </template>
    <template #status>
      <span class="muted" role="status">{{ !loaded ? t('Loading workspace…') : runtime?.online ? t('Desktop online') : t('Desktop offline') }}</span>
      <label v-if="runtimes.length > 1" class="runtime-picker">{{ t('Desktop') }}<select v-model="runtimeId"><option v-for="host in runtimes" :key="host.id" :value="host.id">{{ host.id }} · {{ host.online ? t('online') : t('offline') }}</option></select></label>
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
    <button v-if="subject && page !== 'Automations'" class="text-button" data-testid="back-to-automations" @click="back">
      ‹ {{ t('Automations') }}
    </button>
    <p v-if="subject && loaded && !runtime && page === 'Automations'" class="muted">
      {{ t('Connect your desktop to bring your Pods online.') }}
    </p>
    <AutomationsShell v-if="subject && page === 'Automations'" :view="runtime?.workspace.map ?? null" :live="!!runtime?.online" :now="now" :decisions="runtime?.workspace.map ? kpiFacts(runtime.workspace.map).decisions.count : undefined" :tab="tab" :inbox="{ choices: inbox.choices, gates: inbox.gates }" :subject="subject" :sharing="!!runtime?.online" @update:tab="tab = $event" @logout="logout" @command="remoteCommand" @open-pod="openPod" @import="page = 'Import'" />
    <SharingImport v-if="subject && page === 'Import' && runtime" :api="sharingApi" :organization="runtime.workspace.organization" :desktop="false" @open-pod="openPod" />
    <CentralWorkspace v-if="subject" v-show="page === 'Pods'" ref="workspace" :client="client" embedded shared-editor @inventory="inventory" @connection="connectionError = $event" @network="back" @login="expired" @logout="logout" />
  </WorkspaceFrame>
</template>

<style scoped>
.runtime-picker{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
</style>
