<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface Member {
  userEmail: string
  role: 'member' | 'admin'
  joinedAt: number
}

const props = defineProps<{
  open: boolean
  roomId: string
  myEmail: string | null | undefined
  myRole: 'member' | 'admin' | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'changed': []
}>()

const open = computed({
  get: () => props.open,
  set: v => emit('update:open', v),
})

const members = ref<Member[]>([])
const loading = ref(false)
const errorMsg = ref<string | null>(null)

const newEmail = ref('')
const newRole = ref<'member' | 'admin'>('member')
const adding = ref(false)

async function load() {
  if (!props.roomId) return
  loading.value = true
  errorMsg.value = null
  try {
    members.value = await $fetch<Member[]>(`/api/rooms/${props.roomId}/members`)
  }
  catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not load members.'
  }
  finally {
    loading.value = false
  }
}

watch(() => props.open, (v) => {
  if (v) load()
})

async function add() {
  const email = newEmail.value.trim()
  if (!email || adding.value) return
  errorMsg.value = null
  adding.value = true
  try {
    await $fetch(`/api/rooms/${props.roomId}/members`, {
      method: 'POST',
      body: { email, role: newRole.value },
    })
    newEmail.value = ''
    newRole.value = 'member'
    await load()
    emit('changed')
  }
  catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not add member.'
  }
  finally {
    adding.value = false
  }
}

async function setRole(member: Member, role: 'member' | 'admin') {
  if (member.role === role) return
  errorMsg.value = null
  try {
    await $fetch(`/api/rooms/${props.roomId}/members/${encodeURIComponent(member.userEmail)}`, {
      method: 'PATCH',
      body: { role },
    })
    await load()
    emit('changed')
  }
  catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not change role.'
  }
}

async function remove(member: Member) {
  if (member.userEmail === props.myEmail) return
  errorMsg.value = null
  try {
    await $fetch(`/api/rooms/${props.roomId}/members/${encodeURIComponent(member.userEmail)}`, {
      method: 'DELETE',
    })
    await load()
    emit('changed')
  }
  catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not remove member.'
  }
}

const isAdmin = computed(() => props.myRole === 'admin')
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-md' }">
    <template #content>
      <div class="p-6 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">
              Members
            </h2>
            <p class="text-xs text-zinc-500">
              {{ isAdmin ? 'Add, remove, or change roles.' : 'Read-only — only admins can edit.' }}
            </p>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Close"
            @click="open = false"
          />
        </div>

        <p v-if="errorMsg" class="text-sm text-red-400">
          {{ errorMsg }}
        </p>

        <form v-if="isAdmin" class="space-y-2" @submit.prevent="add">
          <UFormField label="Add member by email" :ui="{ label: 'text-xs' }">
            <div class="flex gap-2">
              <UInput
                v-model="newEmail"
                type="email"
                placeholder="alice@example.com"
                class="flex-1"
                :disabled="adding"
              />
              <USelect
                v-model="newRole"
                :items="[
                  { value: 'member', label: 'Member' },
                  { value: 'admin', label: 'Admin' },
                ]"
                :disabled="adding"
              />
              <UButton
                type="submit"
                color="primary"
                :loading="adding"
                :disabled="!newEmail.trim() || adding"
                icon="i-lucide-user-plus"
                aria-label="Add"
              />
            </div>
          </UFormField>
        </form>

        <div class="space-y-2">
          <p v-if="loading" class="text-sm text-zinc-500">
            Loading…
          </p>
          <ul v-else class="divide-y divide-zinc-800 -mx-2">
            <li v-for="m of members" :key="m.userEmail" class="px-2 py-2 flex items-center gap-2">
              <UIcon
                :name="m.role === 'admin' ? 'i-lucide-shield' : 'i-lucide-user'"
                :class="m.role === 'admin' ? 'text-primary-400' : 'text-zinc-500'"
                class="size-4 shrink-0"
              />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">
                  {{ m.userEmail }}
                  <span v-if="m.userEmail === myEmail" class="text-xs text-zinc-500 font-normal">(you)</span>
                </p>
                <p class="text-xs text-zinc-500 capitalize">
                  {{ m.role }}
                </p>
              </div>
              <template v-if="isAdmin">
                <UButton
                  v-if="m.role === 'member'"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  :title="m.userEmail === myEmail ? 'You can promote yourself' : 'Promote to admin'"
                  @click="setRole(m, 'admin')"
                >
                  Make admin
                </UButton>
                <UButton
                  v-else-if="m.userEmail !== myEmail"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  title="Demote to member"
                  @click="setRole(m, 'member')"
                >
                  Demote
                </UButton>
                <UButton
                  v-if="m.userEmail !== myEmail"
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-user-minus"
                  aria-label="Remove from room"
                  title="Remove from room"
                  @click="remove(m)"
                />
              </template>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </UModal>
</template>
