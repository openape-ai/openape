<script setup>
import { onMounted, ref } from 'vue'
import { navigateTo } from '#imports'
import { useIdpAuth } from '../composables/useIdpAuth'
import { useWebAuthn } from '../composables/useWebAuthn'

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const { addDevice, error: webauthnError, loading: webauthnLoading } = useWebAuthn()
const credentials = ref([])
const credentialsLoading = ref(false)
const error = ref('')
const success = ref('')
const newDeviceName = ref('')

// SSH Keys
const sshKeys = ref([])
const sshKeysLoading = ref(false)
const newSshKey = ref('')
const newSshKeyName = ref('')
const sshKeyAdding = ref(false)

// Connected services (DDISA allowlist-user consents, #301)
const consents = ref([])
const consentsLoading = ref(false)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await Promise.all([loadCredentials(), loadSshKeys(), loadConsents()])
})
async function loadCredentials() {
  credentialsLoading.value = true
  try {
    credentials.value = await $fetch('/api/webauthn/credentials')
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
    await addDevice(newDeviceName.value || void 0)
    success.value = 'Device added successfully'
    newDeviceName.value = ''
    await loadCredentials()
  }
  catch {
    error.value = webauthnError.value
  }
}
async function handleDeleteCredential(credentialId) {
  if (!confirm('Remove this device?'))
    return
  error.value = ''
  try {
    await $fetch(`/api/webauthn/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' })
    await loadCredentials()
  }
  catch (err) {
    const e = err
    error.value = e.data?.statusMessage ?? 'Failed to remove device'
  }
}
function formatDate(ts) {
  return new Date(ts).toLocaleDateString()
}
function deviceLabel(c) {
  if (c.name) return c.name
  if (c.deviceType === 'multiDevice') return 'Synced Passkey'
  return 'Device-bound Passkey'
}

async function loadSshKeys() {
  sshKeysLoading.value = true
  try {
    sshKeys.value = await $fetch('/api/session/ssh-keys')
  }
  catch {
    sshKeys.value = []
  }
  finally {
    sshKeysLoading.value = false
  }
}
async function handleAddSshKey() {
  error.value = ''
  success.value = ''
  sshKeyAdding.value = true
  try {
    await $fetch('/api/session/ssh-keys', {
      method: 'POST',
      body: { publicKey: newSshKey.value, name: newSshKeyName.value || undefined },
    })
    success.value = 'SSH key added. You can now use "Sign in with SSH Key" on the login page.'
    newSshKey.value = ''
    newSshKeyName.value = ''
    await loadSshKeys()
  }
  catch (err) {
    const e = err
    error.value = e.data?.title ?? 'Failed to add SSH key'
  }
  finally {
    sshKeyAdding.value = false
  }
}
async function handleDeleteSshKey(keyId) {
  if (!confirm('Remove this SSH key?'))
    return
  error.value = ''
  try {
    await $fetch(`/api/session/ssh-keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' })
    await loadSshKeys()
  }
  catch (err) {
    const e = err
    error.value = e.data?.title ?? 'Failed to remove SSH key'
  }
}
function fingerprint(keyId) {
  return `SHA256:${keyId.substring(0, 16)}...`
}

async function loadConsents() {
  consentsLoading.value = true
  try {
    consents.value = await $fetch('/api/account/consents')
  }
  catch {
    consents.value = []
  }
  finally {
    consentsLoading.value = false
  }
}
async function handleRevokeConsent(clientId, clientName) {
  // Use the human-readable name in the prompt when we have one — falls
  // back to the bare client_id (hostname) for unverified SPs.
  const label = clientName || clientId
  if (!confirm(`Zugriff für ${label} entfernen? Du wirst beim nächsten Login wieder gefragt.`))
    return
  error.value = ''
  try {
    await $fetch(`/api/account/consents/${encodeURIComponent(clientId)}`, { method: 'DELETE' })
    success.value = `Zugriff für ${label} widerrufen`
    await loadConsents()
  }
  catch (err) {
    error.value = err?.data?.title ?? 'Failed to revoke access'
  }
}
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            Account
          </h1>
          <p v-if="user" class="text-sm text-muted">
            {{ user.email }}
          </p>
        </div>
        <UButton to="/" color="neutral" variant="soft" size="sm">
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
            <UButton
              color="primary"
              :loading="webauthnLoading"
              :disabled="webauthnLoading"
              @click="handleAddDevice"
            >
              Add Device
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
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="error"
                    :disabled="credentials.length <= 1"
                    @click="handleDeleteCredential(c.credentialId)"
                  >
                    Remove
                  </UButton>
                </td>
              </tr>
            </tbody>
          </table>
        </UCard>

        <UCard class="mt-6 mb-6">
          <template #header>
            <h2 class="text-lg font-semibold">
              Add SSH Key
            </h2>
            <p class="text-sm text-muted mt-1">
              Register your public key to use "Sign in with SSH Key" on the login page.
            </p>
          </template>

          <div class="space-y-3">
            <UFormField label="Name (optional)">
              <UInput v-model="newSshKeyName" placeholder="e.g. Work Laptop" />
            </UFormField>
            <UFormField label="Public Key">
              <UTextarea
                v-model="newSshKey"
                placeholder="ssh-ed25519 AAAA... (paste contents of ~/.ssh/id_ed25519.pub)"
                :rows="2"
                class="font-mono text-xs"
              />
            </UFormField>
            <UButton
              color="primary"
              :loading="sshKeyAdding"
              :disabled="!newSshKey.trim() || sshKeyAdding"
              @click="handleAddSshKey"
            >
              Add SSH Key
            </UButton>
          </div>
        </UCard>

        <UCard id="connected-services" class="mt-6 mb-6" :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="text-lg font-semibold">
              Connected Services
            </h2>
            <p class="text-sm text-muted mt-1">
              Anwendungen, die du bei der Anmeldung an id.openape.ai genehmigt hast.
              Widerrufen heißt: nächste Anmeldung an diesem Dienst zeigt wieder den Consent-Screen.
            </p>
          </template>

          <div v-if="consentsLoading" class="p-6 text-center text-muted">
            Loading...
          </div>
          <div v-else-if="consents.length === 0" class="p-6 text-center text-muted">
            Keine Dienste genehmigt. (Setze <code>mode=allowlist-user</code> in deiner DDISA-DNS, um Consent-Screens zu aktivieren.)
          </div>
          <table v-else class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Service
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Genehmigt
                </th>
                <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                  Aktion
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-(--ui-border)">
              <tr v-for="c in consents" :key="c.clientId" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                <td class="px-4 py-3 text-sm">
                  <div class="flex items-center gap-2">
                    <div class="min-w-0">
                      <div class="font-medium truncate flex items-center gap-1.5">
                        <a v-if="c.clientUri" :href="c.clientUri" target="_blank" rel="noopener" class="hover:underline">{{ c.clientName || c.clientId }}</a>
                        <span v-else>{{ c.clientName || c.clientId }}</span>
                        <UBadge v-if="!c.verified" color="warning" variant="subtle" size="xs">
                          unverifiziert
                        </UBadge>
                      </div>
                      <div v-if="c.clientName" class="text-xs text-muted truncate">
                        {{ c.clientId }}
                      </div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-xs text-muted whitespace-nowrap">
                  {{ formatDate(c.grantedAt * 1000) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="error"
                    @click="handleRevokeConsent(c.clientId, c.clientName)"
                  >
                    Widerrufen
                  </UButton>
                </td>
              </tr>
            </tbody>
          </table>
        </UCard>

        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="text-lg font-semibold">
              SSH Keys
            </h2>
          </template>

          <div v-if="sshKeysLoading" class="p-6 text-center text-muted">
            Loading...
          </div>
          <div v-else-if="sshKeys.length === 0" class="p-6 text-center text-muted">
            No SSH keys registered.
          </div>
          <table v-else class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Name
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Fingerprint
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
              <tr v-for="k in sshKeys" :key="k.keyId" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                <td class="px-4 py-3 text-sm">
                  {{ k.name }}
                </td>
                <td class="px-4 py-3 text-xs font-mono text-muted">
                  {{ fingerprint(k.keyId) }}
                </td>
                <td class="px-4 py-3 text-xs text-muted">
                  {{ formatDate(k.createdAt) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="error"
                    @click="handleDeleteSshKey(k.keyId)"
                  >
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
