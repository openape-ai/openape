<script setup lang="ts">
import type { IssueRecord } from '../../shared/issue-types'
import { computed, onMounted, ref } from 'vue'
import { issueError } from '../utils/issue-ui'

const props = defineProps<{ issue: IssueRecord, endpoint: string }>()
const emit = defineEmits<{ changed: [] }>()
const options = ref<{ key: string, name: string, labels: { id: string, name: string }[] }[]>([])
const product = ref('')
const labelMap = ref<Record<string, string>>({})
const error = ref('')
const busy = ref(false)
const reason = ref('')
const participant = ref('')
const destination = computed(() => options.value.find(option => option.key === product.value))
onMounted(async () => {
  if (!props.issue.capabilities.triage || props.issue.triageState !== 'unclassified') return
  try { options.value = (await $fetch<{ products: typeof options.value }>(`${props.endpoint}/transfer-options`)).products }
  catch (err) { error.value = issueError(err) }
})
async function mutate(path: string, body: Record<string, unknown>) {
  if (busy.value) return
  error.value = ''; busy.value = true
  try { await $fetch(`${props.endpoint}/${path}`, { method: 'POST', body: { ...body, expectedVersion: props.issue.version } }); emit('changed') }
  catch (err) { error.value = issueError(err) }
  finally { busy.value = false }
}
function transfer() {
  const mapping = Object.fromEntries(props.issue.labels.map(label => [label.id, labelMap.value[label.id] === 'remove' ? null : labelMap.value[label.id]]))
  return mutate('transfer', { productKey: product.value, labelMap: mapping })
}
</script>

<template>
  <section class="space-y-3 text-sm">
    <UAlert v-if="error" role="alert" color="error" :title="error" />
    <details v-if="issue.capabilities.triage && issue.triageState === 'unclassified'">
      <summary class="cursor-pointer">
        Classify / transfer report
      </summary>
      <form class="issue-filters mt-3 space-y-3" @submit.prevent="transfer">
        <label>Destination product<select v-model="product" required @change="labelMap = {}"><option value="" disabled>Select product</option><option v-for="option in options" :key="option.key" :value="option.key">{{ option.name }}</option></select></label>
        <label v-for="label in issue.labels" :key="label.id">Map {{ label.name }}<select v-model="labelMap[label.id]" required><option value="" disabled>Select mapping</option><option value="remove">Remove this label</option><option v-for="target in destination?.labels" :key="target.id" :value="target.id">{{ target.name }}</option></select></label>
        <p class="text-xs text-zinc-500">
          The same issue and reporter access are retained. Its assignee is cleared. All destination repository readers can see the discussion.
        </p>
        <UButton type="submit" size="sm" :loading="busy" :disabled="!product">
          Move this issue
        </UButton>
      </form>
    </details>
    <details v-if="issue.capabilities.admin">
      <summary class="cursor-pointer">
        Moderation
      </summary>
      <div class="space-y-3 mt-3">
        <UInput v-model="reason" aria-label="Moderation reason" placeholder="Required reason" class="w-full" :maxlength="1000" /><UButton size="sm" color="neutral" variant="outline" :disabled="!reason.trim()" :loading="busy" @click="mutate('moderation', { hidden: !issue.hidden, reason })">
          {{ issue.hidden ? 'Restore issue visibility' : 'Hide issue' }}
        </UButton><UInput v-model="participant" aria-label="Reporter identity to revoke" placeholder="Reporter identity to revoke" class="w-full" /><UButton size="sm" color="neutral" variant="outline" :disabled="!reason.trim() || !participant.trim()" :loading="busy" @click="mutate('moderation', { revokeParticipant: participant, reason })">
          Revoke reporter access
        </UButton>
      </div>
    </details>
  </section>
</template>
