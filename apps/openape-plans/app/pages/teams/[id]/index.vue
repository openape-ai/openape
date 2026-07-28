<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser } = useOpenApeAuth()
const route = useRoute()
const teamId = computed(() => String(route.params.id))

interface TeamMember { email: string, role: 'owner' | 'editor' | 'viewer', joined_at: number }
interface TeamPlan {
  id: string
  title: string
  status: 'draft' | 'active' | 'done' | 'archived'
  owner_email: string
  updated_at: number
  updated_by: string
}
interface TeamDetail {
  id: string
  name: string
  description: string | null
  created_at: number
  members: TeamMember[]
  plans: TeamPlan[]
}

interface InviteSummary {
  id: string
  created_by: string
  note: string | null
  max_uses: number
  used_count: number
  expires_at: number
  created_at: number
}

const detail = ref<TeamDetail | null>(null)
const loading = ref(true)
const error = ref('')

const invites = ref<InviteSummary[]>([])
const invitesLoading = ref(false)
const invitesError = ref('')
const showInvites = ref(false)
const showHistory = ref(false)

const STATUS_ORDER: Record<TeamPlan['status'], number> = { active: 0, draft: 1, done: 2, archived: 3 }
function sortByStatusThenUpdated(a: TeamPlan, b: TeamPlan): number {
  const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  return s !== 0 ? s : b.updated_at - a.updated_at
}
const currentPlans = computed<TeamPlan[]>(() => {
  if (!detail.value) return []
  return detail.value.plans.filter(p => p.status === 'active' || p.status === 'draft').sort(sortByStatusThenUpdated)
})
const historyPlans = computed<TeamPlan[]>(() => {
  if (!detail.value) return []
  return detail.value.plans.filter(p => p.status === 'done' || p.status === 'archived').sort(sortByStatusThenUpdated)
})

const showInviteModal = ref(false)
const inviteMaxUses = ref(5)
const inviteExpiresIn = ref('7d')
const inviteNote = ref('')
const creating = ref(false)
const createError = ref('')
const createdUrl = ref('')
const copied = ref(false)

const callerRole = computed<'owner' | 'editor' | 'viewer' | null>(() => {
  if (!detail.value || !user.value) return null
  return detail.value.members.find(m => m.email === user.value?.sub)?.role ?? null
})
const canEdit = computed(() => callerRole.value === 'owner' || callerRole.value === 'editor')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await loadDetail()
})

async function loadDetail() {
  loading.value = true
  error.value = ''
  try {
    detail.value = await ($fetch as any)(`/api/teams/${teamId.value}`) as TeamDetail
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string }, statusCode?: number }
    error.value = e.data?.title ?? 'Failed to load team'
    detail.value = null
  }
  finally {
    loading.value = false
  }
}

