<script setup lang="ts">
import { computed, onBeforeUnmount, onUnmounted, provide, watch } from 'vue'
import type { CentralClient, CentralRuntime, CentralSummary } from '../../contracts/central'
import App from '../App.vue'
import { podAccessKey } from '../pod-access'
import { remotePodAccess } from './remote-pod-access'
import { t, diagnostic } from '../i18n'
import { clearScriptBuffer } from '../script-buffer'
import { settingsDrafts, variableDrafts, descriptionDrafts, scheduleDrafts } from '../form-buffer'

const props = defineProps<{ client: CentralClient, runtime: CentralRuntime, summary: CentralSummary, online: boolean }>()
const emit = defineEmits<{ dirty: [value: boolean], busy: [value: boolean] }>()
const abort = new AbortController()
const remote = remotePodAccess(props.client, () => props.runtime, props.summary, abort.signal)
provide(podAccessKey, remote.access)
watch(() => props.summary, value => remote.update(value))
const dirty = computed(() => [...remote.access.edits.values()].some(check => check()))
watch(dirty, value => emit('dirty', value), { immediate: true })
watch(() => remote.state.busy || !!remote.state.operation, value => emit('busy', value), { immediate: true })
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || remote.state.busy || remote.state.operation) { event.preventDefault(); event.returnValue = '' } }
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => { abort.abort(); emit('dirty', false); emit('busy', false); window.removeEventListener('beforeunload', beforeUnload) })
onUnmounted(() => {
  const key = remote.access.key(props.summary.pod.id)
  clearScriptBuffer(key); settingsDrafts.delete(key); variableDrafts.delete(key); descriptionDrafts.delete(key); scheduleDrafts.delete(key)
})
</script>

<template>
  <p v-if="!online" role="status" class="muted">
    {{ t('This Pod is offline. Your unsaved edits are kept until it reconnects.') }}
  </p>
  <p v-if="remote.state.error" role="alert" class="error-message">
    {{ diagnostic(remote.state.error) }}
  </p>
  <button v-if="remote.state.operation && !remote.state.busy" class="secondary" @click="remote.reconcile">
    {{ t('Check pending operation') }}
  </button>
  <fieldset class="remote-editor" :disabled="!online || remote.state.busy || !!remote.state.operation">
    <App :initial-pod-id="summary.pod.id" :refresh-token="remote.summary.value.revision" embedded />
  </fieldset>
</template>

<style scoped>
.remote-editor{border:0;padding:0;margin:0;min-width:0}
</style>
