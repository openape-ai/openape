<script setup lang="ts">
import { computed, onBeforeUnmount, onUnmounted, provide, ref } from 'vue'
import App from '../App.vue'
import { t } from '../i18n'
import { localPodAccess, podAccessKey } from '../pod-access'
import { settingsDrafts, variableDrafts, descriptionDrafts, scheduleDrafts } from '../form-buffer'
import { clearScriptBuffer } from '../script-buffer'
import { demoId } from './scenarios'
import { hostBridgeKey } from '../host-bridge'
import { createDemoAdapter } from './adapter'
import type { DemoScenario } from './scenarios'

const props = defineProps<{ scenario: DemoScenario }>()
const notice = ref('')
const adapter = createDemoAdapter(props.scenario, (message) => { notice.value = message })
provide(hostBridgeKey, adapter.bridge)
const access = localPodAccess(adapter.bridge, `demo:${crypto.randomUUID()}:`, adapter.revision)
provide(podAccessKey, access)
const connectionFailed = computed(() => props.scenario === 'loading-error')
onBeforeUnmount(() => adapter.dispose())
onUnmounted(() => {
  for (const id of ['', ...Array.from({ length: 6 }, (_, i) => demoId(i + 1))]) {
    const key = access.key(id)
    clearScriptBuffer(key); settingsDrafts.delete(key); variableDrafts.delete(key); descriptionDrafts.delete(key); scheduleDrafts.delete(key)
  }
})
</script>

<template>
  <p v-if="notice" role="status" class="demo-notice">
    {{ notice }}
  </p>
  <button v-if="connectionFailed" class="secondary demo-reconnect" type="button" @click="adapter.restoreConnection()">
    {{ t('Restore demo connection') }}
  </button>
  <App />
</template>
