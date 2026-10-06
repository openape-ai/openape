<script setup lang="ts">
import type { IssueRecord } from '../../shared/issue-types'
import { onMounted, ref } from 'vue'
import { issueError } from '../utils/issue-ui'

const props = defineProps<{ owner: string, name: string }>()
const ready = ref(false)
onMounted(() => { ready.value = true })
const title = ref('')
const body = ref('')
const error = ref('')
const busy = ref(false)
let key = ''
let payload = ''
async function submit() {
  if (busy.value) return
  const next = JSON.stringify({ title: title.value, body: body.value })
  if (!key || payload !== next) { key = crypto.randomUUID(); payload = next }
  busy.value = true
  error.value = ''
  try {
    const issue = await $fetch<IssueRecord>(`/api/repos/${props.owner}/${props.name}/issues`, { method: 'POST', body: { title: title.value, body: body.value }, headers: { 'Idempotency-Key': key } })
    await navigateTo(issue.repositoryUrl || issue.stableUrl)
  }
  catch (err) { error.value = issueError(err) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader :owner="owner" :name="name" tab="issues" />
    <main class="max-w-3xl mx-auto p-4 md:py-8 space-y-4">
      <h1 class="text-2xl font-semibold">
        New issue
      </h1>
      <p class="text-sm text-zinc-400">
        Visible to people with access to {{ owner }}/{{ name }} and any invited report participants.
      </p>
      <UAlert v-if="error" color="error" :title="error" />
      <form v-if="ready" class="space-y-4" @submit.prevent="submit">
        <label class="block text-sm">Title<UInput v-model="title" aria-label="Title" :maxlength="200" required class="w-full mt-2" :disabled="busy" /></label>
        <IssueEditor v-model="body" :disabled="busy" />
        <div class="flex justify-end gap-3">
          <UButton :to="`/${owner}/${name}/issues`" color="neutral" variant="ghost">
            Cancel
          </UButton><UButton type="submit" :loading="busy" :disabled="!title.trim()">
            Create issue
          </UButton>
        </div>
      </form>
    </main>
  </div>
</template>
