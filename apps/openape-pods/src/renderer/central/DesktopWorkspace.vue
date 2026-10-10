<script setup lang="ts">
import { t, diagnostic } from '../i18n'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CentralStatus } from '../../contracts/central'
import type { Organization } from '../../contracts/groups'
import CentralWorkspace from './CentralWorkspace.vue'
import LocalShell from './LocalShell.vue'
import { desktopWorkspaceClient } from './client'
import App from '../App.vue'
import WorkspaceFrame from '../WorkspaceFrame.vue'
import AppSettings from '../AppSettings.vue'
import AccountStatus from '../AccountStatus.vue'
import SharingImport from '../SharingImport.vue'
import SharingExport from '../SharingExport.vue'
import type { PortableSourceSelection, SharingCommand } from '../../contracts/sharing'

/**
 * The registered desktop: the shell is the landing page; the Pod editor, portable packages and the
 * advanced native settings open from it and return with one button.
 */
const invoke = window.pods.central!
const client = desktopWorkspaceClient(invoke)
const page = ref<'Automations' | 'Pods' | 'App settings' | 'Sharing'>('Automations')
const workspace = ref<InstanceType<typeof CentralWorkspace> | null>(null)
const organization = ref<Organization>({ revision: 1, groups: [] })
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
    const [value, state] = await Promise.all([invoke({ type: 'status' }), window.pods.workspace({ type: 'list' })])
    status.value = (value as CentralStatus & { enabled?: boolean }).enabled === false ? null : value as CentralStatus; error.value = ''
    if (state.organization.revision >= organization.value.revision) organization.value = state.organization
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
function share(selection: PortableSourceSelection) { sharing.value = { mode: 'export', selection }; page.value = 'Sharing' }
function importPackage() { sharing.value = { mode: 'import' }; page.value = 'Sharing' }
defineExpose({ openPod })
</script>

<template>
  <WorkspaceFrame>
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
    <button v-if="page !== 'Automations'" class="text-button" data-testid="back-to-automations" @click="back">
      ‹ {{ t('Automations') }}
    </button>
    <LocalShell v-if="page === 'Automations'" sharing @open-pod="openPod" @share="share" @advanced="page = 'App settings'" @import="importPackage" />
    <template v-if="page === 'Sharing' && sharing">
      <SharingImport v-if="sharing.mode === 'import'" :api="sharingApi" :organization="organization" desktop :resources="podResources" @open-pod="openPod" />
      <SharingExport v-else :key="sharing.selection.id" :selection="sharing.selection" :api="sharingApi" @done="back" />
    </template>
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
