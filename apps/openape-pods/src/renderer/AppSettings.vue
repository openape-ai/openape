<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { diagnostic, t } from './i18n'
import Onboarding from './Onboarding.vue'
import JevConnection from './JevConnection.vue'
import LanguageSwitcher from './LanguageSwitcher.vue'
import McpSession from './McpSession.vue'
import DataManagement from './DataManagement.vue'
import type { SecretsView } from '../contracts/secrets'

/**
 * The one settings page (issue 1468): accounts, the MCP session, rights, OpenApe Secrets, portable packages,
 * language and backups. The gear and the account button both open it. The browser shows the signed-in
 * account with sign-out and points to the desktop for everything native.
 */
const props = defineProps<{ browser?: boolean, subject?: string, sharing?: boolean }>()
defineEmits<{ logout: [], import: [] }>()
const grants = 'https://id.openape.ai/grants'
const grantsError = ref('')
async function openGrants() {
  grantsError.value = ''
  try { await window.pods.onboarding({ type: 'openGrants' }) }
  catch (error) { grantsError.value = error instanceof Error ? error.message : String(error) }
}
// OpenApe Secrets exists only on a desktop with the secrets bridge; until its status arrives it is loading, not unregistered.
const secretsAvailable = !props.browser && typeof window !== 'undefined' && typeof window.pods?.secrets === 'function'
const secrets = ref<SecretsView | null>(null)
const secretsBusy = ref(false)
const secretsError = ref('')
async function secretsCommand(command: { type: 'list' } | { type: 'revokeConsumer' }) {
  secretsBusy.value = true; secretsError.value = ''
  try { secrets.value = await window.pods.secrets!(command) }
  catch (error) { secretsError.value = error instanceof Error ? error.message : String(error) }
  finally { secretsBusy.value = false }
}
onMounted(() => { if (secretsAvailable) void secretsCommand({ type: 'list' }) })
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
        <section class="browser-account" data-account="ddisa">
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
    <section v-if="browser" class="card" data-mcp>
      <h2>{{ t('MCP access') }}</h2><p class="muted">
        {{ t('Manage agent access on the desktop.') }}
      </p>
    </section>
    <McpSession v-else />
    <section class="card rights-settings">
      <h2>{{ t('Rights') }}</h2>
      <p class="muted">
        {{ t('Pods requests every permission from your DDISA account, once per Pod and command. You approve it at the IdP; approvals stay valid until you revoke them there.') }}
      </p>
      <a v-if="browser" class="manage-grants" :href="grants" target="_blank" rel="noopener">{{ t('Manage existing grants at the IdP') }}</a>
      <button v-else class="secondary manage-grants" @click="openGrants">
        {{ t('Manage existing grants at the IdP') }}
      </button>
      <p v-if="grantsError" role="alert" class="error-message">
        {{ diagnostic(grantsError) }}
      </p>
    </section>
    <section v-if="secretsAvailable" class="card secrets-settings" data-consumer>
      <h2>{{ 'OpenApe Secrets' }}</h2>
      <p class="muted">
        {{ t('Receives sealed secrets; each one is collected once.') }}
      </p>
      <p v-if="!secrets && !secretsError" class="muted" role="status">
        {{ t('loading…') }}
      </p>
      <div v-else-if="secrets" class="secrets-consumer">
        <span>{{ secrets.consumer ? `${t('This Mac is registered')} · ${secrets.consumer.id}` : t('Not registered') }}</span><button v-if="secrets.consumer" class="secondary" :disabled="secretsBusy" @click="secretsCommand({ type: 'revokeConsumer' })">
          {{ t('Revoke') }}
        </button>
      </div>
      <p v-if="secretsError" role="alert" class="error-message">
        {{ diagnostic(secretsError) }}
      </p>
    </section>
    <section v-if="sharing" class="card" data-sharing>
      <h2>{{ t('Portable Pods') }}</h2><button class="secondary" @click="$emit('import')">
        {{ t('Import…') }}
      </button>
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
.rights-settings p{margin-bottom:14px}a.manage-grants{color:var(--accent)}
.secrets-settings p{margin-bottom:10px}.secrets-consumer{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;overflow-wrap:anywhere}
</style>
