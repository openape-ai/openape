<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIdpAuth } from '@openape/vue-components'

const router = useRouter()
const { user, loading: authLoading, fetchUser } = useIdpAuth()

interface SshKey {
  keyId: string
  name: string
  publicKey: string
  createdAt: number
}

const keys = ref<SshKey[]>([])
const keysLoading = ref(false)
const error = ref('')
const success = ref('')
const newKeyName = ref('')
const newKeyValue = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    router.push('/login')
    return
  }
  await loadKeys()
})

async function loadKeys() {
  if (!user.value) return
  keysLoading.value = true
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.value.email)}/ssh-keys`, {
      credentials: 'include',
    })
    if (res.ok) {
      keys.value = await res.json()
    }
    else {
      keys.value = []
    }
  }
  catch {
    keys.value = []
  }
  finally {
    keysLoading.value = false
  }
}

async function handleAddKey() {
  if (!user.value || !newKeyValue.value) return
  error.value = ''
  success.value = ''
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.value.email)}/ssh-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        publicKey: newKeyValue.value.trim(),
        name: newKeyName.value || undefined,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || 'Failed to add key')
    }
    success.value = 'Key added successfully'
    newKeyName.value = ''
    newKeyValue.value = ''
    await loadKeys()
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add key'
  }
}

async function handleDeleteKey(keyId: string) {
  if (!user.value) return
  if (!confirm('Remove this SSH key?'))
    return
  error.value = ''
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.value.email)}/ssh-keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || 'Failed to remove key')
    }
    await loadKeys()
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to remove key'
  }
}

function formatDate(ts: number) {
  const ms = ts < 1e12 ? ts * 1000 : ts
  return new Date(ms).toLocaleDateString()
}

function keyLabel(k: SshKey) {
  if (k.name) return k.name
  return 'SSH Key'
}

function truncateKey(key: string) {
  if (key.length <= 40) return key
  return `${key.slice(0, 30)}...${key.slice(-10)}`
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
        <UButton color="neutral" variant="soft" size="sm" @click="router.push('/')">
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
              Add SSH Key
            </h2>
          </template>

          <div class="space-y-3">
            <div class="flex gap-3 items-end">
              <div class="flex-1">
                <UFormField label="Key Name (optional)">
                  <UInput v-model="newKeyName" placeholder="e.g. Work Laptop" />
                </UFormField>
              </div>
            </div>
            <UFormField label="Public Key (ssh-ed25519)">
              <UTextarea
                v-model="newKeyValue"
                placeholder="ssh-ed25519 AAAA..."
                :rows="2"
                class="font-mono text-xs"
              />
            </UFormField>
            <UButton
              color="primary"
              :disabled="!newKeyValue"
              @click="handleAddKey"
            >
              Add Key
            </UButton>
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="text-lg font-semibold">
              Registered Keys
            </h2>
          </template>

          <div v-if="keysLoading" class="p-6 text-center text-muted">
            Loading...
          </div>
          <div v-else-if="keys.length === 0" class="p-6 text-center text-muted">
            No keys registered.
          </div>
          <table v-else class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Name
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Key
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
              <tr v-for="k in keys" :key="k.keyId" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                <td class="px-4 py-3 text-sm">
                  {{ keyLabel(k) }}
                </td>
                <td class="px-4 py-3 text-xs font-mono text-muted">
                  {{ truncateKey(k.publicKey) }}
                </td>
                <td class="px-4 py-3 text-xs text-muted">
                  {{ formatDate(k.createdAt) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="error"
                    :disabled="keys.length <= 1"
                    @click="handleDeleteKey(k.keyId)"
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
