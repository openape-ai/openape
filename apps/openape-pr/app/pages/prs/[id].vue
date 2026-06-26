<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import * as Diff2Html from 'diff2html'
import { useOpenApeAuth } from '#imports'
import 'diff2html/bundles/css/diff2html.min.css'

interface InlineComment {
  path: string
  line: number
  side: 'old' | 'new'
  /** Raw markdown for new comments; rendered HTML for existing ones. */
  body: string
  imagePath?: string | null
  imageUrl?: string | null
}

interface PrDetail {
  id: string
  slug: string
  title: string
  description_html: string
  author: string | null
  author_act: 'human' | 'agent'
  branch: string | null
  base_sha: string | null
  head_sha: string | null
  diff: string
  status: 'pending' | 'reviewed'
  files: number
  additions: number
  deletions: number
  review: null | {
    verdict: 'approve' | 'request-changes' | 'comment'
    body_html: string
    reviewed_by: string
    reviewed_at: number
    comments: Array<{ path: string, line: number, side: 'old' | 'new', body_html: string, image_url: string | null }>
  }
}

const route = useRoute()
const id = route.params.id as string
const { user, fetchUser } = useOpenApeAuth()

const { data: pr } = await useFetch<PrDetail>(`/api/prs/${id}`, { server: false })

onMounted(async () => {
  await fetchUser()
  if (!user.value) await navigateTo('/')
})

// ── Diff rendering ──────────────────────────────────────────────────────────
const format = ref<'line-by-line' | 'side-by-side'>(
  typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'side-by-side' : 'line-by-line',
)
const diffEl = ref<HTMLElement | null>(null)
const diffHtml = computed(() =>
  pr.value
    ? Diff2Html.html(pr.value.diff, {
        outputFormat: format.value,
        drawFileList: true,
        matching: 'lines',
        colorScheme: 'dark' as never,
      })
    : '',
)

// ── Review state ────────────────────────────────────────────────────────────
const reviewingAgain = ref(false)
const editing = computed(() => pr.value?.status === 'pending' || reviewingAgain.value)
const newComments = ref<InlineComment[]>([])
const verdict = ref<'approve' | 'request-changes' | 'comment' | null>(null)
const reviewBody = ref('')
const submitting = ref(false)
const toast = useToast()

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function fileNameOf(wrapper: Element): string {
  return wrapper.querySelector('.d2h-file-name')?.textContent?.trim() ?? ''
}

/** Stamp path/old-line/new-line on every code row so we can anchor comments. */
function decorate(): void {
  const root = diffEl.value
  if (!root) return
  for (const wrapper of root.querySelectorAll('.d2h-file-wrapper')) {
    const path = fileNameOf(wrapper)
    for (const tr of wrapper.querySelectorAll('tr')) {
      if (tr.classList.contains('d2h-comment-row')) continue
      const nums = tr.querySelectorAll('.line-num1, .line-num2, .d2h-code-side-linenumber')
      // line-by-line: [line-num1 (old), line-num2 (new)]
      const oldNum = tr.querySelector('.line-num1')?.textContent?.trim()
      const newNum = tr.querySelector('.line-num2')?.textContent?.trim()
      const el = tr as HTMLElement
      el.dataset.path = path
      if (oldNum) el.dataset.oldLine = oldNum
      if (newNum) el.dataset.newLine = newNum
      if ((oldNum || newNum) && nums.length && editing.value) el.classList.add('d2h-clickable')
    }
  }
}

