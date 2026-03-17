<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: ['dashboard-auth'] })

useSeoMeta({ title: 'Billing' })

const { data: stats } = await useFetch('/api/platform/stats')
const route = useRoute()

const upgradeLoading = ref(false)
const portalLoading = ref(false)

async function startCheckout() {
  upgradeLoading.value = true
  try {
    const result = await $fetch<{ url: string }>('/api/platform/billing/checkout', { method: 'POST' })
    navigateTo(result.url, { external: true })
  }
  finally {
    upgradeLoading.value = false
  }
}

async function openPortal() {
  portalLoading.value = true
  try {
    const result = await $fetch<{ url: string }>('/api/platform/billing/portal', { method: 'POST' })
    navigateTo(result.url, { external: true })
  }
  finally {
    portalLoading.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl">
    <h1 class="text-2xl font-bold mb-6">
      Billing
    </h1>

    <UAlert v-if="route.query.success" color="success" title="Payment successful! Your plan has been upgraded." class="mb-6" />
    <UAlert v-if="route.query.canceled" color="warning" title="Checkout canceled." class="mb-6" />

    <div class="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
      <div class="text-sm text-gray-400 mb-2">
        Current Plan
      </div>
      <div class="flex items-center gap-3 mb-4">
        <UBadge
          size="lg"
          :color="stats?.org?.plan === 'payg' ? 'primary' : 'neutral'"
          :label="stats?.org?.plan === 'payg' ? 'Pay-as-you-grow' : 'Free'"
        />
      </div>

      <div v-if="stats?.org?.plan === 'free'">
        <p class="text-sm text-gray-400 mb-4">
          Upgrade to remove limits and unlock custom domains.
        </p>
        <UButton label="Upgrade to Pay-as-you-grow" color="primary" :loading="upgradeLoading" @click="startCheckout" />
      </div>

      <div v-else>
        <p class="text-sm text-gray-400 mb-4">
          Manage your subscription, payment methods, and invoices via the Stripe portal.
        </p>
        <UButton label="Manage Billing" variant="outline" :loading="portalLoading" @click="openPortal" />
      </div>
    </div>

    <div v-if="stats" class="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <div class="text-sm text-gray-400 mb-4">
        Current Usage
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="text-2xl font-bold">
            {{ stats.stats.users }}
          </div>
          <div class="text-sm text-gray-400">
            Users (limit: {{ stats.limits.maxUsers }})
          </div>
        </div>
        <div>
          <div class="text-2xl font-bold">
            {{ stats.stats.agents }}
          </div>
          <div class="text-sm text-gray-400">
            Agents (limit: {{ stats.limits.maxAgents }})
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
