<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIdpAuth } from '@openape/vue-components'

const route = useRoute()
const router = useRouter()
const { user, loading: authLoading, fetchUser } = useIdpAuth()

const activeTab = ref(
  route.query.tab === 'sessions' ? 'sessions' : route.query.tab === 'registration' ? 'registration' : 'users',
)

// --- Users ---
const users = ref<any[]>([])
const usersLoading = ref(false)
const newUser = ref({ name: '', email: '' })
const userError = ref('')
const userSuccess = ref('')

// --- Sessions ---
const sessions = ref<any[]>([])
const sessionsLoading = ref(false)
const sessionError = ref('')

// --- Registration URLs ---
const regUrls = ref<any[]>([])
const regUrlsLoading = ref(false)
const newRegUrl = ref({ email: '', name: '', expiresInHours: 24 })
const regUrlError = ref('')
const regUrlSuccess = ref('')
const copiedToken = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    router.push('/login')
    return
  }
  if (!user.value.isAdmin) {
    router.push('/')
    return
  }
  await Promise.all([loadUsers(), loadSessions(), loadRegUrls()])
})

async function loadUsers() {
  usersLoading.value = true
  try {
    const res = await fetch('/api/admin/users', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      users.value = data.data || data
    }
    else {
      users.value = []
    }
  }
  catch {
    users.value = []
  }
  finally {
    usersLoading.value = false
  }
}

async function createUser() {
  userError.value = ''
  userSuccess.value = ''
  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(newUser.value),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || (err as Record<string, string>).statusMessage || 'Failed to create user')
    }
    userSuccess.value = `User ${newUser.value.email} created`
    newUser.value = { name: '', email: '' }
    await loadUsers()
  }
  catch (err) {
    userError.value = err instanceof Error ? err.message : 'Failed to create user'
  }
}

async function deleteUser(email: string) {
  if (!confirm(`Delete user ${email}?`))
    return
  userError.value = ''
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || 'Failed to delete user')
    }
    await loadUsers()
  }
  catch (err) {
    userError.value = err instanceof Error ? err.message : 'Failed to delete user'
  }
}

async function loadSessions() {
  sessionsLoading.value = true
  try {
    const res = await fetch('/api/admin/sessions', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      sessions.value = data.data || data
    }
    else {
      sessions.value = []
    }
  }
  catch {
    sessions.value = []
  }
  finally {
    sessionsLoading.value = false
  }
}

async function revokeSession(familyId: string) {
  if (!confirm('Revoke this session?'))
    return
  sessionError.value = ''
  try {
    const res = await fetch(`/api/admin/sessions/${familyId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || 'Failed to revoke session')
    }
    await loadSessions()
  }
  catch (err) {
    sessionError.value = err instanceof Error ? err.message : 'Failed to revoke session'
  }
}

async function loadRegUrls() {
  regUrlsLoading.value = true
  try {
    const res = await fetch('/api/admin/registration-urls', { credentials: 'include' })
    if (res.ok) {
      regUrls.value = await res.json()
    }
    else {
      regUrls.value = []
    }
  }
  catch {
    regUrls.value = []
  }
  finally {
    regUrlsLoading.value = false
  }
}

async function createRegUrl() {
  regUrlError.value = ''
  regUrlSuccess.value = ''
  try {
    const res = await fetch('/api/admin/registration-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(newRegUrl.value),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || 'Failed to create registration URL')
    }
    const result = await res.json()
    regUrlSuccess.value = result.registrationUrl
    newRegUrl.value = { email: '', name: '', expiresInHours: 24 }
    await loadRegUrls()
  }
  catch (err) {
    regUrlError.value = err instanceof Error ? err.message : 'Failed to create registration URL'
  }
}

async function deleteRegUrl(token: string) {
  if (!confirm('Delete this registration URL?'))
    return
  regUrlError.value = ''
  try {
    const res = await fetch(`/api/admin/registration-urls/${token}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || 'Failed to delete registration URL')
    }
    await loadRegUrls()
  }
  catch (err) {
    regUrlError.value = err instanceof Error ? err.message : 'Failed to delete registration URL'
  }
}

function registerUrl(token: string) {
  return `${window.location.origin}/register?token=${token}`
}

