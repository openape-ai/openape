<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'
import type { MemberRow } from '../../../components/MembersSection.vue'

const route = useRoute()
const projectId = computed(() => String(route.params.id))

const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface Project {
  id: string
  name: string
  visionMd: string
  repos: string[]
  createdAt: number
  updatedAt: number
}

const project = ref<Project | null>(null)
const members = ref<MemberRow[]>([])
const loading = ref(true)
const error = ref('')

useSeoMeta({ title: () => project.value ? `${project.value.name} — OpenApe Coder` : 'OpenApe Coder' })

// The signed-in identity's membership, derived from the member list. Drives
// every permission-gated control on the page.
const myEmail = computed(() => (user.value?.sub ?? '').toLowerCase())
const myMembership = computed(() => members.value.find(m => m.email === myEmail.value) ?? null)
const isAdmin = computed(() => myMembership.value?.role === 'admin')
const canEditScope = computed(() =>
  myMembership.value?.role === 'admin' || (myMembership.value?.capabilities.includes('editScope') ?? false),
)

const tabs = computed(() => [
  { value: 'overview', label: 'Overview', icon: 'i-lucide-compass' },
  { value: 'members', label: 'Members', icon: 'i-lucide-users' },
])
const activeTab = ref('overview')

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [p, m] = await Promise.all([
      ($fetch as any)(`/api/projects/${projectId.value}`),
      ($fetch as any)(`/api/projects/${projectId.value}/members`),
    ])
    project.value = p
    members.value = m
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    // 404 covers both "missing" and "not a member" — no existence leak.
    error.value = err?.data?.statusMessage || err?.message || 'Could not load this project.'
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => { if (u) loadAll(); else navigateTo('/login') }, { immediate: true })

// Scope editor (vision + repos). Only mounted when canEditScope is true.
const visionDraft = ref('')
const reposDraft = ref('')
const scopeSaving = ref(false)
const scopeError = ref('')

watch(project, (p) => {
  if (p) {
    visionDraft.value = p.visionMd
    reposDraft.value = p.repos.join('\n')
  }
})

const scopeDirty = computed(() => {
  if (!project.value) return false
  return visionDraft.value !== project.value.visionMd
    || reposDraft.value !== project.value.repos.join('\n')
})

async function saveScope() {
  if (!project.value || !scopeDirty.value) return
  scopeSaving.value = true
  scopeError.value = ''
  const repos = reposDraft.value.split('\n').map(r => r.trim()).filter(Boolean)
  try {
    const updated = await ($fetch as any)(`/api/projects/${projectId.value}`, {
      method: 'PATCH',
      body: { visionMd: visionDraft.value, repos },
    })
    project.value = updated
  }
  catch (err: any) {
    scopeError.value = err?.data?.statusMessage || err?.message || 'Could not save the changes.'
  }
  finally {
    scopeSaving.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-3 sm:px-6 py-3 flex items-center gap-2 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
      <UButton to="/" variant="ghost" size="sm" icon="i-lucide-arrow-left" :ui="{ base: 'shrink-0' }">
        <span class="hidden sm:inline">All projects</span>
      </UButton>
      <span v-if="project" class="font-semibold truncate flex-1">
        🛠️ {{ project.name }}
      </span>
      <UButton variant="ghost" size="sm" icon="i-lucide-log-out" :ui="{ base: 'shrink-0' }" @click="logout">
        <span class="hidden md:inline">Log out</span>
      </UButton>
    </header>

    <main class="px-4 sm:px-6 py-4 sm:py-6 max-w-4xl mx-auto space-y-4 sm:space-y-6">
      <UAlert v-if="error" color="error" :title="error" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          Loading…
        </p>
      </UCard>

      <template v-else-if="project">
        <div class="flex items-center justify-between gap-3">
          <UTabs v-model="activeTab" :items="tabs" class="flex-1" :ui="{ list: 'overflow-x-auto' }" />
          <UButton
            :to="`/projects/${project.id}/stories`"
            color="primary"
            variant="soft"
            size="sm"
            icon="i-lucide-layout-list"
            trailing-icon="i-lucide-chevron-right"
          >
            <span class="hidden sm:inline">Story board</span>
          </UButton>
        </div>

        <!-- Overview: vision + affected repos. Editable only with the
             editScope grant; everyone else sees a read-only view, and the
             editor (and Save button) never render for them. -->
        <div v-show="activeTab === 'overview'" class="space-y-5">
          <UCard>
            <template #header>
              <h3 class="font-semibold">
                Vision
              </h3>
              <p class="text-xs text-muted mt-1">
                What this project is — and what it is not.
              </p>
            </template>
            <UTextarea
              v-if="canEditScope"
              v-model="visionDraft"
              :rows="10"
              autoresize
              class="w-full text-sm"
              :ui="{ base: 'w-full' }"
              placeholder="Describe the project's purpose and boundaries…"
            />
            <p v-else-if="project.visionMd" class="whitespace-pre-wrap text-sm text-zinc-300">
              {{ project.visionMd }}
            </p>
            <p v-else class="text-sm text-muted italic">
              No vision captured yet.
            </p>
          </UCard>

          <UCard>
            <template #header>
              <h3 class="font-semibold">
                Affected repos
              </h3>
              <p class="text-xs text-muted mt-1">
                One repository URL per line — GitHub, GitLab, Forgejo or self-hosted.
              </p>
            </template>
            <UTextarea
              v-if="canEditScope"
              v-model="reposDraft"
              :rows="5"
              autoresize
              class="w-full font-mono text-sm"
              :ui="{ base: 'w-full' }"
              placeholder="https://github.com/owner/repo&#10;https://gitlab.com/group/project"
            />
            <ul v-else-if="project.repos.length" class="space-y-1">
              <li v-for="r in project.repos" :key="r">
                <a
                  :href="r"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-mono text-sm text-primary-400 hover:underline break-all"
                >{{ r }}</a>
              </li>
            </ul>
            <p v-else class="text-sm text-muted italic">
              No repos linked yet.
            </p>
          </UCard>

          <UAlert v-if="scopeError" color="error" :title="scopeError" />

          <div v-if="canEditScope && scopeDirty" class="sticky bottom-4 flex justify-end z-10">
            <UButton color="primary" size="lg" :loading="scopeSaving" icon="i-lucide-save" @click="saveScope">
              Save changes
            </UButton>
          </div>
        </div>

        <!-- Members: admins can invite + toggle capabilities; everyone else
             sees the roster read-only (no invite button, no switches). -->
        <div v-show="activeTab === 'members'">
          <MembersSection
            :project-id="project.id"
            :project-name="project.name"
            :members="members"
            :is-admin="isAdmin"
            @changed="loadAll"
          />
        </div>
      </template>
    </main>
  </div>
</template>
