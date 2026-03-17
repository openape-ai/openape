<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: ['dashboard-auth'] })

useSeoMeta({ title: 'Dashboard' })

const { data: stats, refresh } = await useFetch('/api/platform/stats')
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-bold">
        Overview
      </h1>
      <UButton label="Refresh" variant="ghost" @click="refresh()" />
    </div>

    <div v-if="stats" class="grid md:grid-cols-3 gap-6 mb-8">
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">
          Users
        </div>
        <div class="text-3xl font-bold">
          {{ stats.stats.users }}
        </div>
        <div class="text-xs text-gray-500 mt-1">
          Limit: {{ stats.limits.maxUsers }}
        </div>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">
          Agents
        </div>
        <div class="text-3xl font-bold">
          {{ stats.stats.agents }}
        </div>
        <div class="text-xs text-gray-500 mt-1">
          Limit: {{ stats.limits.maxAgents }}
        </div>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">
          Grants
        </div>
        <div class="text-3xl font-bold">
          {{ stats.stats.grants }}
        </div>
      </div>
    </div>

    <div v-if="stats" class="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <div class="text-sm text-gray-400 mb-1">
        Plan
      </div>
      <div class="flex items-center gap-3">
        <UBadge :color="stats.org.plan === 'payg' ? 'primary' : 'neutral'" :label="stats.org.plan === 'payg' ? 'Pay-as-you-grow' : 'Free'" />
        <NuxtLink v-if="stats.org.plan === 'free'" to="/dashboard/billing">
          <UButton label="Upgrade" size="xs" variant="outline" />
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
