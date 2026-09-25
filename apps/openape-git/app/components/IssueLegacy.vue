<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { issueError } from '../utils/issue-ui'

const props = defineProps<{ sourceUrl: string, fragment?: string }>()
const error = ref('')
onMounted(async () => {
  try {
    const url = new URL(props.sourceUrl)
    if (props.fragment && !url.hash) url.hash = props.fragment
    const result = await $fetch<{ url: string }>('/api/issue-legacy', { query: { url: url.href } })
    await navigateTo(result.url, { replace: true })
  }
  catch (failure) { error.value = issueError(failure) }
})
</script>

<template>
  <main class="max-w-3xl mx-auto p-6">
    <h1 class="text-xl font-semibold">
      Open an imported issue
    </h1>
    <p v-if="error" role="alert" class="mt-4 text-red-400">
      {{ error }}
    </p>
    <p v-else class="mt-4 text-zinc-400" role="status">
      Checking the legacy link and your access…
    </p>
  </main>
</template>
