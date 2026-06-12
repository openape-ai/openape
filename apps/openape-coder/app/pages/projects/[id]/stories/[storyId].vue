<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'
import { STORY_STATUSES, statusColor, statusLabel } from '../../../../utils/storyStatus'
import type { MemberRow } from '../../../../components/MembersSection.vue'

const route = useRoute()
const projectId = computed(() => String(route.params.id))
const storyId = computed(() => String(route.params.storyId))

const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface Story {
  id: string
  projectId: string
  title: string
  storySentence: string
  acceptanceCriteria: string
  repos: string[]
  links: string[]
  testReferences: string[]
  status: string
  createdAt: number
  updatedAt: number
}

const story = ref<Story | null>(null)
const members = ref<MemberRow[]>([])
const loading = ref(true)
const error = ref('')
const editing = ref(false)

useSeoMeta({ title: () => story.value ? `${story.value.title} — OpenApe Coder` : 'OpenApe Coder' })

// Permission to edit/status-change: admins implicitly, members only with the
// writeStories grant. Everyone else sees the story read-only.
const myEmail = computed(() => (user.value?.sub ?? '').toLowerCase())
const myMembership = computed(() => members.value.find(m => m.email === myEmail.value) ?? null)
const canWriteStories = computed(() =>
  myMembership.value?.role === 'admin' || (myMembership.value?.capabilities.includes('writeStories') ?? false),
)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [s, m] = await Promise.all([
      ($fetch as any)(`/api/projects/${projectId.value}/stories/${storyId.value}`),
      ($fetch as any)(`/api/projects/${projectId.value}/members`),
    ])
    story.value = s
    members.value = m
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    // 404 covers both "missing" and "not a member" — no existence leak.
    error.value = err?.data?.statusMessage || err?.message || 'Could not load this story.'
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => { if (u) loadAll(); else navigateTo('/login') }, { immediate: true })

// Editable drafts. Lists are edited as one-per-line text and split on save.
const titleDraft = ref('')
const sentenceDraft = ref('')
const criteriaDraft = ref('')
const reposDraft = ref('')
const linksDraft = ref('')
const testRefsDraft = ref('')
const saving = ref(false)
const saveError = ref('')

function resetDrafts() {
  const s = story.value
  if (!s) return
  titleDraft.value = s.title
  sentenceDraft.value = s.storySentence
  criteriaDraft.value = s.acceptanceCriteria
  reposDraft.value = s.repos.join('\n')
  linksDraft.value = s.links.join('\n')
  testRefsDraft.value = s.testReferences.join('\n')
}

watch(story, resetDrafts)

function startEdit() {
  resetDrafts()
  saveError.value = ''
  editing.value = true
}

function cancelEdit() {
  resetDrafts()
  editing.value = false
}

function lines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean)
}

async function save() {
  if (!story.value || !titleDraft.value.trim() || !sentenceDraft.value.trim()) return
  saving.value = true
  saveError.value = ''
  try {
    const updated = await ($fetch as any)(`/api/projects/${projectId.value}/stories/${storyId.value}`, {
      method: 'PATCH',
      body: {
        title: titleDraft.value.trim(),
        storySentence: sentenceDraft.value.trim(),
        acceptanceCriteria: criteriaDraft.value,
        repos: lines(reposDraft.value),
        links: lines(linksDraft.value),
        testReferences: lines(testRefsDraft.value),
      },
    })
    story.value = updated
    editing.value = false
  }
  catch (err: any) {
    saveError.value = err?.data?.statusMessage || err?.message || 'Could not save the story.'
  }
  finally {
    saving.value = false
  }
}

// Status change uses the dedicated endpoint, which records who changed it when.
const statusSaving = ref(false)
async function changeStatus(next: string) {
  if (!story.value || next === story.value.status) return
  statusSaving.value = true
  saveError.value = ''
  try {
    const updated = await ($fetch as any)(`/api/projects/${projectId.value}/stories/${storyId.value}/status`, {
      method: 'PATCH',
      body: { status: next },
    })
    story.value = updated
  }
  catch (err: any) {
    saveError.value = err?.data?.statusMessage || err?.message || 'Could not change the status.'
  }
  finally {
    statusSaving.value = false
  }
}

