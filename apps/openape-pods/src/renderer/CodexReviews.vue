<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { MasterCommand, MasterView } from '../contracts/master'
import AccessProposals from './AccessProposals.vue'
import ChangeReview from './ChangeReview.vue'
import { t, diagnostic } from './i18n'
import { loadCodexReviews, pendingReviews } from './codex-reviews'

// Everything the owner's Codex prepared and only the owner can apply: change
// sets, run requests and access proposals of its hidden scope (issue 1375).
const emit = defineEmits<{ run: [podId: string, runId: string], workflow: [id: string], settings: [podId: string, alias?: string], resources: [podId: string], changed: [pending: number] }>()
const view = ref<MasterView | null>(null); const busy = ref(false); const error = ref('')
function publish(next: MasterView | null): void { view.value = next; emit('changed', pendingReviews(next)) }
async function load(): Promise<void> {
  try { publish(await loadCodexReviews()) }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Could not load Codex reviews' }
}
async function command(value: MasterCommand): Promise<void> {
  if (!view.value?.conversation) return
  busy.value = true; error.value = ''
  try { publish(await window.pods.master({ ...value, conversationId: view.value.conversation.id, contextRevision: view.value.conversation.revision })) }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Codex review failed' }
  finally { busy.value = false }
}
onMounted(load)
defineExpose({ load })
</script>

<template>
  <section class="card codex-reviews">
    <p class="muted">
      {{ t('Your Codex prepares these. Nothing here takes effect until you apply it.') }}
    </p>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <p v-if="!view?.changes?.length && !view?.proposals.length" role="status">
      {{ t('Nothing is waiting for you.') }}
    </p>
    <ChangeReview v-if="view?.changes?.length" :view="view" :busy="busy" @command="command" @run="(podId, runId) => emit('run', podId, runId)" @workflow="id => emit('workflow', id)" />
    <AccessProposals v-if="view?.proposals.length" :view="view" :busy="busy" @command="command" @updated="load" @settings="(podId, alias) => emit('settings', podId, alias)" @resources="podId => emit('resources', podId)" />
  </section>
</template>
