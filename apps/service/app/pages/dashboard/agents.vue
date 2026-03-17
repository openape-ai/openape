<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: ['dashboard-auth'] })

useSeoMeta({ title: 'Agents' })

const { data: agents, refresh } = await useFetch<any[]>('/api/admin/agents')

const showCreate = ref(false)
const agentName = ref('')
const createLoading = ref(false)

async function createAgent() {
  createLoading.value = true
  try {
    await $fetch('/api/admin/agents', {
      method: 'POST',
      body: { name: agentName.value },
    })
    agentName.value = ''
    showCreate.value = false
    await refresh()
  }
  finally {
    createLoading.value = false
  }
}

async function deleteAgent(id: string) {
  if (!confirm('Delete this agent?')) return
  await $fetch(`/api/admin/agents/${id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">
        Agents
      </h1>
      <UButton label="Create Agent" @click="showCreate = !showCreate" />
    </div>

    <div v-if="showCreate" class="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
      <form class="flex gap-4 items-end" @submit.prevent="createAgent">
        <UFormField label="Agent name" class="flex-1">
          <UInput v-model="agentName" required class="w-full" />
        </UFormField>
        <UButton type="submit" label="Create" :loading="createLoading" />
      </form>
    </div>

    <div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-800 text-gray-400">
          <tr>
            <th class="text-left p-4">
              ID
            </th>
            <th class="text-left p-4">
              Name
            </th>
            <th class="text-right p-4">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="agent in agents" :key="agent.id" class="border-b border-gray-800/50">
            <td class="p-4 font-mono text-xs">
              {{ agent.id }}
            </td>
            <td class="p-4">
              {{ agent.name }}
            </td>
            <td class="p-4 text-right">
              <UButton size="xs" variant="ghost" color="error" label="Delete" @click="deleteAgent(agent.id)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
