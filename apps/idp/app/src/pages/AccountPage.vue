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

const sshKeys = ref<SshKey[]>([])
const keysLoading = ref(false)
const error = ref('')
const success = ref('')

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
      sshKeys.value = await res.json()
    }
    else {
      sshKeys.value = []
    }
  }
  catch {
    sshKeys.value = []
  }
  finally {
    keysLoading.value = false
  }
}

async function handleDeleteKey(keyId: string) {
  if (!user.value) return
  if (!confirm('Remove this SSH key?')) return
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
    success.value = 'Key removed'
    await loadKeys()
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to remove key'
  }
}

function formatDate(ts: number) {
  // Handle both seconds and millisecond timestamps
  const ms = ts < 1e12 ? ts * 1000 : ts
  return new Date(ms).toLocaleDateString()
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
          <p v-if="user" class="text-sm text-(--ui-text-muted)">
            {{ user.email }}
          </p>
        </div>
        <UButton color="neutral" variant="soft" size="sm" @click="router.push('/')">
          Back
        </UButton>
      </div>

      <div v-if="authLoading" class="text-center text-(--ui-text-muted) mt-10">
        Loading...
      </div>

      <template v-else>
        <UAlert v-if="error" color="error" :title="error" class="mb-4" />
        <UAlert v-if="success" color="success" :title="success" class="mb-4" />

        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="text-lg font-semibold">
              SSH Keys
            </h2>
          </template>

          <div v-if="keysLoading" class="p-6 text-center text-(--ui-text-muted)">
            Loading...
          </div>
          <div v-else-if="sshKeys.length === 0" class="p-6 text-center text-(--ui-text-muted)">
            No SSH keys registered.
          </div>
          <table v-else class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-(--ui-text-muted) uppercase">
                  Name
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-(--ui-text-muted) uppercase">
                  Key
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-(--ui-text-muted) uppercase">
                  Added
                </th>
                <th class="text-right px-4 py-3 text-xs font-medium text-(--ui-text-muted) uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-(--ui-border)">
              <tr v-for="k in sshKeys" :key="k.keyId" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                <td class="px-4 py-3 text-sm">
                  {{ k.name }}
                </td>
                <td class="px-4 py-3 text-xs font-mono text-(--ui-text-muted)">
                  {{ truncateKey(k.publicKey) }}
                </td>
                <td class="px-4 py-3 text-xs text-(--ui-text-muted)">
                  {{ formatDate(k.createdAt) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="error"
                    :disabled="sshKeys.length <= 1"
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
