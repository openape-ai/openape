<script setup lang="ts">
import { ref } from 'vue'
import { diagnostic, t } from './i18n'
import Onboarding from './Onboarding.vue'
import JevConnection from './JevConnection.vue'
import LanguageSwitcher from './LanguageSwitcher.vue'
import McpSession from './McpSession.vue'
import DataManagement from './DataManagement.vue'

defineProps<{ browser?: boolean, subject?: string }>()
defineEmits<{ logout: [] }>()
const grantsError = ref('')
async function openGrants() {
  grantsError.value = ''
  try { await window.pods.onboarding({ type: 'openGrants' }) }
  catch (error) { grantsError.value = error instanceof Error ? error.message : String(error) }
}
</script>

<template>
  <div class="app-settings">
    <h1>{{ t('App settings') }}</h1>
    <p class="muted">
      {{ t('Accounts, agent access and this desktop.') }}
    </p>
    <section :aria-label="t('Personal accounts')">
      <h2>{{ t('Personal accounts') }}</h2>
      <div v-if="browser" class="card browser-accounts">
        <section class="browser-account">
          <strong>{{ t('DDISA/OpenApe') }}</strong><span class="muted">{{ subject }} · {{ t('Signed in') }}</span><button class="secondary" @click="$emit('logout')">
            {{ t('Sign out') }}
          </button>
        </section>
        <section v-for="account in ['Codex', 'TypeSafe (Jev)']" :key="account" class="browser-account">
          <strong>{{ account }}</strong><span class="muted">{{ t('Manage these accounts on the desktop.') }}</span>
        </section>
      </div>
      <Onboarding v-else compact>
        <JevConnection compact />
      </Onboarding>
    </section>
    <section v-if="browser" class="card">
      <h2>{{ t('MCP access') }}</h2><p class="muted">
        {{ t('Manage agent access on the desktop.') }}
      </p>
    </section>
    <McpSession v-else />
    <section v-if="!browser" class="card rights-settings">
      <h2>{{ t('Rights') }}</h2>
      <p class="muted">
        {{ t('Pods requests every permission from your DDISA account, once per Pod and command. You approve it at the IdP; approvals stay valid until you revoke them there.') }}
      </p>
      <button class="secondary manage-grants" @click="openGrants">
        {{ t('Manage existing grants at the IdP') }}
      </button>
      <p v-if="grantsError" role="alert" class="error-message">
        {{ diagnostic(grantsError) }}
      </p>
    </section>
    <section class="card">
      <h2>{{ t('App settings') }}</h2><LanguageSwitcher :browser="browser" /><slot name="connection" />
    </section>
    <details class="card">
      <summary>{{ t('Data & backups') }}</summary><p v-if="browser" class="muted">
        {{ t('Manage backups and local storage on the desktop.') }}
      </p><DataManagement v-else />
    </details>
  </div>
</template>

<style scoped>
.app-settings{display:grid;gap:22px;max-width:920px}.app-settings h1,.app-settings p{margin:0}.app-settings h2{margin:0 0 14px}.app-settings h3{margin:0}.app-settings summary{cursor:pointer;font-weight:600}.app-settings :deep(.setup-view article){margin-top:0}.app-settings :deep(.setup-connection:first-of-type){border-top:0}.app-settings :deep(.card){margin-bottom:0}
.browser-account{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;padding:18px 0;border-top:1px solid var(--border)}.browser-account:first-child{border:0}.browser-account>strong,.browser-account>span{grid-column:1;overflow-wrap:anywhere}.browser-account button{grid-column:2;grid-row:1/3;align-self:center}@media(max-width:480px){.browser-account{grid-template-columns:1fr}.browser-account button{grid-column:1;grid-row:auto;justify-self:start}}
</style>