function buildCommentRow(c: InlineComment, editable: boolean): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.className = 'd2h-comment-row'
  const td = document.createElement('td')
  td.colSpan = 99
  const bodyHtml = editable ? `<div class="d2h-comment-text">${escapeHtml(c.body).replaceAll('\n', '<br>')}</div>` : `<div class="d2h-comment-text">${c.body}</div>`
  const img = c.imageUrl ? `<img src="${c.imageUrl}" class="d2h-comment-img" alt="attachment">` : ''
  const del = editable ? '<button class="d2h-comment-del" type="button">remove</button>' : ''
  td.innerHTML = `<div class="d2h-comment"><div class="d2h-comment-head">💬 <span>${escapeHtml(user.value?.sub ?? 'you')}</span> · ${escapeHtml(c.path)}:${c.line}${del}</div>${bodyHtml}${img}</div>`
  if (editable) {
    td.querySelector('.d2h-comment-del')?.addEventListener('click', () => {
      newComments.value = newComments.value.filter(x => x !== c)
      renderThreads()
    })
  }
  tr.appendChild(td)
  return tr
}

function findRow(path: string, side: 'old' | 'new', line: number): HTMLElement | null {
  const root = diffEl.value
  if (!root) return null
  for (const tr of root.querySelectorAll<HTMLElement>('tr')) {
    if (tr.dataset.path !== path) continue
    const num = side === 'new' ? tr.dataset.newLine : tr.dataset.oldLine
    if (num && Number(num) === line) return tr
  }
  return null
}

/** Remove injected rows, then re-inject the current comment set inline. */
function renderThreads(): void {
  const root = diffEl.value
  if (!root) return
  root.querySelectorAll('.d2h-comment-row').forEach(r => r.remove())
  const list: InlineComment[] = editing.value
    ? newComments.value
    : (pr.value?.review?.comments.map(c => ({ path: c.path, line: c.line, side: c.side, body: c.body_html, imageUrl: c.image_url })) ?? [])
  for (const c of list) {
    const row = findRow(c.path, c.side, c.line)
    if (row) row.after(buildCommentRow(c, editing.value))
  }
}

// ── Click a line to add a comment ───────────────────────────────────────────
const composer = ref<{ path: string, line: number, side: 'old' | 'new' } | null>(null)
const composerBody = ref('')
const composerImage = ref<File | null>(null)

function onDiffClick(ev: MouseEvent): void {
  if (!editing.value) return
  const tr = (ev.target as HTMLElement).closest('tr') as HTMLElement | null
  if (!tr || tr.classList.contains('d2h-comment-row') || !tr.dataset.path) return
  const side: 'old' | 'new' = tr.dataset.newLine ? 'new' : 'old'
  const line = Number(tr.dataset.newLine ?? tr.dataset.oldLine)
  if (!line) return
  composer.value = { path: tr.dataset.path, line, side }
  composerBody.value = ''
  composerImage.value = null
}

async function saveComment(): Promise<void> {
  if (!composer.value || !composerBody.value.trim() || !pr.value) return
  let imagePath: string | undefined
  if (composerImage.value) {
    const ext = composerImage.value.name.split('.').pop()?.toLowerCase() || 'png'
    imagePath = `comments/${crypto.randomUUID()}.${ext}`
    await $fetch(`/api/prs/${pr.value.id}/assets/${imagePath}`, {
      method: 'PUT',
      body: composerImage.value,
      headers: { 'content-type': composerImage.value.type || 'image/png' },
    })
  }
  newComments.value.push({
    path: composer.value.path,
    line: composer.value.line,
    side: composer.value.side,
    body: composerBody.value.trim(),
    imagePath,
    imageUrl: imagePath ? `/api/prs/${pr.value.id}/assets/${imagePath}` : null,
  })
  composer.value = null
  renderThreads()
}

function onPickImage(ev: Event): void {
  composerImage.value = (ev.target as HTMLInputElement).files?.[0] ?? null
}

