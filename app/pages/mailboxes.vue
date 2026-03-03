<script setup lang="ts">
definePageMeta({ middleware: 'openape-auth' })

const { data: mailboxesData, refresh } = await useFetch('/api/v1/admin/mailboxes')
const { data: domainsData } = await useFetch('/api/v1/admin/domains')

const verifiedDomains = computed(() =>
  (domainsData.value || []).filter((d: any) => d.status === 'verified'),
)

const localPart = ref('')
const selectedDomainId = ref<string | undefined>('')
const creating = ref(false)
const error = ref('')
const createdKey = ref('')

async function createMailbox() {
  if (!localPart.value || !selectedDomainId.value) return
  creating.value = true
  error.value = ''
  createdKey.value = ''
  try {
    const result = await $fetch('/api/v1/admin/mailboxes', {
      method: 'POST',
      body: { localPart: localPart.value, domainId: selectedDomainId.value },
    })
    createdKey.value = result.apiKey
    localPart.value = ''
    await refresh()
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Error creating mailbox'
  }
  finally {
    creating.value = false
  }
}

async function deleteMailbox(id: string) {
  if (!confirm('Delete this mailbox and all its messages?')) return
  try {
    await $fetch(`/api/v1/admin/mailboxes/${id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Error deleting mailbox'
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="min-h-screen bg-gray-950 p-4">
    <div class="max-w-4xl mx-auto space-y-4">
      <div class="flex items-center gap-3">
        <UButton to="/dashboard" icon="i-lucide-arrow-left" variant="ghost" size="sm" />
        <AppLogo />
        <h1 class="text-lg font-semibold text-white">Mailboxes</h1>
      </div>

      <!-- API Key Alert -->
      <UCard v-if="createdKey" class="border-green-800">
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-key" class="text-green-400" />
            <h3 class="font-semibold text-green-400">API Key Created</h3>
          </div>
          <p class="text-sm text-gray-400">
            Copy this key now — it will not be shown again.
          </p>
          <code class="block bg-gray-900 rounded-lg p-3 text-sm text-white font-mono break-all select-all">
            {{ createdKey }}
          </code>
          <UButton size="xs" variant="soft" @click="createdKey = ''">
            Dismiss
          </UButton>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-white">Create Mailbox</h2>
        </template>
        <div v-if="verifiedDomains.length === 0" class="text-sm text-gray-500 text-center py-4">
          You need at least one verified domain before creating mailboxes.
          <UButton to="/domains" variant="link" size="sm">Add a domain</UButton>
        </div>
        <form v-else class="flex gap-3 items-end" @submit.prevent="createMailbox">
          <UFormField label="Local part" class="flex-1">
            <UInput v-model="localPart" placeholder="agent-1" icon="i-lucide-at-sign" />
          </UFormField>
          <UFormField label="Domain">
            <USelect
              v-model="selectedDomainId"
              :items="verifiedDomains.map((d: any) => ({ label: d.domain, value: d.id }))"
              placeholder="Select domain"
            />
          </UFormField>
          <UButton type="submit" :loading="creating" icon="i-lucide-plus">
            Create
          </UButton>
        </form>
        <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-white">Your Mailboxes</h2>
        </template>
        <div v-if="(mailboxesData || []).length === 0" class="text-sm text-gray-500 text-center py-4">
          No mailboxes created yet.
        </div>
        <div v-else class="divide-y divide-gray-800">
          <div
            v-for="m in mailboxesData"
            :key="m.id"
            class="flex items-center justify-between py-3"
          >
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-mail" class="text-gray-400" />
              <div>
                <p class="text-white font-medium">{{ m.address }}</p>
                <p class="text-xs text-gray-500">
                  {{ m.messageCount }} messages · {{ formatBytes(m.totalSizeBytes || 0) }} / {{ formatBytes(m.softCapBytes) }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full"
                  :class="(m.totalSizeBytes || 0) / m.softCapBytes > 0.8 ? 'bg-red-500' : 'bg-green-500'"
                  :style="{ width: `${Math.min(100, ((m.totalSizeBytes || 0) / m.softCapBytes) * 100)}%` }"
                />
              </div>
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                @click="deleteMailbox(m.id)"
              />
            </div>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
