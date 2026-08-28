<script setup lang="ts">
import { computed } from 'vue'
import { useOpenApeAuth } from '#imports'
import { cloneCommand } from '~/utils/git-ui'

const route = useRoute()
const owner = route.params.owner as string
const name = route.params.name as string

const { user, fetchUser } = useOpenApeAuth()
const ready = ref(false)

const clone = computed(() =>
  cloneCommand(typeof window === 'undefined' ? 'repos.openape.ai' : window.location.origin, owner, name))

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

    <main v-if="ready" class="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <RepoBrowse :owner="owner" :name="name" path="" />

      <section>
        <code class="block bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-sm overflow-x-auto whitespace-nowrap">
          {{ clone }}
        </code>
      </section>
    </main>
  </div>
</template>
