<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: ['dashboard-auth'] })

useSeoMeta({ title: 'Grants' })

const { data: grantsResponse, refresh } = await useFetch<{ data: any[], pagination: { cursor: string | null, has_more: boolean } }>('/api/grants?limit=50')
const grants = computed(() => grantsResponse.value?.data ?? [])
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">
        Grants
      </h1>
      <UButton label="Refresh" variant="ghost" @click="refresh()" />
    </div>

    <div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <table v-if="grants?.length" class="w-full text-sm">
        <thead class="border-b border-gray-800 text-gray-400">
          <tr>
            <th class="text-left p-4">
              ID
            </th>
            <th class="text-left p-4">
              Agent
            </th>
            <th class="text-left p-4">
              User
            </th>
            <th class="text-left p-4">
              Status
            </th>
            <th class="text-left p-4">
              Scopes
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="grant in grants" :key="grant.id" class="border-b border-gray-800/50">
            <td class="p-4 font-mono text-xs">
              {{ grant.id?.slice(0, 8) }}...
            </td>
            <td class="p-4">
              {{ grant.agentId }}
            </td>
            <td class="p-4">
              {{ grant.userId }}
            </td>
            <td class="p-4">
              <UBadge
                :color="grant.status === 'approved' ? 'success' : grant.status === 'pending' ? 'warning' : 'error'"
                :label="grant.status"
              />
            </td>
            <td class="p-4 text-xs">
              {{ grant.scopes?.join(', ') }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="p-8 text-center text-gray-400">
        No grants yet.
      </div>
    </div>
  </div>
</template>