// ── Submit review ───────────────────────────────────────────────────────────
async function submitReview(): Promise<void> {
  if (!verdict.value || !pr.value || submitting.value) return
  submitting.value = true
  try {
    await $fetch(`/api/prs/${pr.value.id}/review`, {
      method: 'POST',
      body: {
        verdict: verdict.value,
        body: reviewBody.value.trim() || undefined,
        comments: newComments.value.map(c => ({ path: c.path, line: c.line, side: c.side, body: c.body, imagePath: c.imagePath ?? undefined })),
      },
    })
    toast.add({ title: 'Review submitted', description: verdict.value, color: 'success' })
    await navigateTo('/prs')
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string } }
    toast.add({ title: 'Submit failed', description: e.data?.detail ?? 'Error', color: 'error' })
  }
  finally {
    submitting.value = false
  }
}

function startReviewAgain(): void {
  reviewingAgain.value = true
  newComments.value = []
  verdict.value = null
  reviewBody.value = ''
  void nextTick(() => { decorate(); renderThreads() })
}

watch([diffHtml], () => void nextTick(() => { decorate(); renderThreads() }))
onMounted(() => void nextTick(() => { decorate(); renderThreads() }))

const VERDICT_LABEL = {
  'approve': 'Approve',
  'request-changes': 'Request changes',
  'comment': 'Comment',
} as const
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 pb-28">
    <header class="border-b border-zinc-800/80 sticky top-0 bg-zinc-950/95 backdrop-blur z-20">
      <div class="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <NuxtLink to="/prs" class="text-zinc-400 hover:text-zinc-100">
          <UIcon name="i-lucide-arrow-left" />
        </NuxtLink>
        <span class="font-semibold tracking-tight">🔍 OpenApe <span class="text-primary-500">PR</span></span>
      </div>
    </header>

    <main v-if="pr" class="max-w-5xl mx-auto px-4 py-6">
      <div class="flex items-start gap-3 flex-wrap">
        <UBadge :color="pr.status === 'reviewed' ? 'success' : 'warning'" variant="subtle" class="uppercase mt-1">
          {{ pr.status }}
        </UBadge>
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold leading-tight">
            {{ pr.title }}
          </h1>
          <p class="text-xs text-zinc-500 mt-1 flex items-center gap-1.5 flex-wrap">
            <span v-if="pr.branch" class="font-mono">{{ pr.branch }}</span>
            <span>· {{ pr.files }} files</span>
            <span class="text-emerald-500">+{{ pr.additions }}</span>
            <span class="text-rose-500">−{{ pr.deletions }}</span>
            <span v-if="pr.author">· {{ pr.author }}</span>
            <span v-if="pr.author_act === 'agent'">· 🤖 agent</span>
          </p>
        </div>
      </div>

      <div
        v-if="pr.description_html"
        class="prose-pr mt-5 rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 px-4 py-3 text-sm"
        v-html="pr.description_html"
      />

      <div
        v-if="pr.status === 'reviewed' && !reviewingAgain"
        class="mt-5 rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 px-4 py-3"
      >
        <div class="flex items-center gap-2 text-sm">
          <UBadge :color="pr.review?.verdict === 'approve' ? 'success' : pr.review?.verdict === 'request-changes' ? 'warning' : 'neutral'" variant="subtle">
            {{ pr.review?.verdict }}
          </UBadge>
          <span class="text-zinc-400">by {{ pr.review?.reviewed_by }}</span>
          <UButton size="xs" variant="ghost" color="neutral" class="ml-auto" @click="startReviewAgain">
            Review again
          </UButton>
        </div>
        <div v-if="pr.review?.body_html" class="prose-pr text-sm mt-2" v-html="pr.review.body_html" />
      </div>

      <div class="flex items-center gap-2 mt-6 mb-2">
        <div class="inline-flex rounded-lg ring-1 ring-zinc-700 overflow-hidden text-xs">
          <button
            class="px-3 py-1.5"
            :class="format === 'line-by-line' ? 'bg-primary-600 text-white' : 'text-zinc-400'"
            @click="format = 'line-by-line'"
          >
            Unified
          </button>
          <button
            class="px-3 py-1.5"
            :class="format === 'side-by-side' ? 'bg-primary-600 text-white' : 'text-zinc-400'"
            @click="format = 'side-by-side'"
          >
            Split
          </button>
        </div>
        <span v-if="editing" class="text-xs text-zinc-500">Click a line to comment</span>
      </div>

      <div ref="diffEl" class="d2h-wrap" @click="onDiffClick" v-html="diffHtml" />
    </main>

    <!-- Inline comment composer -->
    <div v-if="composer" class="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/50 p-4" @click.self="composer = null">
      <div class="w-full max-w-lg rounded-xl bg-zinc-900 ring-1 ring-zinc-700 p-4">
        <p class="text-xs text-zinc-500 mb-2">
          Comment on <span class="font-mono text-zinc-300">{{ composer.path }}:{{ composer.line }}</span>
        </p>
        <UTextarea v-model="composerBody" :rows="3" autofocus placeholder="Your comment (markdown)…" class="w-full" />
        <div class="flex items-center gap-2 mt-3">
          <label class="text-xs text-zinc-400 cursor-pointer flex items-center gap-1">
            <UIcon name="i-lucide-image" />
            <input type="file" accept="image/*" class="hidden" @change="onPickImage">
            {{ composerImage ? composerImage.name : 'Attach image' }}
          </label>
          <div class="ml-auto flex gap-2">
            <UButton size="sm" variant="ghost" color="neutral" @click="composer = null">
              Cancel
            </UButton>
            <UButton size="sm" color="primary" :disabled="!composerBody.trim()" @click="saveComment">
              Add comment
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Verdict bar -->
    <div v-if="pr && editing" class="fixed bottom-0 inset-x-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div class="max-w-5xl mx-auto px-4 py-3">
        <div v-if="newComments.length" class="text-xs text-zinc-500 mb-2">
          {{ newComments.length }} inline comment{{ newComments.length === 1 ? '' : 's' }}
        </div>
        <div class="flex items-center gap-2">
          <UButton
            v-for="v in (['approve', 'request-changes', 'comment'] as const)"
            :key="v"
            size="sm"
            :variant="verdict === v ? 'solid' : 'outline'"
            :color="v === 'approve' ? 'success' : v === 'request-changes' ? 'warning' : 'neutral'"
            @click="verdict = v"
          >
            {{ VERDICT_LABEL[v] }}
          </UButton>
          <UButton
            class="ml-auto"
            size="sm"
            color="primary"
            :loading="submitting"
            :disabled="!verdict"
            @click="submitReview"
          >
            Submit review
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.d2h-wrap { font-size: 13px; }
.d2h-clickable { cursor: pointer; }
.d2h-clickable:hover .d2h-code-line, .d2h-clickable:hover .d2h-code-side-line { background: rgba(59, 130, 246, 0.12); }
.d2h-comment-row td { padding: 0 !important; background: #18181b; }
.d2h-comment { border-left: 3px solid #3b82f6; margin: 4px 8px; padding: 8px 12px; background: #1f2937; border-radius: 6px; }
.d2h-comment-head { font-size: 12px; color: #a1a1aa; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.d2h-comment-text { font-size: 13px; color: #e4e4e7; white-space: normal; }
.d2h-comment-img { max-width: 320px; max-height: 220px; margin-top: 8px; border-radius: 6px; border: 1px solid #3f3f46; }
.d2h-comment-del { margin-left: auto; font-size: 11px; color: #f87171; background: none; border: none; cursor: pointer; }
.prose-pr :where(a) { color: #60a5fa; text-decoration: underline; }
.prose-pr :where(code) { background: #27272a; padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
.prose-pr :where(p) { margin: 0.4em 0; }
.prose-pr :where(ul) { list-style: disc; padding-left: 1.2em; margin: 0.4em 0; }
.prose-pr :where(img) { max-width: 100%; border-radius: 6px; margin: 0.5em 0; }
</style>
