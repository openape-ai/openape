<script setup lang="ts">
/**
 * The frame around the two product surfaces: the brand, the connection status and the account.
 * Navigation lives in the shell's tabs and gear menu; the frame has no sidebar of its own.
 */
defineProps<{ embedded?: boolean, browser?: boolean }>()
</script>

<template>
  <div class="workspace-frame" :class="{ embedded }">
    <div v-if="!embedded && !browser" class="workspace-titlebar" aria-hidden="true" />
    <header v-if="!embedded" class="workspace-topbar">
      <strong class="workspace-brand"><span class="workspace-logo" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg></span>{{ 'OpenApe Pods' }}</strong>
      <div class="workspace-topbar-end">
        <slot name="status" />
        <div class="workspace-account">
          <slot name="account" />
        </div>
      </div>
    </header>
    <main class="workspace-page">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.workspace-frame{height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--text)}
.workspace-titlebar{height:36px;flex-shrink:0;background:var(--surface);-webkit-app-region:drag}
.workspace-topbar{height:54px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;background:var(--surface);border-bottom:1px solid var(--border);-webkit-app-region:drag}
.workspace-brand{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:650;letter-spacing:-.3px;white-space:nowrap}.workspace-logo{display:grid;place-items:center;background:var(--accent);color:var(--on-accent);width:26px;height:26px;border-radius:8px;flex-shrink:0}
.workspace-topbar-end{display:flex;align-items:center;gap:14px;min-width:0;-webkit-app-region:no-drag}.workspace-account{min-width:0}
.workspace-page{min-height:0;flex:1;overflow:auto;padding:16px 20px 28px}
.embedded{height:auto;display:block}.embedded .workspace-page{overflow:visible;padding:0}
@media(max-width:600px){.workspace-topbar{padding:0 12px}.workspace-page{padding:12px 16px 24px}}
</style>
