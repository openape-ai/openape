<script setup lang="ts">
import { t, diagnostic } from '../i18n'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CentralStatus } from '../../contracts/central'
import CentralWorkspace from './CentralWorkspace.vue'
import { desktopWorkspaceClient } from './client'
import Onboarding from '../Onboarding.vue'
import PodResources from '../PodResources.vue'
import CodexPanel from '../CodexPanel.vue'
import JevConnection from '../JevConnection.vue'
import LanguageSwitcher from '../LanguageSwitcher.vue'
import DataManagement from '../DataManagement.vue'
import AccountStatus from '../AccountStatus.vue'

const invoke = window.pods.central!
const client = desktopWorkspaceClient(invoke)
const settings = ref(false)
const settingsPage = ref<'general' | 'accounts' | 'data'>('general')
const error = ref('')
const registering = ref(false)
const status = ref<CentralStatus | null>(null)
// Local IPC only: the reason this desktop is offline is known here, not by the service.
async function poll() {
  try {
    const value = await invoke({ type: 'status' }) as CentralStatus & { enabled: boolean }
    status.value = value.enabled ? value : null
  }
  catch (cause) { console.error('Desktop connection status unavailable', cause) }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { void poll(); timer = setInterval(() => { void poll() }, 5000) })
onBeforeUnmount(() => clearInterval(timer))
async function register() {
  registering.value = true; error.value = ''
  try { await invoke({ type: 'register' }); settings.value = false }
  catch (cause) { error.value = String(cause) }
  finally { registering.value = false }
}
</script>

<template>
  <main v-if="settings" class="central-desktop-settings">
    <header class="settings-heading">
      <button class="secondary" @click="settings = false">
        {{ t('Back to workspace') }}
      </button>
      <h1>{{ t('App settings') }}</h1>
    </header>
    <nav class="settings-navigation" :aria-label="t('App settings')">
      <button v-for="item in ([['general', 'App settings'], ['accounts', 'Your accounts'], ['data', 'Data & backups']] as const)" :key="item[0]" class="secondary" :aria-current="settingsPage === item[0] ? 'page' : undefined" @click="settingsPage = item[0]">
        {{ t(item[1]) }}
      </button>
    </nav>
    <template v-if="settingsPage === 'general'">
      <section class="card settings-general">
        <LanguageSwitcher />
        <JevConnection />
        <CodexPanel />
      </section>
      <section class="card settings-connection">
        <h2>{{ t('Desktop connection') }}</h2>
        <p class="muted">
          {{ t('Connect this desktop to make its Pods available in your central workspace. The desktop executes your runs.') }}
        </p>
        <button class="secondary" :disabled="registering" @click="register">
          {{ registering ? t('Waiting for sign-in…') : t('Register this desktop') }}
        </button>
        <p v-if="error" role="alert" class="error-message">
          {{ diagnostic(error) }}
        </p>
      </section>
    </template>
    <Onboarding v-else-if="settingsPage === 'accounts'" @finished="settings = false" />
    <DataManagement v-else />
  </main>
  <CentralWorkspace v-else :client="client" :desktop-status="status" desktop @settings="settingsPage = 'general'; settings = true">
    <template #account>
      <AccountStatus @open="settingsPage = 'accounts'; settings = true" />
    </template>
    <template #permissions="{ podId }">
      <PodResources :key="podId" :selected-pod-id="podId" />
    </template>
    <template #secrets="{ podId }">
      <PodResources :key="podId" mode="values" :selected-pod-id="podId" />
    </template>
  </CentralWorkspace>
</template>

<style scoped>
.central-desktop-settings{max-width:1000px;padding:32px;margin:auto;display:grid;gap:24px}
.settings-heading{display:grid;gap:20px;justify-items:start}
.settings-navigation{display:flex;flex-wrap:wrap;gap:10px}
.settings-navigation [aria-current=page]{background:var(--tint);border-color:var(--accent)}
.settings-general{display:grid;gap:20px}
.settings-connection{display:grid;gap:14px;justify-items:start}
@media(max-width:600px){.central-desktop-settings{padding:24px 16px}.settings-navigation button{white-space:normal;text-align:left}}
</style>
