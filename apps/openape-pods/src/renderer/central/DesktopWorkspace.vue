<script setup lang="ts">
import { useHostBridge } from '../host-bridge'
import { t, diagnostic } from '../i18n'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CentralStatus } from '../../contracts/central'
import CentralWorkspace from './CentralWorkspace.vue'
import LocalShell from './LocalShell.vue'
import { desktopWorkspaceClient } from './client'
import App from '../App.vue'
import WorkspaceFrame from '../WorkspaceFrame.vue'
import AppSettings from '../AppSettings.vue'
import AccountStatus from '../AccountStatus.vue'
import SharingImport from '../SharingImport.vue'
import type { SharingCommand } from '../../contracts/sharing'

const hostBridge = useHostBridge()

/**
 * The registered desktop: the shell is the landing page; the Pod editor, portable packages and the
 * settings page open from it and return with one button. The shell stays mounted behind those pages,
 * so returning shows the last map at once instead of loading the workspace again.
 */
const invoke = hostBridge.central!
const client = desktopWorkspaceClient(invoke)
const page = ref<'Automations' | 'Pods' | 'App settings' | 'Sharing'>('Automations')
const workspace = ref<InstanceType<typeof CentralWorkspace> | null>(null)
const sharing = ref<{ mode: 'import' } | null>(null)
const sharingApi = (command: SharingCommand) => hostBridge.sharing!(command)
const podResources = (podId: string) => hostBridge.resources({ type: 'list', podId })
const error = ref('')
const registering = ref(false)
const status = ref<CentralStatus | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false
async function poll() {
  try {
    const value = await invoke({ type: 'status' })
    status.value = (value as CentralStatus & { enabled?: boolean }).enabled === false ? null : value as CentralStatus; error.value = ''
  }
  catch (cause) { error.value = String(cause) }
  if (!closed) timer = setTimeout(() => { void poll() }, 1000)
}
onMounted(poll)
onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
async function register() {
  registering.value = true; error.value = ''
  try { await invoke({ type: 'register' }) }
  catch (cause) { error.value = String(cause) }
  finally { registering.value = false }
}
function back() { workspace.value?.requestNavigation(() => { page.value = 'Automations'; sharing.value = null }) }
async function openPod(id: string) {
  page.value = 'Pods'
  if (status.value?.runtimeId) await workspace.value?.select(status.value.runtimeId, id)
}
function importPackage() { sharing.value = { mode: 'import' }; page.value = 'Sharing' }
defineExpose({ openPod })
</script>

<template>
  <WorkspaceFrame>
    <template #account>
      <AccountStatus @open="page = 'App settings'" />
    </template>
    <template #status>
      <span v-if="status && status.state !== 'online'" class="connection-notice" role="status">{{ t('Desktop offline') }}<template v-if="status.error"> · {{ diagnostic(status.error) }}</template></span>
    </template>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <button v-if="page !== 'Automations'" class="text-button" data-testid="back-to-automations" @click="back">
      ‹ {{ t('Automations') }}
    </button>
    <div v-show="page === 'Automations'">
      <LocalShell sharing :paused="page !== 'Automations'" @open-pod="openPod" @settings="page = 'App settings'" />
    </div>
    <template v-if="page === 'Sharing' && sharing">
      <SharingImport :api="sharingApi" desktop :resources="podResources" @open-pod="openPod" />
    </template>
    <AppSettings v-if="page === 'App settings'" sharing @import="importPackage">
      <template v-if="!status?.runtimeId" #connection>
        <section class="desktop-connection">
          <h3>{{ t('Desktop connection') }}</h3><p class="muted">
            {{ t('Connect this desktop to make its Pods available in your central workspace. The desktop executes your runs.') }}
          </p><button class="secondary" :disabled="registering" @click="register">
            {{ registering ? t('Waiting for sign-in…') : t('Register this desktop') }}
          </button>
        </section>
      </template>
    </AppSettings>
    <CentralWorkspace v-show="page === 'Pods'" ref="workspace" :client="client" :desktop-status="status" desktop embedded @settings="page = 'App settings'">
      <template #local-editor="{ podId }">
        <App :key="podId" embedded :initial-pod-id="podId" @settings="page = 'App settings'" />
      </template>
    </CentralWorkspace>
  </WorkspaceFrame>
</template>

<style scoped>
.desktop-connection{margin-top:24px}.desktop-connection h3{margin-bottom:10px}
</style>
