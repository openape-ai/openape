<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { issueError } from '../utils/issue-ui'

const props = defineProps<{ endpoint: string }>()
const issues = ref<{ id: string, title: string, number: number | null, state: string, url: string }[]>([])
const error = ref('')
onMounted(async () => {
  try { issues.value = (await $fetch<{ issues: typeof issues.value }>(`${props.endpoint}/issues`)).issues }
  catch (err) { error.value = issueError(err) }
})
</script>

<template>
  <section class="border border-zinc-800 rounded-lg p-4 space-y-3" aria-label="Related issues">
    <h2 class="font-semibold">
      Related issues
    </h2>
    <UAlert v-if="error" role="alert" color="error" :title="error" />
    <p v-else-if="!issues.length" class="text-sm text-zinc-500">
      No visible links. Maintainers can add a related pull request from an issue.
    </p>
    <ul class="space-y-2 text-sm">
      <li v-for="issue in issues" :key="issue.id" class="break-words">
        <NuxtLink :to="issue.url" class="text-amber-400 hover:underline">
          {{ issue.title }}
        </NuxtLink><span class="text-zinc-500"> · Related · {{ issue.state }}</span>
      </li>
    </ul>
  </section>
</template>
