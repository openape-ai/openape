<script setup lang="ts">
const { user, loading: authLoading, fetchUser } = useAuth()
const route = useRoute()

const activeTab = ref<'users' | 'agents'>(route.query.tab === 'agents' ? 'agents' : 'users')
const enrolledAgentId = ref(route.query.enrolled as string || '')

// Users
const users = ref<{ email: string, name: string }[]>([])
const usersLoading = ref(false)
const newUser = ref({ name: '', email: '', password: '' })
const userError = ref('')
const userSuccess = ref('')

// Agents
interface Agent {
  id: string
  name: string
  owner: string
  approver: string
  publicKey: string
  isActive: boolean
  createdAt: number
}
const agents = ref<Agent[]>([])
const agentsLoading = ref(false)
const newAgent = ref({ name: '', owner: '', approver: '', publicKey: '' })
const agentError = ref('')
const agentSuccess = ref('')
const editingAgent = ref<Agent | null>(null)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  if (!user.value.isAdmin) {
    await navigateTo('/')
    return
  }
  await Promise.all([loadUsers(), loadAgents()])
})

// User CRUD
async function loadUsers() {
  usersLoading.value = true
  try {
    users.value = await $fetch('/api/admin/users')
  }
  catch { users.value = [] }
  finally { usersLoading.value = false }
}

async function createUser() {
  userError.value = ''
  userSuccess.value = ''
  try {
    await $fetch('/api/admin/users', { method: 'POST', body: newUser.value })
    userSuccess.value = `User ${newUser.value.email} created`
    newUser.value = { name: '', email: '', password: '' }
    await loadUsers()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    userError.value = e.data?.statusMessage ?? 'Failed to create user'
  }
}

async function deleteUser(email: string) {
  // eslint-disable-next-line no-alert
  if (!confirm(`Delete user ${email}?`))
    return
  userError.value = ''
  try {
    await $fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' })
    await loadUsers()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    userError.value = e.data?.statusMessage ?? 'Failed to delete user'
  }
}

// Agent CRUD
async function loadAgents() {
  agentsLoading.value = true
  try {
    agents.value = await $fetch('/api/admin/agents')
  }
  catch { agents.value = [] }
  finally { agentsLoading.value = false }
}

async function createAgent() {
  agentError.value = ''
  agentSuccess.value = ''
  try {
    await $fetch('/api/admin/agents', { method: 'POST', body: newAgent.value })
    agentSuccess.value = `Agent "${newAgent.value.name}" created`
    newAgent.value = { name: '', owner: '', approver: '', publicKey: '' }
    await loadAgents()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    agentError.value = e.data?.statusMessage ?? 'Failed to create agent'
  }
}

async function deleteAgent(id: string) {
  // eslint-disable-next-line no-alert
  if (!confirm('Delete this agent?'))
    return
  agentError.value = ''
  try {
    await $fetch(`/api/admin/agents/${id}`, { method: 'DELETE' })
    await loadAgents()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    agentError.value = e.data?.statusMessage ?? 'Failed to delete agent'
  }
}

async function toggleAgent(agent: Agent) {
  agentError.value = ''
  try {
    await $fetch(`/api/admin/agents/${agent.id}`, {
      method: 'PUT',
      body: { isActive: !agent.isActive },
    })
    await loadAgents()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    agentError.value = e.data?.statusMessage ?? 'Failed to update agent'
  }
}

async function startEditAgent(agent: Agent) {
  editingAgent.value = { ...agent }
}

