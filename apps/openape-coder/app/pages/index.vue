<script setup lang="ts">
import { ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

useSeoMeta({ title: 'Your projects — OpenApe Coder' })

const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface ProjectRow {
  id: string
  name: string
  visionMd: string
  repos: string[]
  createdAt: number
  updatedAt: number
}

interface InboxNotification {
  projectId: string
  projectName: string
  invitedBy: string
  at: number
}

const projects = ref<ProjectRow[]>([])
const inbox = ref<InboxNotification[]>([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    // The inbox surfaces "you were added to project X" notifications; it shares
    // the same auth as the project list, so one failure path covers both.
    const [projectList, inboxList] = await Promise.all([
      ($fetch as any)('/api/projects'),
      ($fetch as any)('/api/inbox'),
    ])
    projects.value = projectList
    inbox.value = inboxList
  }
  catch (err: any) {
    if (err?.statusCode === 401) {
      // Session expired — refetching the user swaps the page to the sign-in
      // state (the start page IS the sign-in, no /login hop).
      await fetchUser()
      return
    }
    error.value = err?.data?.statusMessage || err?.message || 'Could not load your projects.'
  }
  finally {
    loading.value = false
  }
}

async function dismiss(projectId: string) {
  inbox.value = inbox.value.filter(n => n.projectId !== projectId)
  await ($fetch as any)(`/api/inbox/${projectId}/seen`, { method: 'POST' })
}

watch(user, (u) => { if (u) load() }, { immediate: true })

async function onCreated(payload: { id: string }) {
  await navigateTo(`/projects/${payload.id}`)
}
</script>

<template>
  <!-- Signed out: the start page IS the sign-in (DDISA SPs put the email form
       right on the landing page — outsiders never see projects or people). -->
  <div v-if="!user" class="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100">
    <main class="flex-1 flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md space-y-4 text-center">
        <div class="text-6xl" aria-hidden="true">
          🛠️
        </div>
        <h1 class="text-3xl font-bold tracking-tight">
          OpenApe Coder
        </h1>
        <p class="text-muted text-sm">
          The cloud home for your software projects — vision, repos, members and stories in one place.
        </p>
        <OpenApeOAuthErrorAlert class="text-left w-full" />
        <UCard class="text-left">
          <OpenApeAuth
            title="Sign in to OpenApe Coder"
            subtitle="Use your OpenApe identity — your email domain and a passkey. No new account, no password."
            button-text="Continue"
            post-login-redirect="/"
          />
        </UCard>
      </div>
    </main>
  </div>

  <div v-else class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-2xl shrink-0">🛠️</span>
        <h1 class="text-xl font-semibold">
          OpenApe Coder
        </h1>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <UButton color="primary" size="sm" icon="i-lucide-plus" @click="showCreate = true">
          <span class="hidden sm:inline">New project</span>
        </UButton>
        <UButton variant="ghost" size="sm" icon="i-lucide-log-out" :ui="{ base: 'shrink-0' }" @click="logout">
          <span class="hidden sm:inline">Log out</span>
        </UButton>
      </div>
    </header>

    <CreateProjectDialog v-model:open="showCreate" @created="onCreated" />

    <main class="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <!-- Inbox: how you learn you were added to a project. No email goes out —
           this is the notification the invite stands in for. -->
      <section v-if="inbox.length" class="mb-6 space-y-2">
        <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">
          Inbox
        </h2>
        <div
          v-for="n in inbox"
          :key="n.projectId"
          class="flex items-center gap-3 rounded-lg border border-primary-500/30 bg-primary-500/5 px-4 py-3"
        >
          <UIcon name="i-lucide-inbox" class="text-primary-400 size-5 shrink-0" />
          <p class="flex-1 text-sm min-w-0">
            You were added to
            <NuxtLink :to="`/projects/${n.projectId}`" class="font-semibold text-primary-400 hover:underline">
              {{ n.projectName }}
            </NuxtLink>
            by {{ n.invitedBy }}.
          </p>
          <UButton
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            aria-label="Dismiss"
            @click="dismiss(n.projectId)"
          />
        </div>
      </section>

      <h2 class="text-2xl font-bold mb-1">
        Your projects
      </h2>
      <p class="text-muted mb-6">
        Every project you are a member of — and nothing else.
      </p>

      <UAlert v-if="error" color="error" :title="error" class="mb-4" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          Loading…
        </p>
      </UCard>

      <UCard v-else-if="projects.length === 0">
        <div class="text-center py-12 space-y-4">
          <div class="text-5xl">
            🛠️
          </div>
          <h3 class="text-lg font-medium">
            No projects yet
          </h3>
          <p class="text-muted text-sm max-w-md mx-auto">
            Create your first project to capture its vision, repos and user stories. You become its admin.
          </p>
          <UButton color="primary" icon="i-lucide-plus" @click="showCreate = true">
            Create your first project
          </UButton>
        </div>
      </UCard>

      <ul v-else class="space-y-3">
        <li v-for="p in projects" :key="p.id">
          <NuxtLink
            :to="`/projects/${p.id}`"
            class="block rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-4 active:bg-zinc-900 transition-colors"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <h3 class="text-lg font-semibold truncate">
                  {{ p.name }}
                </h3>
                <p v-if="p.visionMd" class="text-xs text-muted mt-1 line-clamp-2">
                  {{ p.visionMd }}
                </p>
              </div>
              <UIcon name="i-lucide-chevron-right" class="text-muted shrink-0 size-5 mt-1" />
            </div>
            <p v-if="p.repos.length" class="mt-3 text-xs text-muted">
              {{ p.repos.length }} repo{{ p.repos.length === 1 ? '' : 's' }}
            </p>
          </NuxtLink>
        </li>
      </ul>
    </main>
  </div>
</template>
