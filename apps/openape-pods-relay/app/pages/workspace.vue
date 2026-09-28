<script setup lang="ts">
import { onMounted, ref } from 'vue'
import WorkspaceWelcome from '../components/WorkspaceWelcome.vue'
import { applyLanguage, diagnostic } from '../../../openape-pods/src/renderer/i18n'
import CentralWorkspace from '../../../openape-pods/src/renderer/central/CentralWorkspace.vue'
import { browserWorkspaceClient } from '../../../openape-pods/src/renderer/central/client'

const client = browserWorkspaceClient()
onMounted(() => applyLanguage(navigator.language.startsWith('de') ? 'de' : 'en'))
const route = useRoute()
const signingIn = ref(route.query.login === 'failed')
const error = ref('')
async function logout() {
  try {
    const response = await fetch('/workspace-auth/logout', { method: 'POST' })
    if (!response.ok) throw new Error('Sign-out failed. Please try again.')
    window.location.assign('/')
  }
  catch (cause) { error.value = String(cause) }
}
</script>

<template>
  <p v-if="error && !signingIn" role="alert">
    {{ diagnostic(error) }}
  </p>
  <WorkspaceWelcome v-if="signingIn" :login-failed="route.query.login === 'failed'" />
  <CentralWorkspace v-else :client="client" @login="signingIn = true" @logout="logout" />
</template>

<style>
:root { color-scheme: light dark; }
body { margin: 0; }
</style>
