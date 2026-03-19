<script setup>
import { onMounted, ref } from "vue";
import { navigateTo, useRoute } from "#imports";
import { useIdpAuth } from "../composables/useIdpAuth";
const { user, loading: authLoading, fetchUser } = useIdpAuth();
const route = useRoute();
const activeTab = ref(
  route.query.tab === "agents" ? "agents" : route.query.tab === "registration" ? "registration" : "users"
);
const enrolledAgentId = ref(route.query.enrolled || "");
const users = ref([]);
const usersLoading = ref(false);
const newUser = ref({ name: "", email: "" });
const userError = ref("");
const userSuccess = ref("");
const agents = ref([]);
const agentsLoading = ref(false);
const newAgent = ref({ email: "", name: "", owner: "", approver: "", publicKey: "" });
const agentError = ref("");
const agentSuccess = ref("");
const editingAgent = ref(null);
const regUrls = ref([]);
const regUrlsLoading = ref(false);
const newRegUrl = ref({ email: "", name: "", expiresInHours: 24 });
const regUrlError = ref("");
const regUrlSuccess = ref("");
const copiedToken = ref("");
onMounted(async () => {
  await fetchUser();
  if (!user.value) {
    await navigateTo("/login");
    return;
  }
  if (!user.value.isAdmin) {
    await navigateTo("/");
    return;
  }
  await Promise.all([loadUsers(), loadAgents(), loadRegUrls()]);
});
async function loadUsers() {
  usersLoading.value = true;
  try {
    users.value = await $fetch("/api/admin/users");
  } catch {
    users.value = [];
  } finally {
    usersLoading.value = false;
  }
}
async function createUser() {
  userError.value = "";
  userSuccess.value = "";
  try {
    await $fetch("/api/admin/users", { method: "POST", body: newUser.value });
    userSuccess.value = `User ${newUser.value.email} created`;
    newUser.value = { name: "", email: "" };
    await loadUsers();
  } catch (err) {
    const e = err;
    userError.value = e.data?.statusMessage ?? "Failed to create user";
  }
}
async function deleteUser(email) {
  if (!confirm(`Delete user ${email}?`))
    return;
  userError.value = "";
  try {
    await $fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: "DELETE" });
    await loadUsers();
  } catch (err) {
    const e = err;
    userError.value = e.data?.statusMessage ?? "Failed to delete user";
  }
}
async function loadAgents() {
  agentsLoading.value = true;
  try {
    agents.value = await $fetch("/api/admin/agents");
  } catch {
    agents.value = [];
  } finally {
    agentsLoading.value = false;
  }
}
async function createAgent() {
  agentError.value = "";
  agentSuccess.value = "";
  try {
    await $fetch("/api/admin/agents", { method: "POST", body: newAgent.value });
    agentSuccess.value = `Agent "${newAgent.value.name}" created`;
    newAgent.value = { email: "", name: "", owner: "", approver: "", publicKey: "" };
    await loadAgents();
  } catch (err) {
    const e = err;
    agentError.value = e.data?.statusMessage ?? "Failed to create agent";
  }
}
async function deleteAgent(id) {
  if (!confirm("Delete this agent?"))
    return;
  agentError.value = "";
  try {
    await $fetch(`/api/admin/agents/${id}`, { method: "DELETE" });
    await loadAgents();
  } catch (err) {
    const e = err;
    agentError.value = e.data?.statusMessage ?? "Failed to delete agent";
  }
}
async function toggleAgent(agent) {
  agentError.value = "";
  try {
    await $fetch(`/api/admin/agents/${agent.id}`, {
      method: "PUT",
      body: { isActive: !agent.isActive }
    });
    await loadAgents();
  } catch (err) {
    const e = err;
    agentError.value = e.data?.statusMessage ?? "Failed to update agent";
  }
}
async function startEditAgent(agent) {
  editingAgent.value = { ...agent };
}
async function saveEditAgent() {
  if (!editingAgent.value)
    return;
  agentError.value = "";
  try {
    await $fetch(`/api/admin/agents/${editingAgent.value.id}`, {
      method: "PUT",
      body: {
        email: editingAgent.value.email,
        name: editingAgent.value.name,
        owner: editingAgent.value.owner,
        approver: editingAgent.value.approver,
        publicKey: editingAgent.value.publicKey
      }
    });
    editingAgent.value = null;
    await loadAgents();
  } catch (err) {
    const e = err;
    agentError.value = e.data?.statusMessage ?? "Failed to update agent";
  }
}
async function loadRegUrls() {
  regUrlsLoading.value = true;
  try {
    regUrls.value = await $fetch("/api/admin/registration-urls");
  } catch {
    regUrls.value = [];
  } finally {
    regUrlsLoading.value = false;
  }
}
async function createRegUrl() {
  regUrlError.value = "";
  regUrlSuccess.value = "";
  try {
    const result = await $fetch("/api/admin/registration-urls", {
      method: "POST",
      body: newRegUrl.value
    });
    regUrlSuccess.value = result.registrationUrl;
    newRegUrl.value = { email: "", name: "", expiresInHours: 24 };
    await loadRegUrls();
  } catch (err) {
    const e = err;
    regUrlError.value = e.data?.statusMessage ?? "Failed to create registration URL";
  }
}
async function deleteRegUrl(token) {
  if (!confirm("Delete this registration URL?"))
    return;
  regUrlError.value = "";
  try {
    await $fetch(`/api/admin/registration-urls/${token}`, { method: "DELETE" });
    await loadRegUrls();
  } catch (err) {
    const e = err;
    regUrlError.value = e.data?.statusMessage ?? "Failed to delete registration URL";
  }
}
function registerUrl(token) {
  return `${window.location.origin}/register?token=${token}`;
}
async function copyToClipboard(text, token) {
  await navigator.clipboard.writeText(text);
  copiedToken.value = token;
  setTimeout(() => {
    copiedToken.value = "";
  }, 2e3);
}
function formatDate(ts) {
  return new Date(ts).toLocaleDateString();
}
function formatDateTime(ts) {
  return new Date(ts).toLocaleString();
}
function regUrlStatus(entry) {
  if (entry.consumed) return { label: "Used", color: "neutral" };
  if (entry.expiresAt < Date.now()) return { label: "Expired", color: "error" };
  return { label: "Active", color: "success" };
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
            Manage users, agents, and registration URLs
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
        <UTabs
          v-model="activeTab"
          :items="[
  { label: `Users (${users.length})`, value: 'users', slot: 'users' },
  { label: `Agents (${agents.length})`, value: 'agents', slot: 'agents' },
  { label: 'Registration URLs', value: 'registration', slot: 'registration' }
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

          <!-- Agents Tab -->
          <template #agents>
            <div class="space-y-6 mt-6">
              <UAlert
                v-if="enrolledAgentId"
                color="success"
                title="Agent enrolled successfully"
                description="The agent is now active and ready to use."
                :close-button="{ onClick: () => enrolledAgentId = '' }"
              />

              <div v-if="editingAgent">
                <UModal :open="true" title="Edit Agent" @update:open="editingAgent = null">
                  <template #body>
                    <form class="space-y-3" @submit.prevent="saveEditAgent">
                      <UFormField label="Email" required>
                        <UInput v-model="editingAgent.email" type="email" required />
                      </UFormField>
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
                      <UFormField label="Agent Email" required>
                        <UInput v-model="newAgent.email" type="email" required placeholder="agent@domain.com" />
                      </UFormField>
                    </div>
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
                        Email
                      </th>
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
                    <tr v-for="a in agents" :key="a.id" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                      <td class="px-4 py-3 text-sm text-muted font-mono text-xs">
                        {{ a.email }}
                      </td>
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
                          {{ a.isActive ? "Active" : "Inactive" }}
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
                          {{ a.isActive ? "Deactivate" : "Activate" }}
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
