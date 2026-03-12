<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: ['dashboard-auth'] })

useSeoMeta({ title: 'Users' })

const { data: users, refresh } = await useFetch<{ email: string, name: string }[]>('/api/admin/users')

const showInvite = ref(false)
const inviteEmail = ref('')
const inviteName = ref('')
const inviteLoading = ref(false)

async function inviteUser() {
  inviteLoading.value = true
  try {
    await $fetch('/api/admin/users', {
      method: 'POST',
      body: { email: inviteEmail.value, name: inviteName.value },
    })
    inviteEmail.value = ''
    inviteName.value = ''
    showInvite.value = false
    await refresh()
  }
  finally {
    inviteLoading.value = false
  }
}

async function deleteUser(email: string) {
  if (!confirm(`Delete user ${email}?`)) return
  await $fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Users</h1>
      <UButton label="Invite User" @click="showInvite = !showInvite" />
    </div>

    <div v-if="showInvite" class="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
      <form class="flex gap-4 items-end" @submit.prevent="inviteUser">
        <UFormField label="Email" class="flex-1">
          <UInput v-model="inviteEmail" type="email" required class="w-full" />
        </UFormField>
        <UFormField label="Name" class="flex-1">
          <UInput v-model="inviteName" required class="w-full" />
        </UFormField>
        <UButton type="submit" label="Add" :loading="inviteLoading" />
      </form>
    </div>

    <div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-800 text-gray-400">
          <tr>
            <th class="text-left p-4">Email</th>
            <th class="text-left p-4">Name</th>
            <th class="text-right p-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.email" class="border-b border-gray-800/50">
            <td class="p-4">{{ user.email }}</td>
            <td class="p-4">{{ user.name }}</td>
            <td class="p-4 text-right">
              <UButton size="xs" variant="ghost" color="error" label="Delete" @click="deleteUser(user.email)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
