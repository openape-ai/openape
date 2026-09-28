<script setup lang="ts">
import { ref } from 'vue'
import { t } from './i18n'

defineProps<{ page: string, count?: number, embedded?: boolean }>()
defineEmits<{ navigate: [page: string] }>()
const collapsed = ref(false)
</script>

<template>
  <div class="workspace-frame" :class="{ embedded, collapsed }">
    <header v-if="!embedded" class="workspace-topbar">
      <strong><span class="workspace-logo" aria-hidden="true">{{ 'o.' }}</span> {{ 'OpenApe' }} <span class="muted">{{ t('Pods') }}</span></strong><slot name="status" />
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
          <button class="nav-button" :aria-label="t('App settings')" :aria-current="page === 'App settings' ? 'page' : undefined" @click="$emit('navigate', 'App settings')">
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
.workspace-topbar{height:68px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 26px 0 86px;background:var(--surface);border-bottom:1px solid var(--border);-webkit-app-region:drag}
.workspace-topbar strong{display:flex;align-items:center;gap:8px;font-size:16px;white-space:nowrap}.workspace-logo{display:grid;place-items:center;background:var(--accent);color:var(--on-accent);width:28px;height:28px;border-radius:8px}
.workspace-shell{display:grid;grid-template-columns:182px minmax(0,1fr);min-height:calc(100vh - 68px)}.workspace-navigation{display:flex;flex-direction:column;padding:22px 12px;background:var(--surface);border-right:1px solid var(--border)}
.workspace-navigation nav{display:grid;gap:6px}.workspace-navigation button{display:flex;align-items:center;gap:10px;padding:12px;border:0;border-radius:7px;text-align:left;background:transparent;color:var(--muted);font:inherit;cursor:pointer}.workspace-navigation button[aria-current]{background:var(--tint);color:var(--accent);font-weight:600}.workspace-navigation small{margin-left:auto}.workspace-account{margin-top:auto;padding-top:28px;min-width:0}.workspace-page{padding:28px 32px 60px;min-width:0;width:100%;max-width:1200px}.embedded,.embedded .workspace-shell{min-height:0}.embedded .workspace-shell{display:block}.embedded .workspace-page{padding:0;max-width:none}
@media(max-width:760px){.workspace-shell{grid-template-columns:150px minmax(0,1fr)}.workspace-page{padding:22px 18px}.workspace-navigation{padding:18px 8px}}
@media(max-width:600px){.workspace-shell{display:block}.workspace-navigation{padding:8px 12px;border-right:0;border-bottom:1px solid var(--border)}.workspace-navigation nav{display:flex;flex-wrap:wrap;gap:4px}.workspace-navigation button{padding:10px}.workspace-account{display:none}.workspace-topbar{padding:0 16px;height:56px}.workspace-page{padding:20px 16px}.workspace-topbar :deep(.muted){font-size:12px}}
.frame-collapse{align-self:flex-end;margin-bottom:14px}.collapsed .workspace-shell{grid-template-columns:66px minmax(0,1fr)}.collapsed .destination-label,.collapsed small{display:none}.collapsed .workspace-navigation{padding-inline:8px}.collapsed .workspace-account :deep(.account-copy){display:none}.collapsed .workspace-account :deep(.account-status){padding-inline:6px}.collapsed .workspace-navigation nav button{justify-content:center}
@media(max-width:600px){.frame-collapse{display:none}.collapsed .destination-label,.collapsed small{display:initial}.collapsed .workspace-shell{display:block}}
.workspace-frame{height:100vh;display:flex;flex-direction:column}.workspace-topbar{flex-shrink:0}.workspace-shell{min-height:0;flex:1}.workspace-page{min-height:0;overflow:auto}.workspace-navigation{min-height:0}.embedded{height:auto;display:block}.embedded .workspace-page{overflow:visible}
@media(max-width:600px){.workspace-shell{display:flex;flex-direction:column}.workspace-navigation{flex-shrink:0}.workspace-page{flex:1}}
@media(max-width:600px){.workspace-navigation .frame-collapse{display:none}.workspace-navigation nav button{width:auto;flex:0 1 auto;font-size:13px}.workspace-navigation nav{display:flex;flex-direction:row}.workspace-navigation nav small{margin-left:0}}
</style>
