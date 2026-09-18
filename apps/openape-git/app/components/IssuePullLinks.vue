<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { issueError } from '../utils/issue-ui'

const props = defineProps<{ endpoint: string, canLink?: boolean }>()
const pulls = ref<{ id: string, title: string, number: number, state: string, owner: string, name: string, url: string }[]>([])
const repository = ref('')
const number = ref('')
const error = ref('')
const busy = ref(false)
async function load() {
  error.value = ''
  try { pulls.value = (await $fetch<{ pulls: typeof pulls.value }>(`${props.endpoint}/pulls`)).pulls }
  catch (err) { pulls.value = []; error.value = issueError(err) }
}
onMounted(load)
watch(() => props.endpoint, load)
async function change(method: 'POST' | 'DELETE', id = '') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await $fetch(`${props.endpoint}/pulls${id ? `/${encodeURIComponent(id)}` : ''}`, { method, ...(method === 'POST' ? { body: { repository: repository.value, number: Number(number.value) } } : {}) })
    await load()
    repository.value = ''; number.value = ''
  }
  catch (err) { error.value = issueError(err) }
  finally { busy.value = false }
}
</script>

<template>
  <section class="space-y-3 text-sm" aria-label="Linked pull requests">
    <h2 class="font-semibold">
      Linked pull requests
    </h2>
    <UAlert v-if="error" role="alert" color="error" :title="error" />
    <p v-if="!pulls.length && !error" class="text-zinc-500">
      No visible links.
    </p>
    <ul class="space-y-3">
      <li v-for="pull in pulls" :key="pull.id" class="break-words">
        <NuxtLink :to="pull.url" class="text-amber-400 hover:underline">
          {{ pull.title }}
        </NuxtLink><p class="text-xs text-zinc-500">
          Related · {{ pull.owner }}/{{ pull.name }} #{{ pull.number }} · {{ pull.state }}
        </p><UButton v-if="canLink" size="xs" variant="ghost" color="neutral" :loading="busy" :aria-label="`Unlink ${pull.title}`" @click="change('DELETE', pull.id)">
          Unlink
        </UButton>
      </li>
    </ul>
    <details v-if="canLink">
      <summary class="cursor-pointer">
        Link pull request
      </summary>
      <form class="mt-3 space-y-3" @submit.prevent="change('POST')">
        <UInput v-model="repository" aria-label="Pull request repository" placeholder="owner/repository" required class="w-full" /><UInput v-model="number" aria-label="Pull request number" type="number" min="1" placeholder="Pull request number" required class="w-full" /><UButton type="submit" size="sm" :loading="busy">
          Add related pull request
        </UButton>
        <p class="text-xs text-zinc-500">
          Merging a related pull request leaves this issue open for explicit resolution.
        </p>
      </form>
    </details>
  </section>
</template>
