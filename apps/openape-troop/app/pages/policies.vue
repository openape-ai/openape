<script setup lang="ts">
import type { WireEvent } from '../utils/attention-inbox'
import { computed } from 'vue'
import { useOpenApeAuth } from '#imports'
import { policiesFromEvents } from '../utils/policies'

// The rules that outlived their decision. Kept next to the inbox on purpose:
// deciding and governing are the same surface, one is just the residue.
const { t } = useI18n()
useSeoMeta({ title: () => t('policies.tabTitle') })
const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

const { data } = await useFetch<{ events: WireEvent[] }>('/api/events', {
  server: true,
  default: () => ({ events: [] }),
})
const policies = computed(() => policiesFromEvents(data.value.events))
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <AppHeader active="inbox" :title="t('policies.tabTitle')" :show-logout="!!user" @logout="logout" />

    <main class="max-w-3xl mx-auto px-4 sm:px-8 py-8">
      <InlineLogin v-if="!user" :hint="t('common.loginHint', { what: t('policies.loginWhat') })" />
      <template v-else>
        <p class="text-zinc-400 mb-6">
          {{ t('policies.intro') }}
        </p>
        <PolicyList :policies="policies" />
      </template>
    </main>
  </div>
</template>
