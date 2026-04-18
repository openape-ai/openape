<script setup>
import { onMounted, ref } from 'vue'
import { navigateTo } from '#imports'
import { useIdpAuth } from '../composables/useIdpAuth'

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const agents = ref([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await loadAgents()
})

async function loadAgents() {
  loading.value = true
  error.value = ''
  try {
    agents.value = await $fetch(`/api/users/${encodeURIComponent(user.value.email)}/agents`)
  }
  catch (err) {
    error.value = err?.data?.title || 'Failed to load agents'
    agents.value = []
  }
  finally {
    loading.value = false
  }
}

function standingCount(agent) {
  return (agent.standing_grants ?? []).length
}
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            Agents
          </h1>
          <p v-if="user" class="text-sm text-muted">
            {{ user.email }}
          </p>
        </div>
        <UButton to="/account" color="neutral" variant="soft" size="sm">
          Account
        </UButton>
      </div>

      <div v-if="authLoading || loading" class="text-center text-muted mt-10">
        Loading…
      </div>

      <UAlert v-else-if="error" color="error" :title="error" class="mb-4" />

      <div v-else-if="agents.length === 0" class="text-center mt-10 space-y-3">
        <p class="text-muted">
          No agents yet.
        </p>
        <p class="text-sm text-muted">
          Enroll one with <code class="bg-gray-800 px-1 rounded">apes enroll</code>
          or see the <a href="https://docs.openape.at" class="text-primary underline" target="_blank" rel="noreferrer">docs</a>.
        </p>
      </div>

      <template v-else>
        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="text-lg font-semibold">
              Your agents
            </h2>
            <p class="text-sm text-muted mt-1">
              Grant activity per agent. Click an agent to manage standing grants.
            </p>
          </template>

          <table class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Agent
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Standing Grants
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Activity
                </th>
                <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-(--ui-border)">
              <tr
                v-for="agent in agents"
                :key="agent.email"
                class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)"
              >
                <td class="px-4 py-3">
                  <div class="text-sm font-medium">
                    {{ agent.display_name || agent.email }}
                  </div>
                  <div class="text-xs text-muted break-all font-mono">
                    {{ agent.email }}
                  </div>
                </td>
                <td class="px-4 py-3">
                  <UBadge v-if="standingCount(agent) > 0" color="success" variant="subtle" size="sm">
                    {{ standingCount(agent) }} active
                  </UBadge>
                  <span v-else class="text-xs text-muted">none</span>
                </td>
                <td class="px-4 py-3 text-xs">
                  <div class="flex gap-2 flex-wrap">
                    <UBadge v-if="agent.grant_counts?.pending" color="warning" variant="subtle" size="sm">
                      {{ agent.grant_counts.pending }} pending
                    </UBadge>
                    <UBadge v-if="agent.grant_counts?.approved" color="success" variant="subtle" size="sm">
                      {{ agent.grant_counts.approved }} approved
                    </UBadge>
                    <UBadge v-if="agent.grant_counts?.denied" color="error" variant="subtle" size="sm">
                      {{ agent.grant_counts.denied }} denied
                    </UBadge>
                    <UBadge v-if="agent.grant_counts?.used" color="neutral" variant="subtle" size="sm">
                      {{ agent.grant_counts.used }} used
                    </UBadge>
                    <span v-if="!agent.grant_counts || Object.values(agent.grant_counts).every(v => !v)" class="text-muted">no grants</span>
                  </div>
                </td>
                <td class="px-4 py-3 text-right">
                  <UButton
                    :to="`/agents/${encodeURIComponent(agent.email)}`"
                    color="primary"
                    variant="soft"
                    size="xs"
                  >
                    Manage
                  </UButton>
                </td>
              </tr>
            </tbody>
          </table>
        </UCard>
      </template>
    </div>
  </div>
</template>
