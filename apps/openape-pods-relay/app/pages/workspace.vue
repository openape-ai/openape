<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { applyLanguage, t, diagnostic } from '../../../openape-pods/src/renderer/i18n'
import CentralWorkspace from '../../../openape-pods/src/renderer/central/CentralWorkspace.vue'
import { browserWorkspaceClient } from '../../../openape-pods/src/renderer/central/client'

const client = browserWorkspaceClient()
onMounted(() => applyLanguage(navigator.language.startsWith('de') ? 'de' : 'en'))
const signingIn = ref(false)
const email = ref('')
const error = ref('')
async function login() {
  error.value = ''
  try {
    const response = await fetch('/workspace-auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value }), redirect: 'error' })
    const result = await response.json() as { redirectUrl?: string, message?: string }
    if (!response.ok || !result.redirectUrl) throw new Error(result.message ?? 'Sign-in could not be started')
    window.location.assign(result.redirectUrl)
  }
  catch (cause) { error.value = String(cause) }
}
async function logout() {
  try {
    const response = await fetch('/workspace-auth/logout', { method: 'POST' })
    if (!response.ok) throw new Error('Sign-out failed. Please try again.')
    window.location.reload()
  }
  catch (cause) { error.value = String(cause) }
}
</script>

<template>
  <p v-if="error && !signingIn" role="alert">
    {{ diagnostic(error) }}
  </p>
  <form v-if="signingIn" class="workspace-login" @submit.prevent="login">
    <h1>{{ t('Sign in to Pods') }}</h1><label>{{ t('Your DDISA email') }}<input v-model="email" type="email" autocomplete="email" required></label><button>{{ t('Continue') }}</button><p v-if="error" role="alert">
      {{ diagnostic(error) }}
    </p>
  </form>
  <CentralWorkspace v-else :client="client" @login="signingIn = true" @logout="logout" />
</template>

<style>
:root{color-scheme:light dark}
body{margin:0}.workspace-login{font:16px/1.6 system-ui;max-width:420px;margin:10vh auto;padding:24px}.workspace-login input{display:block;width:100%;box-sizing:border-box;padding:12px;margin:10px 0 20px}.workspace-login button{padding:10px 20px}
</style>
