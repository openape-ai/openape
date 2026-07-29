<script setup lang="ts">
// App override of the module's /passkeys page: adds "send an add-device
// link to my email" (#1097), whose mint endpoint
// (POST /api/account/add-device-link) is free-idp-only — the generic
// module page cannot offer it. Everything else mirrors the module page.

useHead({ title: 'Passkeys — OpenApe' })

// Module-registered API routes are not part of nitro's typed route union;
// $fetch's fallback route matching then overflows TS's comparison stack
// (TS2321). Opt this page out of route typing entirely.
const apiFetch = $fetch as (url: string, opts?: Record<string, unknown>) => Promise<any>

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const { addDevice, error: webauthnError, loading: webauthnLoading } = useWebAuthn()
const credentials = ref<any[]>([])
const credentialsLoading = ref(false)
const error = ref('')
const success = ref('')
const newDeviceName = ref('')
const linkLoading = ref(false)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await loadCredentials()
})
async function loadCredentials() {
  credentialsLoading.value = true
  try {
    credentials.value = await apiFetch('/api/webauthn/credentials')
  }
  catch {
    credentials.value = []
  }
  finally {
    credentialsLoading.value = false
  }
}
async function handleAddDevice() {
  error.value = ''
  success.value = ''
  try {
    await addDevice(newDeviceName.value || undefined)
    success.value = 'Device added successfully'
    newDeviceName.value = ''
    await loadCredentials()
  }
  catch {
    error.value = webauthnError.value
  }
}
async function handleSendAddDeviceLink() {
  error.value = ''
  success.value = ''
  linkLoading.value = true
  try {
    await apiFetch('/api/account/add-device-link', { method: 'POST' })
    success.value = `Link sent to ${user.value?.email} — open it on your new device. Valid for 1 hour.`
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage ?? 'Failed to send the link'
  }
  finally {
    linkLoading.value = false
  }
}
async function handleDeleteCredential(credentialId: string) {
  if (!confirm('Remove this device?'))
    return
  error.value = ''
  try {
    await apiFetch(`/api/webauthn/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' })
    await loadCredentials()
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage ?? 'Failed to remove device'
  }
}
function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString()
}
function deviceLabel(c: any) {
  if (c.name) return c.name
  if (c.deviceType === 'multiDevice') return 'Synced Passkey'
  return 'Device-bound Passkey'
}
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            Passkeys
          </h1>
          <p v-if="user" class="text-sm text-muted">
            {{ user.email }}
          </p>
        </div>
        <UButton to="/account" color="neutral" variant="soft" size="sm">
          Back
        </UButton>
      </div>

      <div v-if="authLoading" class="text-center text-muted mt-10">
        Loading...
      </div>

      <template v-else>
        <UAlert v-if="error" color="error" :title="error" class="mb-4" />
        <UAlert v-if="success" color="success" :title="success" class="mb-4" />

        <UCard class="mb-6">
          <template #header>
            <h2 class="text-lg font-semibold">
              Add Device
            </h2>
          </template>

          <div class="flex gap-3 items-end">
            <div class="flex-1">
              <UFormField label="Device Name (optional)">
                <UInput v-model="newDeviceName" placeholder="e.g. Work Laptop" />
              </UFormField>
            </div>
            <UButton color="primary" :loading="webauthnLoading" :disabled="webauthnLoading" @click="handleAddDevice">
              Add Device
            </UButton>
          </div>

          <USeparator class="my-4" />

          <div class="flex gap-3 items-center justify-between">
            <p class="text-sm text-muted">
              On another device right now? Get a one-time link by email and
              open it there to create a passkey on that device.
            </p>
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-mail"
              :loading="linkLoading"
              :disabled="linkLoading"
              @click="handleSendAddDeviceLink"
            >
              Email me a link
            </UButton>
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="text-lg font-semibold">
              Registered Devices
            </h2>
          </template>

          <div v-if="credentialsLoading" class="p-6 text-center text-muted">
            Loading...
          </div>
          <div v-else-if="credentials.length === 0" class="p-6 text-center text-muted">
            No devices registered.
          </div>
          <table v-else class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Device
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Type
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Added
                </th>
                <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-(--ui-border)">
              <tr v-for="c in credentials" :key="c.credentialId" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                <td class="px-4 py-3 text-sm">
                  {{ deviceLabel(c) }}
                </td>
                <td class="px-4 py-3">
                  <UBadge :color="c.backedUp ? 'success' : 'neutral'" variant="subtle" size="sm">
                    {{ c.deviceType === "multiDevice" ? "Synced" : "Device-bound" }}
                  </UBadge>
                </td>
                <td class="px-4 py-3 text-xs text-muted">
                  {{ formatDate(c.createdAt) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <UButton variant="ghost" size="xs" color="error" :disabled="credentials.length <= 1" @click="handleDeleteCredential(c.credentialId)">
                    Remove
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
