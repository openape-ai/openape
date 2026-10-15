<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { normalizeTags } from '../../contracts/tags'
import { applyLanguage, t } from '../i18n'
import { scenarioNames } from './scenarios'
import type { DemoScenario } from './scenarios'
import DemoWorkspace from './DemoWorkspace.vue'

const params = new URLSearchParams(location.search)
const selected = params.get('scenario')
const scenario = ref<DemoScenario>(scenarioNames.find(name => name === selected) ?? 'everyday')
const generation = ref(0)
const mounted = ref(true)
applyLanguage(params.get('language') === 'en' ? 'en' : 'de')
function resetPreferences() {
  localStorage.setItem('pods.automations.tags', JSON.stringify(normalizeTags(['Northwind', 'Contoso', 'Mail', 'Betrieb'])))
  localStorage.removeItem('pods.automations.untagged-off')
  localStorage.setItem('pods.automations.mode', 'list')
}
resetPreferences()
async function reset() {
  mounted.value = false
  await nextTick()
  resetPreferences()
  generation.value++
  const url = new URL(location.href); url.searchParams.set('scenario', scenario.value); history.replaceState(null, '', url)
  mounted.value = true
}
</script>

<template>
  <div class="demo-app">
    <aside class="demo-toolbar" :aria-label="t('UI demo')">
      <strong>{{ t('Pods UI demo') }}</strong><span>{{ t('Test data only · no external actions') }}</span>
      <label>{{ t('Scenario') }} <select v-model="scenario" @change="reset"><option v-for="name in scenarioNames" :key="name" :value="name">{{ name }}</option></select></label>
      <button type="button" @click="reset">
        {{ t('Reset demo') }}
      </button>
    </aside>
    <DemoWorkspace v-if="mounted" :key="generation" :scenario="scenario" />
  </div>
</template>

<style>
.demo-app{height:100vh;display:flex;flex-direction:column}.demo-app>.workspace-frame{height:auto;flex:1;min-height:0}
.demo-toolbar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:12px 20px;background:var(--surface);border-bottom:2px solid var(--accent);font-size:13px}
.demo-toolbar label{display:flex;align-items:center;gap:8px}.demo-toolbar select,.demo-toolbar button{font:inherit;padding:6px 10px;border:1px solid var(--border);border-radius:6px;color:var(--text);background:var(--surface)}
.demo-toolbar span{color:var(--muted)}.demo-notice{padding:12px 20px;background:var(--warn-soft)}.demo-reconnect{margin:12px 20px}
</style>
