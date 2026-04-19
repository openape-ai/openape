<script setup>
import { computed, onMounted, ref } from 'vue'
import { navigateTo } from '#imports'
import { useIdpAuth } from '../composables/useIdpAuth'

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const agents = ref([])
const loading = ref(true)
const error = ref('')

// Bulk-apply modal state
const bulkOpen = ref(false)
const bulkSelected = ref(new Set())
const bulkBusy = ref(false)
const bulkResults = ref(null)
const bulkError = ref('')

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

function openBulk() {
  bulkSelected.value = new Set(agents.value.map(a => a.email))
  bulkResults.value = null
  bulkError.value = ''
  bulkOpen.value = true
}

function toggleBulkSelect(email, checked) {
  const next = new Set(bulkSelected.value)
  if (checked) next.add(email)
  else next.delete(email)
  bulkSelected.value = next
}

async function applyBulk() {
  bulkBusy.value = true
  bulkError.value = ''
  try {
    const res = await $fetch('/api/standing-grants/bulk-seed', {
      method: 'POST',
      body: { delegates: [...bulkSelected.value] },
    })
    bulkResults.value = res.results
    await loadAgents()
  }
  catch (err) {
    bulkError.value = err?.data?.title || 'Bulk-apply failed'
  }
  finally {
    bulkBusy.value = false
  }
}

function closeBulk() {
  if (bulkBusy.value) return
  bulkOpen.value = false
}

const bulkTotalCreated = computed(() =>
  bulkResults.value ? bulkResults.value.reduce((s, r) => s + r.created, 0) : 0,
)
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
        <div class="flex gap-2">
          <UButton
            v-if="agents.length > 0"
            color="primary"
            variant="soft"
            size="sm"
            icon="i-lucide-shield-check"
            @click="openBulk"
          >
            Apply safe commands
          </UButton>
          <UButton to="/account" color="neutral" variant="soft" size="sm">
            Account
          </UButton>
        </div>
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

    <UModal v-model:open="bulkOpen" :dismissible="!bulkBusy">
      <template #content>
        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              Apply safe commands to all agents
            </h3>
            <p class="text-sm text-muted mt-1">
              Each selected agent will receive the default safe-command standing grants. Already-present entries are skipped.
            </p>
          </template>

          <UAlert v-if="bulkError" color="error" :title="bulkError" class="mb-3" @close="bulkError = ''" />

          <div v-if="!bulkResults" class="space-y-2 max-h-80 overflow-y-auto">
            <label
              v-for="a in agents"
              :key="a.email"
              class="flex items-center gap-2 p-2 rounded-md hover:bg-(--ui-bg-elevated)/60 cursor-pointer"
            >
              <UCheckbox
                :model-value="bulkSelected.has(a.email)"
                @update:model-value="(v) => toggleBulkSelect(a.email, v)"
              />
              <div class="text-sm">
                <div class="font-medium">{{ a.display_name || a.email }}</div>
                <div class="text-xs text-muted font-mono">{{ a.email }}</div>
              </div>
            </label>
          </div>

          <div v-else class="space-y-2 text-sm">
            <div class="text-xs text-muted mb-2">
              Created {{ bulkTotalCreated }} new standing grant{{ bulkTotalCreated === 1 ? '' : 's' }} across {{ bulkResults.length }} agent{{ bulkResults.length === 1 ? '' : 's' }}.
            </div>
            <div
              v-for="r in bulkResults"
              :key="r.delegate"
              class="flex items-center justify-between px-2 py-1 border-b border-(--ui-border)"
            >
              <code class="text-xs font-mono break-all">{{ r.delegate }}</code>
              <span class="text-xs text-muted">
                +{{ r.created }} · {{ r.skipped }} skipped
              </span>
            </div>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" :disabled="bulkBusy" @click="closeBulk">
                {{ bulkResults ? 'Close' : 'Cancel' }}
              </UButton>
              <UButton
                v-if="!bulkResults"
                color="primary"
                :loading="bulkBusy"
                :disabled="bulkBusy || bulkSelected.size === 0"
                @click="applyBulk"
              >
                Apply
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
