<script setup lang="ts">
definePageMeta({ middleware: 'openape-auth' })

const { user, logout } = useOpenApeAuth()

const { data: domainsData } = await useFetch('/api/v1/admin/domains')
const { data: mailboxesData } = await useFetch('/api/v1/admin/mailboxes')

const verifiedDomains = computed(() =>
  (domainsData.value || []).filter((d: any) => d.status === 'verified').length,
)
</script>

<template>
  <div class="min-h-screen bg-gray-950 p-4">
    <div class="max-w-4xl mx-auto space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <AppLogo />
          <div>
            <h1 class="text-lg font-semibold text-white">Agent Mail</h1>
            <p class="text-sm text-gray-400">{{ user?.sub }}</p>
          </div>
        </div>
        <UButton color="neutral" variant="ghost" icon="i-lucide-log-out" @click="logout()">
          Logout
        </UButton>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <UCard>
          <div class="text-center">
            <p class="text-3xl font-bold text-white">{{ (domainsData || []).length }}</p>
            <p class="text-sm text-gray-400">Domains</p>
            <p class="text-xs text-gray-500">{{ verifiedDomains }} verified</p>
          </div>
        </UCard>

        <UCard>
          <div class="text-center">
            <p class="text-3xl font-bold text-white">{{ (mailboxesData || []).length }}</p>
            <p class="text-sm text-gray-400">Mailboxes</p>
          </div>
        </UCard>

        <UCard>
          <div class="text-center">
            <p class="text-3xl font-bold text-white">
              {{ Math.round((mailboxesData || []).reduce((s: number, m: any) => s + (m.totalSizeBytes || 0), 0) / 1024 / 1024 * 10) / 10 }}
            </p>
            <p class="text-sm text-gray-400">MB used</p>
          </div>
        </UCard>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold text-white">Domains</h2>
              <UButton size="sm" to="/domains" icon="i-lucide-arrow-right" variant="ghost">
                Manage
              </UButton>
            </div>
          </template>
          <div v-if="(domainsData || []).length === 0" class="text-sm text-gray-500 text-center py-4">
            No domains yet
          </div>
          <ul v-else class="space-y-2">
            <li v-for="d in domainsData" :key="d.id" class="flex items-center justify-between text-sm">
              <span class="text-white">{{ d.domain }}</span>
              <UBadge :color="d.status === 'verified' ? 'success' : d.status === 'failed' ? 'error' : 'warning'" size="sm">
                {{ d.status }}
              </UBadge>
            </li>
          </ul>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold text-white">Mailboxes</h2>
              <UButton size="sm" to="/mailboxes" icon="i-lucide-arrow-right" variant="ghost">
                Manage
              </UButton>
            </div>
          </template>
          <div v-if="(mailboxesData || []).length === 0" class="text-sm text-gray-500 text-center py-4">
            No mailboxes yet
          </div>
          <ul v-else class="space-y-2">
            <li v-for="m in mailboxesData" :key="m.id" class="flex items-center justify-between text-sm">
              <span class="text-white">{{ m.address }}</span>
              <span class="text-gray-500">{{ m.messageCount }} msgs</span>
            </li>
          </ul>
        </UCard>
      </div>
    </div>
  </div>
</template>
