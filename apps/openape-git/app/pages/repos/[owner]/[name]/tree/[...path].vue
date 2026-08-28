<script setup lang="ts">
import { computed } from 'vue'
import { useOpenApeAuth } from '#imports'

const route = useRoute()
const owner = route.params.owner as string
const name = route.params.name as string
const path = computed(() => {
  const raw = route.params.path
  return Array.isArray(raw) ? raw.join('/') : String(raw ?? '')
})

const { user, fetchUser } = useOpenApeAuth()
const ready = ref(false)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  ready.value = true
})
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader :owner="owner" :name="name" tab="code" />

    <main v-if="ready" class="max-w-5xl mx-auto px-4 py-6">
      <RepoBrowse :owner="owner" :name="name" :path="path" />
    </main>
  </div>
</template>