function formatRelative(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function statusColor(s: TeamPlan['status']): 'neutral' | 'primary' | 'success' | 'warning' {
  if (s === 'active') return 'primary'
  if (s === 'done') return 'success'
  if (s === 'archived') return 'warning'
  return 'neutral'
}

async function removeMember(email: string) {
  if (!confirm(`Remove ${email} from this team?`)) return
  try {
    await ($fetch as any)(`/api/teams/${teamId.value}/members/${encodeURIComponent(email)}`, { method: 'DELETE' })
    await loadDetail()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to remove member'
  }
}

async function toggleInvites() {
  showInvites.value = !showInvites.value
  if (showInvites.value) await loadInvites()
}

async function loadInvites() {
  invitesLoading.value = true
  invitesError.value = ''
  try {
    invites.value = await ($fetch as any)(`/api/teams/${teamId.value}/invites`) as InviteSummary[]
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    invitesError.value = e.data?.title ?? 'Failed to load invites'
    invites.value = []
  }
  finally {
    invitesLoading.value = false
  }
}

function openInviteModal() {
  createdUrl.value = ''
  createError.value = ''
  inviteMaxUses.value = 5
  inviteExpiresIn.value = '7d'
  inviteNote.value = ''
  copied.value = false
  showInviteModal.value = true
}

async function createInvite() {
  if (creating.value) return
  creating.value = true
  createError.value = ''
  try {
    const result = await ($fetch as any)(`/api/teams/${teamId.value}/invites`, {
      method: 'POST',
      body: {
        max_uses: inviteMaxUses.value,
        expires_in: inviteExpiresIn.value,
        note: inviteNote.value.trim() || undefined,
      },
    }) as { url: string }
    createdUrl.value = result.url
    await loadInvites()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    createError.value = e.data?.title ?? 'Failed to create invite'
  }
  finally {
    creating.value = false
  }
}

async function copyUrl() {
  if (!createdUrl.value) return
  try {
    await navigator.clipboard.writeText(createdUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch {
    copied.value = false
  }
}

async function revokeInvite(id: string) {
  if (!confirm('Revoke this invite? Anyone with the URL will no longer be able to join.')) return
  try {
    await ($fetch as any)(`/api/invites/${id}`, { method: 'DELETE' })
    await loadInvites()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    invitesError.value = e.data?.title ?? 'Failed to revoke invite'
  }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}
</script>

<template>
  <div class="min-h-dvh py-8 px-4">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <UButton to="/teams" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm">
          All teams
        </UButton>
      </div>

      <div v-if="loading" class="text-center text-gray-500 mt-10">
        Loading…
      </div>

      <UAlert v-else-if="error" color="error" :title="error" />

      <div v-else-if="detail">
        <div class="mb-6">
          <h1 class="text-2xl font-bold">
            {{ detail.name }}
          </h1>
          <p v-if="detail.description" class="text-gray-500 mt-1">
            {{ detail.description }}
          </p>
        </div>

        <!-- Plans -->
        <section class="mb-8">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-lg font-semibold">
              Plans
            </h2>
            <UButton
              v-if="canEdit"
              :to="`/teams/${teamId}/plans/new`"
              color="primary"
              icon="i-lucide-plus"
              size="sm"
            >
              New plan
            </UButton>
          </div>
          <div v-if="currentPlans.length === 0" class="text-center py-8 text-gray-500 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
            <p class="mb-3">
              {{ historyPlans.length > 0 ? 'No active plans. See history below.' : 'No plans yet.' }}
            </p>
            <UButton
              v-if="canEdit"
              :to="`/teams/${teamId}/plans/new`"
              color="primary"
              icon="i-lucide-plus"
              size="sm"
            >
              {{ historyPlans.length > 0 ? 'New plan' : 'Create first plan' }}
            </UButton>
          </div>
          <div v-else class="grid grid-cols-1 gap-2">
            <NuxtLink
              v-for="p in currentPlans"
              :key="p.id"
              :to="`/teams/${teamId}/plans/${p.id}`"
              class="block p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary hover:shadow-sm transition"
            >
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <div class="font-medium truncate">
                    {{ p.title }}
                  </div>
                  <div class="text-xs text-gray-500 mt-0.5">
                    {{ p.owner_email }} · updated {{ formatRelative(p.updated_at) }}
                  </div>
                </div>
                <UBadge :color="statusColor(p.status)" variant="subtle" size="xs">
                  {{ p.status }}
                </UBadge>
              </div>
            </NuxtLink>
          </div>
        </section>

        <!-- Invites -->
        <section v-if="canEdit" class="mb-8">
          <div class="flex items-center justify-between mb-3">
            <button
              type="button"
              class="flex items-center gap-2 text-lg font-semibold"
              @click="toggleInvites"
            >
              <UIcon :name="showInvites ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
              Invites
            </button>
            <UButton color="primary" icon="i-lucide-link" size="sm" @click="openInviteModal">
              New invite link
            </UButton>
          </div>
          <div v-if="showInvites">
            <div v-if="invitesLoading" class="text-sm text-gray-500">
              Loading…
            </div>
            <UAlert v-else-if="invitesError" color="error" :title="invitesError" />
            <div v-else-if="invites.length === 0" class="text-sm text-gray-500 italic">
              No active invites.
            </div>
            <div v-else class="grid grid-cols-1 gap-2">
              <div
                v-for="inv in invites"
                :key="inv.id"
                class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <div class="min-w-0 flex-1">
                  <div class="text-sm">
                    By <span class="font-mono">{{ inv.created_by }}</span>
                    · {{ inv.used_count }}/{{ inv.max_uses }} uses
                  </div>
                  <div class="text-xs text-gray-500">
                    Expires {{ formatDate(inv.expires_at) }}
                    <span v-if="inv.note" class="italic">— "{{ inv.note }}"</span>
                  </div>
                </div>
                <UButton color="error" variant="ghost" icon="i-lucide-x" size="xs" @click="revokeInvite(inv.id)">
                  Revoke
                </UButton>
              </div>
            </div>
          </div>
        </section>

        <!-- Members -->
        <section>
          <h2 class="text-lg font-semibold mb-3">
            Members ({{ detail.members.length }})
          </h2>
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="m in detail.members"
              :key="m.email"
              class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <UIcon name="i-lucide-user" class="text-gray-400" />
              <div class="min-w-0 flex-1">
                <div class="font-mono text-sm truncate">
                  {{ m.email }}
                </div>
              </div>
              <UBadge :color="m.role === 'owner' ? 'primary' : 'neutral'" variant="subtle" size="xs">
                {{ m.role }}
              </UBadge>
              <UButton
                v-if="callerRole === 'owner' && m.email !== user?.sub"
                color="error"
                variant="ghost"
                icon="i-lucide-x"
                size="xs"
                @click="removeMember(m.email)"
              />
            </div>
          </div>
        </section>

        <!-- History (done + archived) -->
        <section v-if="historyPlans.length > 0" class="mt-8">
          <button
            type="button"
            class="flex items-center gap-2 text-lg font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            @click="showHistory = !showHistory"
          >
            <UIcon :name="showHistory ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
            History ({{ historyPlans.length }})
          </button>
          <div v-if="showHistory" class="grid grid-cols-1 gap-2 mt-3">
            <NuxtLink
              v-for="p in historyPlans"
              :key="p.id"
              :to="`/teams/${teamId}/plans/${p.id}`"
              class="block p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary hover:shadow-sm transition opacity-70 hover:opacity-100"
            >
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <div class="font-medium truncate">
                    {{ p.title }}
                  </div>
                  <div class="text-xs text-gray-500 mt-0.5">
                    {{ p.owner_email }} · updated {{ formatRelative(p.updated_at) }}
                  </div>
                </div>
                <UBadge :color="statusColor(p.status)" variant="subtle" size="xs">
                  {{ p.status }}
                </UBadge>
              </div>
            </NuxtLink>
          </div>
        </section>
      </div>
    </div>

    <UModal v-model:open="showInviteModal" :dismissible="!creating">
      <template #content>
        <div class="p-6 space-y-4 max-w-md">
          <h3 class="text-lg font-semibold">
            Create invite link
          </h3>

          <div v-if="!createdUrl">
            <div class="space-y-3">
              <UFormField label="Max uses">
                <UInput v-model.number="inviteMaxUses" type="number" min="1" max="100" />
              </UFormField>
              <UFormField label="Expires in" help="e.g. 7d, 24h, 30m">
                <UInput v-model="inviteExpiresIn" placeholder="7d" />
              </UFormField>
              <UFormField label="Note (optional)" help="Context shown to the recipient.">
                <UInput v-model="inviteNote" maxlength="200" placeholder="Welcome to the team!" />
              </UFormField>
            </div>
            <UAlert v-if="createError" color="error" :title="createError" class="mt-3" @close="createError = ''" />
            <div class="flex gap-2 pt-4">
              <UButton color="primary" :loading="creating" @click="createInvite">
                Generate URL
              </UButton>
              <UButton color="neutral" variant="ghost" :disabled="creating" @click="showInviteModal = false">
                Cancel
              </UButton>
            </div>
          </div>

          <div v-else>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Share this URL. Anyone who opens it will be able to join the team (up to the uses limit before expiry).
            </p>
            <div class="p-3 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs break-all">
              {{ createdUrl }}
            </div>
            <div class="flex gap-2 pt-4">
              <UButton color="primary" icon="i-lucide-copy" @click="copyUrl">
                {{ copied ? 'Copied!' : 'Copy URL' }}
              </UButton>
              <UButton color="neutral" variant="ghost" @click="showInviteModal = false">
                Done
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
