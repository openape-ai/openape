<script setup lang="ts">
import { ref } from 'vue'
import { conversationComments, pullStateLook } from '~/utils/git-ui'
import { formatDate, shortSha } from '~/utils/repo-browse'

interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
  oldLine: number | null
  newLine: number | null
}

interface DiffFile {
  path: string
  oldPath: string | null
  binary: boolean
  additions: number
  deletions: number
  lines: DiffLine[]
}

interface Comment {
  id: string
  authorEmail: string
  body: string
  bodyHtml: string
  path: string | null
  line: number | null
  createdAt: number
}

interface PullDetail {
  pull: {
    number: number
    title: string
    body: string | null
    bodyHtml: string
    sourceRef: string
    targetRef: string
    state: string
    authorEmail: string
    mergeSha: string | null
    createdAt: number
    mergedAt: number | null
  }
  sourceSha: string | null
  targetSha: string | null
  commits: { sha: string, author: string, subject: string, date: number }[]
  files: DiffFile[]
  truncated: boolean
  mergeable: boolean
  conflicts: string[]
  canMerge: boolean
  comments: Comment[]
}

const route = useRoute()
const owner = route.params.owner as string
const name = route.params.name as string
const number = route.params.number as string

const detail = ref<PullDetail | null>(null)
const error = ref('')
const merging = ref(false)

const commentBody = ref('')
const commentAnchor = ref<{ path: string, line: number } | null>(null)
const commenting = ref(false)

// Anchored comments live in the diff — except once the PR is merged and
// there is no diff left to hang them on; then they belong to the record here.
const conversation = computed(() =>
  conversationComments(detail.value?.comments ?? [], (detail.value?.files.length ?? 0) > 0))

onMounted(async () => {
  await load()
})

