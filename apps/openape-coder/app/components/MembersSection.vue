<script setup lang="ts">
import { ref } from 'vue'

export interface MemberRow {
  projectId: string
  email: string
  role: 'admin' | 'member'
  capabilities: ('editScope' | 'writeStories')[]
}

const props = defineProps<{
  projectId: string
  projectName: string
  members: MemberRow[]
  /** Whether the signed-in user is an admin (drives invite + capability controls). */
  isAdmin: boolean
}>()
const emit = defineEmits<{ changed: [] }>()

const CAPABILITIES = [
  { key: 'writeStories', label: 'Write stories', hint: 'Create and edit user stories, set status' },
  { key: 'editScope', label: 'Edit vision & repos', hint: 'Change the project vision and the affected repos' },
] as const

const showInvite = ref(false)
const savingKey = ref('')
const error = ref('')

function hasCapability(member: MemberRow, key: 'editScope' | 'writeStories') {
  return member.role === 'admin' || member.capabilities.includes(key)
}

async function toggle(member: MemberRow, key: 'editScope' | 'writeStories', granted: boolean) {
  savingKey.value = `${member.email}:${key}`
  error.value = ''
  try {
    await ($fetch as any)(`/api/projects/${props.projectId}/members/${encodeURIComponent(member.email)}`, {
      method: 'PATCH',
      body: { capability: key, granted },
    })
    emit('changed')
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Could not change this permission.'
  }
  finally {
    savingKey.value = ''
  }
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-lg font-semibold">
        Members
      </h3>
      <!-- Invite is admin-only: a non-admin never sees this button
           (coder-invite-members §4). -->
      <UButton v-if="isAdmin" color="primary" size="sm" icon="i-lucide-user-plus" @click="showInvite = true">
        Invite member
      </UButton>
    </div>

    <UAlert v-if="error" color="error" :title="error" />

    <ul class="space-y-2">
      <li
        v-for="m in members"
        :key="m.email"
        class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="font-medium truncate">{{ m.email }}</span>
          <UBadge :color="m.role === 'admin' ? 'primary' : 'neutral'" variant="subtle" size="sm">
            {{ m.role === 'admin' ? 'Admin' : 'Member' }}
          </UBadge>
        </div>

        <!-- Admins implicitly hold every capability — no toggles shown for
             them. Members show per-capability switches that only an admin can
             operate (coder-invite-members §2, §3). -->
        <div v-if="m.role !== 'admin'" class="mt-3 space-y-2">
          <div
            v-for="cap in CAPABILITIES"
            :key="cap.key"
            class="flex items-center justify-between gap-3 text-sm"
          >
            <div class="min-w-0">
              <p class="font-medium">
                {{ cap.label }}
              </p>
              <p class="text-xs text-muted truncate">
                {{ cap.hint }}
              </p>
            </div>
            <USwitch
              v-if="isAdmin"
              :model-value="hasCapability(m, cap.key)"
              :loading="savingKey === `${m.email}:${cap.key}`"
              @update:model-value="(v: boolean) => toggle(m, cap.key, v)"
            />
            <UIcon
              v-else
              :name="hasCapability(m, cap.key) ? 'i-lucide-check' : 'i-lucide-minus'"
              class="size-4 shrink-0"
              :class="hasCapability(m, cap.key) ? 'text-primary-400' : 'text-muted'"
            />
          </div>
        </div>
      </li>
    </ul>

    <InviteMemberDialog
      v-if="isAdmin"
      v-model:open="showInvite"
      :project-id="projectId"
      :project-name="projectName"
    />
  </section>
</template>
