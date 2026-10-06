<script setup lang="ts">
import { onMounted, ref } from 'vue'
import WorkspaceWelcome from '../components/WorkspaceWelcome.vue'
import { applyLanguage, diagnostic } from '../../../openape-pods/src/renderer/i18n'
import BrowserWorkspace from '../../../openape-pods/src/renderer/central/BrowserWorkspace.vue'
import '../../../openape-pods/src/renderer/style.css'
import { browserWorkspaceClient } from '../../../openape-pods/src/renderer/central/client'

const client = browserWorkspaceClient()
onMounted(() => { const saved = localStorage.getItem('pods-language'); applyLanguage(saved === 'en' || saved === 'de' ? saved : navigator.language.startsWith('de') ? 'de' : 'en') })
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
  <BrowserWorkspace v-else :client="client" @login="signingIn = true" @logout="logout" />
</template>

<style>
:root { color-scheme: light dark; }
body { margin: 0; }
</style>