async function load() {
  try {
    detail.value = await $fetch<PullDetail>(`/api/repos/${owner}/${name}/pulls/${number}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    error.value = e.data?.statusMessage ?? 'Failed to load the pull request.'
  }
}

function anchorComment(path: string, line: number) {
  commentAnchor.value = { path, line }
  document.getElementById('comment-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function onComment() {
  if (commenting.value || !commentBody.value.trim()) return
  commenting.value = true
  error.value = ''
  try {
    await $fetch(`/api/repos/${owner}/${name}/pulls/${number}/comments`, {
      method: 'POST',
      body: { body: commentBody.value, ...(commentAnchor.value ?? {}) },
    })
    commentBody.value = ''
    commentAnchor.value = null
    await load()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Could not post the comment.'
  }
  finally {
    commenting.value = false
  }
}

async function onMerge() {
  if (merging.value) return
  merging.value = true
  error.value = ''
  try {
    await $fetch(`/api/repos/${owner}/${name}/pulls/${number}/merge`, { method: 'POST' })
    await load()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Merge failed.'
  }
  finally {
    merging.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader :owner="owner" :name="name" tab="pulls" />

    <main class="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <UAlert v-if="error" color="error" :title="error" />

      <template v-if="detail">
        <header class="space-y-2">
          <h1 class="text-lg font-semibold">
            {{ detail.pull.title }} <span class="text-zinc-500 font-normal">#{{ detail.pull.number }}</span>
          </h1>
          <div class="flex items-center gap-2 flex-wrap text-sm text-zinc-400">
            <UBadge :color="detail.pull.state === 'merged' ? 'primary' : 'success'" variant="subtle">
              <UIcon :name="pullStateLook(detail.pull.state).icon" class="size-3.5" />
              {{ detail.pull.state }}
            </UBadge>
            <span>{{ detail.pull.authorEmail }} {{ detail.pull.state === 'merged' ? 'merged' : 'wants to merge' }}</span>
            <code class="font-mono text-amber-500">{{ detail.pull.sourceRef }}</code>
            <UIcon name="i-lucide-arrow-right" class="size-4" />
            <code class="font-mono text-amber-500">{{ detail.pull.targetRef }}</code>
            <span v-if="detail.pull.state === 'open'" class="text-zinc-600">· {{ detail.commits.length }} commits</span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized server-side by renderMarkdown -->
          <div v-if="detail.pull.bodyHtml" class="markdown-body text-sm mt-3" v-html="detail.pull.bodyHtml" />
        </header>

        <section v-if="detail.pull.state === 'merged'" class="border border-violet-900/60 bg-violet-950/20 rounded-lg px-4 py-3 text-sm">
          Merged as
          <NuxtLink :to="`/${owner}/${name}/commits`" class="font-mono text-amber-500">
            {{ shortSha(detail.pull.mergeSha ?? '') }}
          </NuxtLink>
          <span v-if="detail.pull.mergedAt" class="text-zinc-500"> · {{ formatDate(detail.pull.mergedAt) }}</span>
        </section>

        <section v-else class="border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
          <template v-if="detail.mergeable">
            <UIcon name="i-lucide-check-circle-2" class="size-4 text-emerald-500" />
            <span class="text-sm">This branch merges cleanly.</span>
          </template>
          <template v-else>
            <UIcon name="i-lucide-x-circle" class="size-4 text-red-500" />
            <span class="text-sm">
              Conflicts<template v-if="detail.conflicts.length"> in
                <code class="font-mono">{{ detail.conflicts.join(', ') }}</code></template>.
            </span>
          </template>
          <UButton
            v-if="detail.canMerge"
            class="ml-auto"
            size="sm"
            icon="i-lucide-git-merge"
            :color="detail.mergeable ? 'primary' : 'neutral'"
            :disabled="!detail.mergeable"
            :loading="merging"
            @click="onMerge"
          >
            Merge pull request
          </UButton>
        </section>

        <ul class="border border-zinc-800 rounded-lg divide-y divide-zinc-800/70">
          <li v-for="commit in detail.commits" :key="commit.sha" class="px-4 py-2 flex items-center gap-3 text-sm">
            <span class="truncate">{{ commit.subject }}</span>
            <code class="font-mono text-xs text-amber-500 ml-auto shrink-0">{{ shortSha(commit.sha) }}</code>
          </li>
        </ul>

        <UAlert
          v-if="detail.truncated"
          color="warning"
          title="Diff truncated"
          description="This pull request is larger than the diff view renders; review it locally."
        />

        <PullDiff :files="detail.files" :comments="detail.comments" @comment="anchorComment" />

        <section class="space-y-3">
          <h2 class="text-sm font-medium text-zinc-400">
            Conversation
          </h2>
          <article
            v-for="comment in conversation"
            :key="comment.id"
            class="border border-zinc-800 rounded-lg px-4 py-3"
          >
            <p class="text-xs text-zinc-500">
              {{ comment.authorEmail }} · {{ formatDate(comment.createdAt) }}
              <code v-if="comment.path" class="font-mono text-zinc-600">· {{ comment.path }}:{{ comment.line }}</code>
            </p>
            <!-- eslint-disable-next-line vue/no-v-html -- sanitized server-side by renderMarkdown -->
            <div class="markdown-body text-sm mt-1" v-html="comment.bodyHtml" />
          </article>

          <!-- flex-col, not space-y: Nuxt UI's input and button both render
               inline, so they shared a line and the spacing never applied. -->
          <form id="comment-form" class="flex flex-col gap-2" @submit.prevent="onComment">
            <p v-if="commentAnchor" class="text-xs text-zinc-400 flex flex-wrap items-center gap-2">
              <UIcon name="i-lucide-message-square-quote" class="size-3.5 shrink-0" />
              <!-- A file path has no break opportunities, so as a flex item it
                   refuses to shrink and pushes `clear` off a phone screen. -->
              Commenting on <code class="font-mono break-all min-w-0">{{ commentAnchor.path }}:{{ commentAnchor.line }}</code>
              <UButton variant="ghost" size="xs" @click="commentAnchor = null">
                clear
              </UButton>
            </p>
            <UTextarea v-model="commentBody" class="w-full" placeholder="Leave a review comment" :rows="3" size="sm" />
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs text-zinc-500">
                Markdown supported
              </p>
              <UButton type="submit" size="sm" :loading="commenting" :disabled="!commentBody.trim()">
                Comment
              </UButton>
            </div>
          </form>
        </section>
      </template>
    </main>
  </div>
</template>
