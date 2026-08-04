<script setup lang="ts">
import type { WireEvent } from '../../utils/attention-inbox'
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

// One decision card at a stable, shareable URL — the "one link in every app".
const route = useRoute()
const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

const { data, error, refresh } = await useFetch<{
  event: WireEvent
  resolution: WireEvent | null
  proofs: WireEvent[]
}>(`/api/events/${route.params.id}`, { server: true })

useSeoMeta({ title: () => 'Entscheidung' })

const e = computed(() => data.value?.event)
const now = Math.floor(Date.now() / 1000)

const submitting = ref(false)
const submitError = ref('')

async function resolve(body: { choice?: string, verdict?: string }) {
  submitting.value = true
  submitError.value = ''
  try {
    await $fetch(`/api/events/${route.params.id}/resolve`, { method: 'POST', body })
    await refresh()
  }
  catch (err) {
    submitError.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? String(err)
  }
  submitting.value = false
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="app-header">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-2xl shrink-0" aria-hidden="true">🦍</span>
        <NuxtLink to="/inbox" class="font-semibold hover:underline">
          Inbox
        </NuxtLink>
      </div>
    </header>

    <main class="max-w-2xl mx-auto px-4 sm:px-8 py-8">
      <InlineLogin v-if="!user" />
      <UAlert v-else-if="error" color="error" variant="subtle" title="Karte nicht gefunden oder kein Zugriff." />
      <template v-else-if="e">
        <DecisionCard
          :event="e" :resolution="data?.resolution" :proofs="data?.proofs" :now="now" :submitting="submitting"
          @resolve="resolve"
        />
        <UAlert v-if="submitError" color="error" variant="subtle" :title="submitError" class="mt-3" />
      </template>
    </main>
  </div>
</template>