const statusItems = STORY_STATUSES.map(s => ({ value: s, label: statusLabel(s) }))
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-3 sm:px-6 py-3 flex items-center gap-2 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
      <UButton :to="`/projects/${projectId}/stories`" variant="ghost" size="sm" icon="i-lucide-arrow-left" :ui="{ base: 'shrink-0' }">
        <span class="hidden sm:inline">Story board</span>
      </UButton>
      <span class="font-semibold truncate flex-1">
        📝 Story
      </span>
      <UButton variant="ghost" size="sm" icon="i-lucide-log-out" :ui="{ base: 'shrink-0' }" @click="logout">
        <span class="hidden md:inline">Log out</span>
      </UButton>
    </header>

    <main class="px-4 sm:px-6 py-4 sm:py-6 max-w-3xl mx-auto space-y-5">
      <UAlert v-if="error" color="error" :title="error" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          Loading…
        </p>
      </UCard>

      <template v-else-if="story">
        <!-- Read-only view -->
        <template v-if="!editing">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h1 class="text-2xl font-bold">
                {{ story.title }}
              </h1>
              <div class="mt-2">
                <UBadge :color="statusColor(story.status)" variant="subtle">
                  {{ statusLabel(story.status) }}
                </UBadge>
              </div>
            </div>
            <!-- Edit only with the writeStories grant; others never see it
                 (coder-user-stories §5). -->
            <UButton
              v-if="canWriteStories"
              color="primary"
              variant="soft"
              size="sm"
              icon="i-lucide-pencil"
              :ui="{ base: 'shrink-0' }"
              @click="startEdit"
            >
              <span class="hidden sm:inline">Edit</span>
            </UButton>
          </div>

          <UCard>
            <template #header>
              <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">
                Story
              </h2>
            </template>
            <p class="whitespace-pre-wrap text-zinc-200">
              {{ story.storySentence }}
            </p>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">
                Acceptance criteria
              </h2>
            </template>
            <p v-if="story.acceptanceCriteria" class="whitespace-pre-wrap text-sm text-zinc-300">
              {{ story.acceptanceCriteria }}
            </p>
            <p v-else class="text-sm text-muted italic">
              No acceptance criteria captured yet.
            </p>
          </UCard>

          <div class="grid gap-4 sm:grid-cols-3">
            <UCard>
              <template #header>
                <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">
                  Repos
                </h2>
              </template>
              <ul v-if="story.repos.length" class="space-y-1">
                <li v-for="r in story.repos" :key="r">
                  <a :href="r" target="_blank" rel="noopener noreferrer" class="font-mono text-xs text-primary-400 hover:underline break-all">
                    {{ r }}
                  </a>
                </li>
              </ul>
              <p v-else class="text-xs text-muted italic">
                None
              </p>
            </UCard>

            <UCard>
              <template #header>
                <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">
                  Links
                </h2>
              </template>
              <ul v-if="story.links.length" class="space-y-1">
                <li v-for="l in story.links" :key="l">
                  <a :href="l" target="_blank" rel="noopener" class="text-xs text-primary-400 hover:underline break-all">
                    {{ l }}
                  </a>
                </li>
              </ul>
              <p v-else class="text-xs text-muted italic">
                None
              </p>
            </UCard>

            <UCard>
              <template #header>
                <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">
                  Test references
                </h2>
              </template>
              <ul v-if="story.testReferences.length" class="space-y-1">
                <li v-for="t in story.testReferences" :key="t" class="font-mono text-xs text-zinc-300 break-all">
                  {{ t }}
                </li>
              </ul>
              <p v-else class="text-xs text-muted italic">
                None
              </p>
            </UCard>
          </div>

          <UAlert v-if="saveError" color="error" :title="saveError" />

          <!-- Status changer: writeStories only. The change is recorded with
               author + timestamp server-side (coder-user-stories §4). -->
          <UCard v-if="canWriteStories">
            <template #header>
              <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">
                Change status
              </h2>
            </template>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="item in statusItems"
                :key="item.value"
                :color="item.value === story.status ? statusColor(item.value) : 'neutral'"
                :variant="item.value === story.status ? 'subtle' : 'ghost'"
                size="sm"
                :disabled="statusSaving"
                @click="changeStatus(item.value)"
              >
                {{ item.label }}
              </UButton>
            </div>
          </UCard>
        </template>

        <!-- Editor (writeStories only — the page never enters this state for a
             read-only member because the Edit button is hidden). -->
        <template v-else>
          <h1 class="text-xl font-bold">
            Edit story
          </h1>

          <UFormField label="Title" required>
            <UInput v-model="titleDraft" size="lg" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>

          <UFormField label="Story" required description="As … I want to … so that …">
            <UTextarea v-model="sentenceDraft" :rows="3" autoresize class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>

          <UFormField label="Acceptance criteria">
            <UTextarea v-model="criteriaDraft" :rows="6" autoresize class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>

          <UFormField label="Repos" description="One repository URL per line">
            <UTextarea v-model="reposDraft" :rows="3" autoresize class="w-full font-mono text-sm" :ui="{ base: 'w-full' }" placeholder="https://github.com/owner/repo" />
          </UFormField>

          <UFormField label="Links" description="One URL per line">
            <UTextarea v-model="linksDraft" :rows="3" autoresize class="w-full font-mono text-sm" :ui="{ base: 'w-full' }" placeholder="https://…" />
          </UFormField>

          <UFormField label="Test references" description="One per line">
            <UTextarea v-model="testRefsDraft" :rows="3" autoresize class="w-full font-mono text-sm" :ui="{ base: 'w-full' }" placeholder="path/to/test.ts" />
          </UFormField>

          <UAlert v-if="saveError" color="error" :title="saveError" />

          <div class="flex justify-end gap-2 sticky bottom-4">
            <UButton variant="ghost" :disabled="saving" @click="cancelEdit">
              Cancel
            </UButton>
            <UButton
              color="primary"
              size="lg"
              icon="i-lucide-save"
              :loading="saving"
              :disabled="!titleDraft.trim() || !sentenceDraft.trim()"
              @click="save"
            >
              Save changes
            </UButton>
          </div>
        </template>
      </template>
    </main>
  </div>
</template>
