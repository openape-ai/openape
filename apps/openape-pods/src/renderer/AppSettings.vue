<script setup lang="ts">
import { t } from './i18n'
import Onboarding from './Onboarding.vue'
import JevConnection from './JevConnection.vue'
import LanguageSwitcher from './LanguageSwitcher.vue'
import McpAccess from './McpAccess.vue'
import RuntimeApprovalSettings from './RuntimeApprovalSettings.vue'
import DataManagement from './DataManagement.vue'
</script>

<template>
  <div class="app-settings">
    <h1>{{ t('App settings') }}</h1>
    <p class="muted">
      {{ t('Accounts, agent access and this desktop.') }}
    </p>
    <section :aria-label="t('Personal accounts')">
      <h2>{{ t('Personal accounts') }}</h2>
      <Onboarding compact>
        <JevConnection compact />
      </Onboarding>
    </section>
    <McpAccess />
    <section class="card">
      <RuntimeApprovalSettings />
    </section>
    <section class="card">
      <h2>{{ t('App settings') }}</h2><LanguageSwitcher /><slot name="connection" />
    </section>
    <details class="card">
      <summary>{{ t('Data & backups') }}</summary><DataManagement />
    </details>
  </div>
</template>

<style scoped>
.app-settings{display:grid;gap:22px;max-width:920px}.app-settings h1,.app-settings p{margin:0}.app-settings h2{margin:0 0 14px}.app-settings h3{margin:0}.app-settings summary{cursor:pointer;font-weight:600}.app-settings :deep(.setup-view article){margin-top:0}.app-settings :deep(.setup-connection:first-of-type){border-top:0}.app-settings :deep(.card){margin-bottom:0}
</style>