async function copyToClipboard(text: string, token: string) {
  await navigator.clipboard.writeText(text)
  copiedToken.value = token
  setTimeout(() => {
    copiedToken.value = ''
  }, 2e3)
}

function formatDate(ts: number) {
  const ms = ts < 1e12 ? ts * 1000 : ts
  return new Date(ms).toLocaleDateString()
}

function formatDateTime(ts: number) {
  const ms = ts < 1e12 ? ts * 1000 : ts
  return new Date(ms).toLocaleString()
}

function regUrlStatus(entry: any) {
  if (entry.consumed) return { label: 'Used', color: 'neutral' as const }
  if (entry.expiresAt < Date.now()) return { label: 'Expired', color: 'error' as const }
  return { label: 'Active', color: 'success' as const }
}
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            Admin Dashboard
          </h1>
          <p class="text-sm text-muted">
            Manage users, sessions, and registration URLs
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
        <UTabs
          v-model="activeTab"
          :items="[
            { label: `Users (${users.length})`, value: 'users', slot: 'users' },
            { label: `Sessions (${sessions.length})`, value: 'sessions', slot: 'sessions' },
            { label: 'Registration URLs', value: 'registration', slot: 'registration' },
          ]"
        >
          <!-- Users Tab -->
          <template #users>
            <div class="space-y-6 mt-6">
              <UCard>
                <template #header>
                  <h2 class="text-lg font-semibold">
                    Add User
                  </h2>
                </template>

                <UAlert v-if="userError" color="error" :title="userError" class="mb-4" />
                <UAlert v-if="userSuccess" color="success" :title="userSuccess" class="mb-4" />

                <form class="flex flex-wrap gap-3 items-end" @submit.prevent="createUser">
                  <div class="flex-1 min-w-[150px]">
                    <UFormField label="Name" required>
                      <UInput v-model="newUser.name" required placeholder="Name" />
                    </UFormField>
                  </div>
                  <div class="flex-1 min-w-[200px]">
                    <UFormField label="Email" required>
                      <UInput v-model="newUser.email" type="email" required placeholder="user@domain.com" />
                    </UFormField>
                  </div>
                  <UButton color="primary" type="submit">
                    Add User
                  </UButton>
                </form>
              </UCard>

              <UCard :ui="{ body: 'p-0' }">
                <div v-if="usersLoading" class="p-6 text-center text-muted">
                  Loading...
                </div>
                <div v-else-if="users.length === 0" class="p-6 text-center text-muted">
                  No users found.
                </div>
                <table v-else class="w-full">
                  <thead class="border-b border-(--ui-border)">
                    <tr>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Name
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Email
                      </th>
                      <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-(--ui-border)">
                    <tr v-for="u in users" :key="u.email" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                      <td class="px-4 py-3 text-sm">
                        {{ u.name }}
                      </td>
                      <td class="px-4 py-3 text-sm text-muted font-mono">
                        {{ u.email }}
                      </td>
                      <td class="px-4 py-3 text-right">
                        <UButton
                          v-if="u.email !== user?.email"
                          variant="ghost"
                          size="xs"
                          color="error"
                          @click="deleteUser(u.email)"
                        >
                          Delete
                        </UButton>
                        <span v-else class="text-xs text-muted">You</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </UCard>
            </div>
          </template>

          <!-- Sessions Tab -->
          <template #sessions>
            <div class="space-y-6 mt-6">
              <UAlert v-if="sessionError" color="error" :title="sessionError" class="mb-4" />

              <UCard :ui="{ body: 'p-0' }">
                <template #header>
                  <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold">
                      Active Sessions
                    </h2>
                    <UButton color="primary" variant="soft" size="xs" @click="loadSessions">
                      Refresh
                    </UButton>
                  </div>
                </template>

                <div v-if="sessionsLoading" class="p-6 text-center text-muted">
                  Loading...
                </div>
                <div v-else-if="sessions.length === 0" class="p-6 text-center text-muted">
                  No active sessions.
                </div>
                <table v-else class="w-full">
                  <thead class="border-b border-(--ui-border)">
                    <tr>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        User
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Client
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Created
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Expires
                      </th>
                      <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-(--ui-border)">
                    <tr v-for="s in sessions" :key="s.familyId" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                      <td class="px-4 py-3 text-sm font-mono text-muted">
                        {{ s.userId }}
                      </td>
                      <td class="px-4 py-3 text-sm text-muted">
                        {{ s.clientId }}
                      </td>
                      <td class="px-4 py-3 text-xs text-muted">
                        {{ formatDateTime(s.createdAt) }}
                      </td>
                      <td class="px-4 py-3 text-xs text-muted">
                        {{ formatDateTime(s.expiresAt) }}
                      </td>
                      <td class="px-4 py-3 text-right">
                        <UButton
                          variant="ghost"
                          size="xs"
                          color="error"
                          @click="revokeSession(s.familyId)"
                        >
                          Revoke
                        </UButton>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </UCard>
            </div>
          </template>

          <!-- Registration URLs Tab -->
          <template #registration>
            <div class="space-y-6 mt-6">
              <UCard>
                <template #header>
                  <h2 class="text-lg font-semibold">
                    Create Registration URL
                  </h2>
                </template>

                <UAlert v-if="regUrlError" color="error" :title="regUrlError" class="mb-4" />
                <UAlert v-if="regUrlSuccess" color="success" class="mb-4">
                  <div class="flex items-center gap-2">
                    <code class="text-xs break-all flex-1">{{ regUrlSuccess }}</code>
                    <UButton
                      size="xs"
                      variant="soft"
                      @click="copyToClipboard(regUrlSuccess, 'success')"
                    >
                      {{ copiedToken === "success" ? "Copied!" : "Copy" }}
                    </UButton>
                  </div>
                </UAlert>

                <form class="flex flex-wrap gap-3 items-end" @submit.prevent="createRegUrl">
                  <div class="flex-1 min-w-[200px]">
                    <UFormField label="Email" required>
                      <UInput v-model="newRegUrl.email" type="email" required placeholder="user@domain.com" />
                    </UFormField>
                  </div>
                  <div class="flex-1 min-w-[150px]">
                    <UFormField label="Name" required>
                      <UInput v-model="newRegUrl.name" required placeholder="User Name" />
                    </UFormField>
                  </div>
                  <div class="w-[120px]">
                    <UFormField label="Expires (hours)">
                      <UInput v-model.number="newRegUrl.expiresInHours" type="number" :min="1" :max="168" />
                    </UFormField>
                  </div>
                  <UButton color="primary" type="submit">
                    Create URL
                  </UButton>
                </form>
              </UCard>

              <UCard :ui="{ body: 'p-0' }">
                <div v-if="regUrlsLoading" class="p-6 text-center text-muted">
                  Loading...
                </div>
                <div v-else-if="regUrls.length === 0" class="p-6 text-center text-muted">
                  No registration URLs found.
                </div>
                <table v-else class="w-full">
                  <thead class="border-b border-(--ui-border)">
                    <tr>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Email
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Name
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Status
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Expires
                      </th>
                      <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-(--ui-border)">
                    <tr v-for="r in regUrls" :key="r.token" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                      <td class="px-4 py-3 text-sm font-mono text-muted">
                        {{ r.email }}
                      </td>
                      <td class="px-4 py-3 text-sm">
                        {{ r.name }}
                      </td>
                      <td class="px-4 py-3">
                        <UBadge :color="regUrlStatus(r).color" variant="subtle">
                          {{ regUrlStatus(r).label }}
                        </UBadge>
                      </td>
                      <td class="px-4 py-3 text-xs text-muted">
                        {{ formatDateTime(r.expiresAt) }}
                      </td>
                      <td class="px-4 py-3 text-right space-x-1">
                        <UButton
                          v-if="!r.consumed && r.expiresAt > Date.now()"
                          variant="ghost"
                          size="xs"
                          @click="copyToClipboard(registerUrl(r.token), r.token)"
                        >
                          {{ copiedToken === r.token ? "Copied!" : "Copy URL" }}
                        </UButton>
                        <UButton variant="ghost" size="xs" color="error" @click="deleteRegUrl(r.token)">
                          Delete
                        </UButton>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </UCard>
            </div>
          </template>
        </UTabs>
      </template>
    </div>
  </div>
</template>
