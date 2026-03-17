<script setup lang="ts">
definePageMeta({ middleware: 'openape-auth' })

useSeoMeta({ title: 'Domains' })

const { data: domainsData, refresh } = await useFetch('/api/v1/admin/domains')
const newDomain = ref('')
const adding = ref(false)
const error = ref('')
const selectedDomain = ref<any>(null)

async function addDomain() {
  if (!newDomain.value) return
  adding.value = true
  error.value = ''
  try {
    await $fetch('/api/v1/admin/domains', {
      method: 'POST',
      body: { domain: newDomain.value },
    })
    newDomain.value = ''
    await refresh()
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Error adding domain'
  }
  finally {
    adding.value = false
  }
}

async function verifyDomain(id: string) {
  try {
    await $fetch(`/api/v1/admin/domains/${id}/verify`, { method: 'POST' })
    await refresh()
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Verification failed'
  }
}

async function deleteDomain(id: string) {
  if (!confirm('Delete this domain? All associated mailboxes will become unusable.')) return
  try {
    await $fetch(`/api/v1/admin/domains/${id}`, { method: 'DELETE' })
    selectedDomain.value = null
    await refresh()
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Error deleting domain'
  }
}

async function showDetails(id: string) {
  try {
    selectedDomain.value = await $fetch(`/api/v1/admin/domains/${id}`)
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Error loading domain'
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-950 p-4">
    <div class="max-w-4xl mx-auto space-y-4">
      <div class="flex items-center gap-3">
        <UButton to="/dashboard" icon="i-lucide-arrow-left" variant="ghost" size="sm" />
        <AppLogo />
        <h1 class="text-lg font-semibold text-white">
          Domains
        </h1>
      </div>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-white">
            Add Domain
          </h2>
        </template>
        <form class="flex gap-3" @submit.prevent="addDomain">
          <UInput
            v-model="newDomain"
            placeholder="agent.example.com"
            class="flex-1"
            icon="i-lucide-globe"
          />
          <UButton type="submit" :loading="adding" icon="i-lucide-plus">
            Add
          </UButton>
        </form>
        <p v-if="error" class="mt-2 text-sm text-red-400">
          {{ error }}
        </p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-white">
            Your Domains
          </h2>
        </template>
        <div v-if="(domainsData || []).length === 0" class="text-sm text-gray-500 text-center py-4">
          No domains configured yet.
        </div>
        <div v-else class="divide-y divide-gray-800">
          <div
            v-for="d in domainsData"
            :key="d.id"
            class="flex items-center justify-between py-3"
          >
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-globe" class="text-gray-400" />
              <div>
                <p class="text-white font-medium">
                  {{ d.domain }}
                </p>
                <p class="text-xs text-gray-500">
                  Added {{ new Date(d.createdAt).toLocaleDateString() }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UBadge :color="d.status === 'verified' ? 'success' : d.status === 'failed' ? 'error' : 'warning'" size="sm">
                {{ d.status }}
              </UBadge>
              <UButton
                v-if="d.status !== 'verified'"
                size="xs"
                variant="soft"
                icon="i-lucide-refresh-cw"
                @click="verifyDomain(d.id)"
              >
                Verify
              </UButton>
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-eye"
                @click="showDetails(d.id)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                @click="deleteDomain(d.id)"
              />
            </div>
          </div>
        </div>
      </UCard>

      <!-- DNS Records Detail Panel -->
      <UCard v-if="selectedDomain">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-white">
              DNS Records — {{ selectedDomain.domain }}
            </h2>
            <UButton size="xs" variant="ghost" icon="i-lucide-x" @click="selectedDomain = null" />
          </div>
        </template>
        <p class="text-sm text-gray-400 mb-4">
          Set these DNS records at your domain provider to verify the domain.
        </p>
        <div v-if="selectedDomain.dnsRecords?.length" class="space-y-3">
          <div
            v-for="(record, i) in selectedDomain.dnsRecords"
            :key="i"
            class="bg-gray-900 rounded-lg p-3 text-sm font-mono"
          >
            <div class="flex gap-4 text-gray-400">
              <span class="text-yellow-400 w-12">{{ record.type }}</span>
              <span class="text-white flex-1 break-all">{{ record.name }}</span>
            </div>
            <div class="mt-1 text-gray-300 break-all pl-16">
              {{ record.value }}
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-gray-500">
          No DNS records available.
        </p>
      </UCard>
    </div>
  </div>
</template>
