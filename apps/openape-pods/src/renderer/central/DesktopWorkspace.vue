<script setup lang="ts">
import { t, diagnostic } from '../i18n'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CentralStatus } from '../../contracts/central'
import CentralWorkspace from './CentralWorkspace.vue'
import { desktopWorkspaceClient } from './client'
import App from '../App.vue'
import WorkspaceFrame from '../WorkspaceFrame.vue'
import AppSettings from '../AppSettings.vue'
import AccountStatus from '../AccountStatus.vue'
import GraphPanel from '../GraphPanel.vue'
import type { WorkflowView } from '../../contracts/workflows'
import type { StoredPod, WorkspaceState } from '../../contracts/control'
import type { Organization } from '../../contracts/groups'

const invoke = window.pods.central!
const client = desktopWorkspaceClient(invoke)
const page = ref('Workflows')
const workspace = ref<InstanceType<typeof CentralWorkspace> | null>(null)
const workflows = ref<WorkflowView>({ workflows: [], runs: [] })
const pods = ref<StoredPod[]>([])
const organization = ref<Organization>({ revision: 1, groups: [] })
const workflowId = ref('')
const error = ref('')
const registering = ref(false)
const status = ref<CentralStatus | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false
async function poll() {
  try {
    const [value, view, inventory] = await Promise.all([invoke({ type: 'status' }), window.pods.workflows({ type: 'list' }), window.pods.workspace({ type: 'list' })])
    status.value = (value as CentralStatus & { enabled?: boolean }).enabled === false ? null : value as CentralStatus; workflows.value = view; workspaceChanged(inventory); error.value = ''
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
}
async function register() {
  registering.value = true; error.value = ''
  try { await invoke({ type: 'register' }) }
  catch (cause) { error.value = String(cause) }
  finally { registering.value = false }
}
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
  <WorkspaceFrame :page="page" :count="pods.filter(pod => pod.lifecycle !== 'archived').length" @navigate="navigate">
    <template #account>
      <AccountStatus @open="page = 'App settings'" />
    </template>
    <template #status>
      <span class="muted">{{ status?.state === 'online' ? t('Desktop online') : t('Desktop offline') }}</span>
    </template>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <section v-show="page === 'Workflows'">
      <GraphPanel :view="workflows" :pods="pods" :organization="organization" :selected-id="workflowId" @changed="workflows = $event" @workspace="workspaceChanged" @select="workflowId = $event" @open-pod="openPod" />
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