async function saveEditAgent() {
  if (!editingAgent.value)
    return
  agentError.value = ''
  try {
    await $fetch(`/api/admin/agents/${editingAgent.value.id}`, {
      method: 'PUT',
      body: {
        name: editingAgent.value.name,
        owner: editingAgent.value.owner,
        approver: editingAgent.value.approver,
        publicKey: editingAgent.value.publicKey,
      },
    })
    editingAgent.value = null
    await loadAgents()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    agentError.value = e.data?.statusMessage ?? 'Failed to update agent'
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString()
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
            Manage users and agents
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
        <!-- Tabs -->
        <UTabs
          v-model="activeTab"
          :items="[
            { label: `Users (${users.length})`, value: 'users', slot: 'users' },
            { label: `Agents (${agents.length})`, value: 'agents', slot: 'agents' },
          ]"
        >
          <!-- Users Tab -->
          <template #users>
            <div class="space-y-6 mt-6">
              <!-- Add User Form -->
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
                  <div class="flex-1 min-w-[150px]">
                    <UFormField label="Password" required>
                      <UInput v-model="newUser.password" type="password" required placeholder="Password" />
                    </UFormField>
                  </div>
                  <UButton color="primary" type="submit">
                    Add User
                  </UButton>
                </form>
              </UCard>

              <!-- Users Table -->
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
                    <tr v-for="u in users" :key="u.email" class="hover:bg-(--ui-bg-elevated)">
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

          <!-- Agents Tab -->
          <template #agents>
            <div class="space-y-6 mt-6">
              <!-- Enrollment success banner -->
              <UAlert
                v-if="enrolledAgentId"
                color="success"
                title="Agent enrolled successfully"
                description="The agent is now active and ready to use."
                :close-button="{ onClick: () => enrolledAgentId = '' }"
              />

              <!-- Edit Agent Modal -->
              <div v-if="editingAgent">
                <UModal :open="true" title="Edit Agent" @update:open="editingAgent = null">
                  <template #body>
                    <form class="space-y-3" @submit.prevent="saveEditAgent">
                      <UFormField label="Name" required>
                        <UInput v-model="editingAgent.name" required />
                      </UFormField>
                      <UFormField label="Owner Email" required>
                        <UInput v-model="editingAgent.owner" type="email" required />
                      </UFormField>
                      <UFormField label="Approver Email" required>
                        <UInput v-model="editingAgent.approver" type="email" required />
                      </UFormField>
                      <UFormField label="Public Key (ssh-ed25519)" required>
                        <UTextarea v-model="editingAgent.publicKey" required :rows="2" />
                      </UFormField>
                      <div class="flex gap-3 justify-end pt-2">
                        <UButton variant="ghost" @click="editingAgent = null">
                          Cancel
                        </UButton>
                        <UButton color="primary" type="submit">
                          Save
                        </UButton>
                      </div>
                    </form>
                  </template>
                </UModal>
              </div>

              <!-- Add Agent Form -->
              <UCard>
                <template #header>
                  <h2 class="text-lg font-semibold">
                    Add Agent
                  </h2>
                </template>

                <UAlert v-if="agentError" color="error" :title="agentError" class="mb-4" />
                <UAlert v-if="agentSuccess" color="success" :title="agentSuccess" class="mb-4" />

                <form class="space-y-3" @submit.prevent="createAgent">
                  <div class="flex flex-wrap gap-3">
                    <div class="flex-1 min-w-[200px]">
                      <UFormField label="Agent Name" required>
                        <UInput v-model="newAgent.name" required placeholder="My Agent" />
                      </UFormField>
                    </div>
                    <div class="flex-1 min-w-[200px]">
                      <UFormField label="Owner Email" required>
                        <UInput v-model="newAgent.owner" type="email" required placeholder="owner@domain.com" />
                      </UFormField>
                    </div>
                    <div class="flex-1 min-w-[200px]">
                      <UFormField label="Approver Email" required>
                        <UInput v-model="newAgent.approver" type="email" required placeholder="approver@domain.com" />
                      </UFormField>
                    </div>
                  </div>
                  <UFormField label="Public Key (ssh-ed25519)" required>
                    <UTextarea v-model="newAgent.publicKey" required :rows="2" placeholder="ssh-ed25519 AAAA..." />
                  </UFormField>
                  <UButton color="primary" type="submit">
                    Add Agent
                  </UButton>
                </form>
              </UCard>

              <!-- Agents Table -->
              <UCard :ui="{ body: 'p-0' }">
                <div v-if="agentsLoading" class="p-6 text-center text-muted">
                  Loading...
                </div>
                <div v-else-if="agents.length === 0" class="p-6 text-center text-muted">
                  No agents found.
                </div>
                <table v-else class="w-full">
                  <thead class="border-b border-(--ui-border)">
                    <tr>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Name
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Owner
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Approver
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Status
                      </th>
                      <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                        Created
                      </th>
                      <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-(--ui-border)">
                    <tr v-for="a in agents" :key="a.id" class="hover:bg-(--ui-bg-elevated)">
                      <td class="px-4 py-3 text-sm">
                        {{ a.name }}
                      </td>
                      <td class="px-4 py-3 text-sm text-muted font-mono text-xs">
                        {{ a.owner }}
                      </td>
                      <td class="px-4 py-3 text-sm text-muted font-mono text-xs">
                        {{ a.approver }}
                      </td>
                      <td class="px-4 py-3">
                        <UBadge :color="a.isActive ? 'success' : 'error'" variant="subtle">
                          {{ a.isActive ? 'Active' : 'Inactive' }}
                        </UBadge>
                      </td>
                      <td class="px-4 py-3 text-xs text-muted">
                        {{ formatDate(a.createdAt) }}
                      </td>
                      <td class="px-4 py-3 text-right space-x-1">
                        <UButton variant="ghost" size="xs" color="primary" @click="startEditAgent(a)">
                          Edit
                        </UButton>
                        <UButton variant="ghost" size="xs" color="warning" @click="toggleAgent(a)">
                          {{ a.isActive ? 'Deactivate' : 'Activate' }}
                        </UButton>
                        <UButton variant="ghost" size="xs" color="error" @click="deleteAgent(a.id)">
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
