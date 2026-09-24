<script setup lang="ts">
import { t, diagnostic } from '../i18n'
import { ref } from 'vue'
import CentralWorkspace from './CentralWorkspace.vue'
import { desktopWorkspaceClient } from './client'
import Onboarding from '../Onboarding.vue'
import PodResources from '../PodResources.vue'
import CodexPanel from '../CodexPanel.vue'

const invoke = window.pods.central!
const client = desktopWorkspaceClient(invoke)
const settings = ref(false)
const error = ref('')
const registering = ref(false)
async function register() {
  registering.value = true; error.value = ''
  try { await invoke({ type: 'register' }); settings.value = false }
  catch (cause) { error.value = String(cause) }
  finally { registering.value = false }
}
</script>

<template>
  <section v-if="settings" class="central-desktop-settings">
    <button @click="settings = false">
      {{ t('Back to workspace') }}
    </button><h1>{{ t('Desktop connection') }}</h1><Onboarding /><CodexPanel /><p>{{ t('Connect this desktop to make its Pods available in your central workspace. The desktop executes your runs.') }}</p><button :disabled="registering" @click="register">
      {{ registering ? t('Waiting for sign-in…') : t('Register this desktop') }}
    </button><p v-if="error" role="alert">
      {{ diagnostic(error) }}
    </p>
  </section>
  <CentralWorkspace v-else :client="client" desktop @settings="settings = true">
    <template #permissions="{ podId }">
      <PodResources :key="podId" :selected-pod-id="podId" />
    </template>
    <template #secrets="{ podId }">
      <PodResources :key="podId" mode="values" :selected-pod-id="podId" />
    </template>
  </CentralWorkspace>
</template>

<style scoped>
.central-desktop-settings{max-width:1000px;padding:32px;margin:auto}
</style>
