<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'
import { STORY_STATUSES, statusColor, statusLabel } from '../../../../utils/storyStatus'
import type { MemberRow } from '../../../../components/MembersSection.vue'

const route = useRoute()
const projectId = computed(() => String(route.params.id))

const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface StoryRow {
  id: string
  projectId: string
  title: string
  storySentence: string
  status: string
  createdAt: number
  updatedAt: number
}

interface ProjectRow { id: string, name: string }

const project = ref<ProjectRow | null>(null)
const stories = ref<StoryRow[]>([])
const members = ref<MemberRow[]>([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)

useSeoMeta({ title: () => project.value ? `Stories — ${project.value.name}` : 'Stories — OpenApe Coder' })

// Permission to add a story: admins implicitly, members only with the
// writeStories grant. Drives the "New story" button's visibility.
const myEmail = computed(() => (user.value?.sub ?? '').toLowerCase())
const myMembership = computed(() => members.value.find(m => m.email === myEmail.value) ?? null)
const canWriteStories = computed(() =>
  myMembership.value?.role === 'admin' || (myMembership.value?.capabilities.includes('writeStories') ?? false),
)

// Filter by status. "all" keeps every story; otherwise only the chosen status.
// Whatever the filter, the groups below together still cover the full set.
const filter = ref<'all' | string>('all')
const filterItems = computed(() => [
  { value: 'all', label: `All (${stories.value.length})` },
  ...STORY_STATUSES
    .filter(s => stories.value.some(st => st.status === s))
    .map(s => ({ value: s, label: `${statusLabel(s)} (${stories.value.filter(st => st.status === s).length})` })),
])

const visibleStories = computed(() =>
  filter.value === 'all' ? stories.value : stories.value.filter(s => s.status === filter.value),
)

// Group the visible stories by status, in lifecycle order — every group
// together is exactly the visible set (no story lost, none duplicated).
const groups = computed(() =>
  STORY_STATUSES
    .map(status => ({ status, stories: visibleStories.value.filter(s => s.status === status) }))
    .filter(g => g.stories.length > 0),
)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [p, s, m] = await Promise.all([
      ($fetch as any)(`/api/projects/${projectId.value}`),
      ($fetch as any)(`/api/projects/${projectId.value}/stories`),
      ($fetch as any)(`/api/projects/${projectId.value}/members`),
    ])
    project.value = p
    stories.value = s
    members.value = m
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    // 404 covers both "missing" and "not a member" — no existence leak.
    error.value = err?.data?.statusMessage || err?.message || 'Could not load the stories.'
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => { if (u) loadAll(); else navigateTo('/login') }, { immediate: true })

async function onCreated(payload: { id: string }) {
  await navigateTo(`/projects/${projectId.value}/stories/${payload.id}`)
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-3 sm:px-6 py-3 flex items-center gap-2 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
      <UButton :to="`/projects/${projectId}`" variant="ghost" size="sm" icon="i-lucide-arrow-left" :ui="{ base: 'shrink-0' }">
        <span class="hidden sm:inline">Project</span>
      </UButton>
      <span v-if="project" class="font-semibold truncate flex-1">
        🛠️ {{ project.name }}
      </span>
      <UButton variant="ghost" size="sm" icon="i-lucide-log-out" :ui="{ base: 'shrink-0' }" @click="logout">
        <span class="hidden md:inline">Log out</span>
      </UButton>
    </header>

    <NewStoryDialog v-if="canWriteStories" v-model:open="showCreate" :project-id="projectId" @created="onCreated" />

    <main class="px-4 sm:px-6 py-4 sm:py-6 max-w-4xl mx-auto space-y-5">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-2xl font-bold">
            Story board
          </h2>
          <p class="text-muted text-sm">
            Every story of this project, at a glance.
          </p>
        </div>
        <!-- New story is only offered with the writeStories grant; a member
             without it never sees this button (coder-user-stories §5). -->
        <UButton
          v-if="canWriteStories"
          color="primary"
          size="sm"
          icon="i-lucide-plus"
          :ui="{ base: 'shrink-0' }"
          @click="showCreate = true"
        >
          <span class="hidden sm:inline">New story</span>
        </UButton>
      </div>

      <UAlert v-if="error" color="error" :title="error" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          Loading…
        </p>
      </UCard>

      <UCard v-else-if="stories.length === 0">
        <div class="text-center py-12 space-y-4">
          <div class="text-5xl">
            📝
          </div>
          <h3 class="text-lg font-medium">
            No stories yet
          </h3>
          <p class="text-muted text-sm max-w-md mx-auto">
            User stories capture what the project should do — title, the
            "As … I want … so that …" sentence, and acceptance criteria.
          </p>
          <UButton v-if="canWriteStories" color="primary" icon="i-lucide-plus" @click="showCreate = true">
            Add the first story
          </UButton>
        </div>
      </UCard>

      <template v-else>
        <USelectMenu
          v-model="filter"
          :items="filterItems"
          value-key="value"
          class="w-full sm:w-64"
          icon="i-lucide-filter"
        />

        <div v-for="group in groups" :key="group.status" class="space-y-2">
          <div class="flex items-center gap-2">
            <UBadge :color="statusColor(group.status)" variant="subtle" size="sm">
              {{ statusLabel(group.status) }}
            </UBadge>
            <span class="text-xs text-muted">{{ group.stories.length }}</span>
          </div>
          <ul class="space-y-2">
            <li v-for="s in group.stories" :key="s.id">
              <NuxtLink
                :to="`/projects/${projectId}/stories/${s.id}`"
                class="block rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3 active:bg-zinc-900 transition-colors"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <h3 class="font-semibold truncate">
                      {{ s.title }}
                    </h3>
                    <p v-if="s.storySentence" class="text-xs text-muted mt-1 line-clamp-2">
                      {{ s.storySentence }}
                    </p>
                  </div>
                  <UIcon name="i-lucide-chevron-right" class="text-muted shrink-0 size-5 mt-0.5" />
                </div>
              </NuxtLink>
            </li>
          </ul>
        </div>
      </template>
    </main>
  </div>
</template>
