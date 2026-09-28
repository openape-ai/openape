<script setup lang="ts">
import { ref } from 'vue'
import { t } from './i18n'

defineProps<{ page: string, count?: number, embedded?: boolean, browser?: boolean }>()
defineEmits<{ navigate: [page: string] }>()
const collapsed = ref(false)
</script>

<template>
  <div class="workspace-frame" :class="{ embedded, collapsed }">
    <div v-if="!embedded && !browser" class="workspace-titlebar" aria-hidden="true" />
    <header v-if="!embedded" class="workspace-topbar">
      <strong class="workspace-brand"><span class="workspace-logo" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg></span>{{ 'OpenApe Pods' }}</strong><slot name="status" />
    </header>
    <div class="workspace-shell">
      <aside v-if="!embedded" class="workspace-navigation">
        <button class="frame-collapse" :aria-label="t(collapsed ? 'Expand sidebar' : 'Collapse sidebar')" @click="collapsed = !collapsed">
          {{ collapsed ? '⇥' : '⇤' }}
        </button>
        <nav :aria-label="t('Your workspace')">
          <button class="nav-button" :aria-label="t('Workflows')" :aria-current="page === 'Workflows' ? 'page' : undefined" @click="$emit('navigate', 'Workflows')">
            <span aria-hidden="true">⇢</span><span class="destination-label">{{ t('Workflows') }}</span>
          </button>
          <button class="nav-button" :aria-label="t('Pods')" :aria-current="page === 'Pods' ? 'page' : undefined" @click="$emit('navigate', 'Pods')">
            <span aria-hidden="true">◫</span><span class="destination-label">{{ t('Pods') }}</span><small v-if="count !== undefined">{{ count }}</small>
          </button>
          <button class="nav-button nav-settings" :aria-label="t('App settings')" :aria-current="page === 'App settings' ? 'page' : undefined" @click="$emit('navigate', 'App settings')">
            <span aria-hidden="true">⚙</span><span class="destination-label">{{ t('App settings') }}</span>
          </button>
        </nav>
        <div class="workspace-account">
          <slot name="account" />
        </div>
      </aside>
      <main class="workspace-page">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.workspace-frame{min-height:100vh;background:var(--bg);color:var(--text)}
.workspace-titlebar{height:36px;flex-shrink:0;background:var(--surface);-webkit-app-region:drag}
.workspace-topbar{height:54px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;background:var(--surface);border-bottom:1px solid var(--border);-webkit-app-region:drag}
.workspace-brand{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:650;letter-spacing:-.3px;white-space:nowrap}.workspace-logo{display:grid;place-items:center;background:var(--accent);color:var(--on-accent);width:26px;height:26px;border-radius:8px;flex-shrink:0}
.workspace-shell{display:grid;grid-template-columns:182px minmax(0,1fr)}.workspace-navigation{display:flex;flex-direction:column;padding:22px 12px;background:var(--surface);border-right:1px solid var(--border)}
.workspace-navigation nav{display:flex;flex-direction:column;flex:1;gap:6px}.workspace-navigation .nav-settings{margin-top:auto}.workspace-navigation button{display:flex;align-items:center;gap:10px;padding:12px;border:0;border-radius:7px;text-align:left;background:transparent;color:var(--muted);font:inherit;cursor:pointer}.workspace-navigation button[aria-current]{background:var(--tint);color:var(--accent);font-weight:600}.workspace-navigation small{margin-left:auto}.workspace-account{padding-top:16px;min-width:0}.workspace-page{padding:28px 32px 60px;min-width:0;width:100%;max-width:1200px}.embedded,.embedded .workspace-shell{min-height:0}.embedded .workspace-shell{display:block}.embedded .workspace-page{padding:0;max-width:none}
@media(max-width:760px){.workspace-shell{grid-template-columns:150px minmax(0,1fr)}.workspace-page{padding:22px 18px}.workspace-navigation{padding:18px 8px}}
@media(max-width:600px){.workspace-shell{display:block}.workspace-navigation{padding:8px 12px;border-right:0;border-bottom:1px solid var(--border)}.workspace-navigation nav{display:flex;flex-wrap:wrap;gap:4px}.workspace-navigation button{padding:10px}.workspace-account{display:none}.workspace-page{padding:20px 16px}.workspace-topbar :deep(.muted){font-size:12px}}
.frame-collapse{align-self:flex-end;margin-bottom:14px}.collapsed .workspace-shell{grid-template-columns:66px minmax(0,1fr)}.collapsed .destination-label,.collapsed small{display:none}.collapsed .workspace-navigation{padding-inline:8px}.collapsed .workspace-account :deep(.account-copy){display:none}.collapsed .workspace-account :deep(.account-status){padding-inline:6px}.collapsed .workspace-navigation nav button{justify-content:center}
@media(max-width:600px){.frame-collapse{display:none}.collapsed .destination-label,.collapsed small{display:initial}.collapsed .workspace-shell{display:block}}
.workspace-frame{height:100vh;display:flex;flex-direction:column}.workspace-topbar{flex-shrink:0}.workspace-shell{min-height:0;flex:1}.workspace-page{min-height:0;overflow:auto}.workspace-navigation{min-height:0}.embedded{height:auto;display:block}.embedded .workspace-page{overflow:visible}
@media(max-width:600px){.workspace-shell{display:flex;flex-direction:column}.workspace-navigation{flex-shrink:0}.workspace-page{flex:1}}
@media(max-width:600px){.workspace-navigation .frame-collapse{display:none}.workspace-navigation nav button{width:auto;flex:0 1 auto;font-size:13px}.workspace-navigation nav{display:flex;flex-direction:row;flex:0}.workspace-navigation .nav-settings{margin-top:0}.workspace-navigation nav small{margin-left:0}}
</style>
