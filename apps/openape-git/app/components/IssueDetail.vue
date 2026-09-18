<script setup lang="ts">
import type { IssueComment, IssueLabel, IssueRecord } from '../../shared/issue-types'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { issueDate, issueError } from '../utils/issue-ui'

const props = defineProps<{ endpoint: string }>()
const issue = ref<IssueRecord | null>(null)
const comments = ref<IssueComment[]>([])
const nextComment = ref<string | null>(null)
const labels = ref<IssueLabel[]>([])
const assignees = ref<string[]>([])
const error = ref('')
const loading = ref(true)
const busy = ref(false)
const editing = ref(false)
const editTitle = ref('')
const editBody = ref('')
const commentBody = ref('')
const editComment = ref<IssueComment | null>(null)
const editCommentBody = ref('')
const assignee = ref('')
const selectedLabels = ref<string[]>([])
const labelName = ref('')
const labelColor = ref('#f59e0b')
const repo = computed(() => issue.value?.capabilities.repository)
const repoApi = computed(() => repo.value ? `/api/repos/${repo.value.owner}/${repo.value.name}` : '')
let commentKey = ''
let submittedComment = ''
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [record, page] = await Promise.all([
      $fetch<IssueRecord>(props.endpoint),
      $fetch<{ comments: IssueComment[], next: string | null }>(`${props.endpoint}/comments`),
    ])
    issue.value = record
    comments.value = page.comments
    nextComment.value = page.next
    const anchor = window.location.hash.slice(1)
    if (anchor.startsWith('comment-')) {
      while (nextComment.value && !comments.value.some(comment => `comment-${comment.id}` === anchor)) await moreComments()
      await nextTick()
      document.getElementById(anchor)?.scrollIntoView()
    }
    assignee.value = record.assignee || ''
    selectedLabels.value = record.labels.map(label => label.id)
    if (record.capabilities.triage && repoApi.value) {
      const [labelResult, assigneeResult] = await Promise.all([
        $fetch<{ labels: (IssueLabel & { archived: number })[] }>(`${repoApi.value}/labels`),
        $fetch<{ assignees: string[] }>(`${repoApi.value}/issue-assignees`),
      ])
      labels.value = labelResult.labels.filter(label => !label.archived)
      assignees.value = assigneeResult.assignees
    }
  }
  catch (err) { issue.value = null; comments.value = []; labels.value = []; assignees.value = []; error.value = issueError(err) }
  finally { loading.value = false }
}
onMounted(load)
watch(() => props.endpoint, load)
async function mutate(action: () => Promise<unknown>, reload = true) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await action(); if (reload) await load() }
  catch (err) { error.value = issueError(err) }
  finally { busy.value = false }
}
function update(values: Record<string, unknown>) {
  return $fetch(props.endpoint, { method: 'PATCH', body: { ...values, expectedVersion: issue.value?.version } })
}
function beginEdit() { editTitle.value = issue.value!.title; editBody.value = issue.value!.body; editing.value = true }
async function saveText() { await update({ title: editTitle.value, body: editBody.value }); editing.value = false }
async function postComment() {
  if (!commentBody.value.trim()) return
  if (!commentKey || submittedComment !== commentBody.value) { commentKey = crypto.randomUUID(); submittedComment = commentBody.value }
  const result = await $fetch<{ anchor: string }>(`${props.endpoint}/comments`, { method: 'POST', body: { body: commentBody.value }, headers: { 'Idempotency-Key': commentKey } })
  commentBody.value = ''
  commentKey = ''
  await navigateTo({ hash: result.anchor })
}
async function saveComment() {
  const comment = editComment.value!
  await $fetch(`${props.endpoint}/comments/${comment.id}`, { method: 'PATCH', body: { body: editCommentBody.value, expectedVersion: comment.version } })
  editComment.value = null
}
async function moreComments() {
  const page = await $fetch<{ comments: IssueComment[], next: string | null }>(`${props.endpoint}/comments`, { query: { after: nextComment.value } })
  comments.value.push(...page.comments)
  nextComment.value = page.next
}
async function addLabel() {
  await $fetch(`${repoApi.value}/labels`, { method: 'POST', body: { name: labelName.value, color: labelColor.value } })
  labelName.value = ''
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader v-if="repo" :owner="repo.owner" :name="repo.name" tab="issues" />
    <header v-else class="border-b border-zinc-800 p-4">
      <NuxtLink to="/issues" class="font-bold">
        🦍 ape-git · Issues
      </NuxtLink>
    </header>
    <main class="issue-page">
      <UAlert v-if="error" color="error" :title="error" class="mb-4" />
      <UButton v-if="error" color="neutral" variant="outline" class="mb-4" @click="load">
        Reload current version
      </UButton>
      <p v-if="loading" role="status" class="text-zinc-400">
        Loading issue…
      </p>
      <template v-if="issue">
        <header class="pb-5 mb-6 border-b border-zinc-800">
          <div class="flex flex-wrap justify-between items-start gap-3">
            <h1 class="text-2xl md:text-3xl font-semibold break-words min-w-0">
              {{ issue.title }} <span v-if="issue.number" class="text-zinc-500 font-normal">#{{ issue.number }}</span>
            </h1>
            <UButton v-if="issue.capabilities.edit && !editing" color="neutral" variant="outline" size="sm" @click="beginEdit">
              Edit issue
            </UButton>
          </div>
          <div class="flex items-center flex-wrap gap-3 mt-3 text-sm text-zinc-400">
            <UBadge :color="issue.state === 'open' ? 'success' : 'primary'" variant="subtle">
              {{ issue.state === 'open' ? 'Open' : 'Closed' }}
            </UBadge>
            <span class="break-all">{{ issue.authorSubject }} opened this issue on {{ issueDate(issue.createdAt) }}</span>
          </div>
        </header>
        <div class="issue-detail-grid">
          <section class="min-w-0 space-y-4" aria-label="Discussion">
            <form v-if="editing" class="space-y-3" @submit.prevent="mutate(saveText)">
              <label class="block text-sm">Title<UInput v-model="editTitle" aria-label="Title" class="w-full mt-2" :maxlength="200" required /></label>
              <IssueEditor v-model="editBody" />
              <div class="flex gap-2">
                <UButton type="submit" :loading="busy">
                  Save issue
                </UButton><UButton color="neutral" variant="ghost" @click="editing = false">
                  Cancel
                </UButton>
              </div>
            </form>
            <article v-else class="issue-comment">
              <header class="issue-comment-header">
                {{ issue.authorSubject }}<span v-if="issue.authorActor !== issue.authorSubject"> via {{ issue.authorActor }}</span>
              </header>
              <div class="p-4">
                <IssueMarkdown :html="issue.bodyHtml" />
              </div>
            </article>
            <article v-for="comment in comments" :id="`comment-${comment.id}`" :key="comment.id" class="issue-comment">
              <header class="issue-comment-header flex flex-wrap justify-between gap-2">
                <span>{{ comment.authorSubject }}<span v-if="comment.authorActor !== comment.authorSubject"> via {{ comment.authorActor }}</span> · <a :href="`#comment-${comment.id}`">{{ issueDate(comment.createdAt) }}</a></span>
                <UButton v-if="comment.canEdit" color="neutral" variant="ghost" size="xs" @click="editComment = comment; editCommentBody = comment.body">
                  Edit comment
                </UButton>
              </header>
              <form v-if="editComment?.id === comment.id" class="p-4 space-y-3" @submit.prevent="mutate(saveComment)">
                <IssueEditor v-model="editCommentBody" label="Edit comment" /><UButton type="submit" :loading="busy">
                  Save comment
                </UButton><UButton color="neutral" variant="ghost" @click="editComment = null">
                  Cancel
                </UButton>
              </form>
              <div v-else class="p-4">
                <IssueMarkdown :html="comment.bodyHtml" />
              </div>
            </article>
            <UButton v-if="nextComment" color="neutral" variant="outline" :loading="busy" @click="mutate(moreComments, false)">
              More comments
            </UButton>
            <details v-if="issue.events?.length" class="text-sm text-zinc-400">
              <summary class="cursor-pointer">
                Activity
              </summary><ol class="border-l border-zinc-800 ml-2 pl-4 mt-3 space-y-3">
                <li v-for="event in issue.events" :key="event.id" class="break-words">
                  {{ event.subject }} · {{ event.action }} · {{ issueDate(event.createdAt) }}<span v-if="event.actor !== event.subject"> via {{ event.actor }}</span>
                </li>
              </ol>
            </details>
            <form v-if="issue.capabilities.comment" class="space-y-3 pt-4 border-t border-zinc-800" @submit.prevent="mutate(postComment)">
              <IssueEditor v-model="commentBody" label="Leave a comment" :disabled="busy" />
              <div class="flex flex-wrap justify-end gap-3">
                <UButton v-if="issue.capabilities.triage" color="neutral" variant="outline" :loading="busy" @click="mutate(() => update({ state: issue!.state === 'open' ? 'closed' : 'open' }))">
                  {{ issue.state === 'open' ? 'Close issue' : 'Reopen issue' }}
                </UButton>
                <UButton type="submit" :loading="busy" :disabled="!commentBody.trim()">
                  Comment
                </UButton>
              </div>
            </form>
          </section>
          <aside class="issue-metadata space-y-5 text-sm" aria-label="Issue details">
            <section>
              <h2 class="font-semibold mb-2">
                Assignee
              </h2><p class="text-zinc-400 break-all">
                {{ issue.assignee || 'Unassigned' }}
              </p>
            </section>
            <section>
              <h2 class="font-semibold mb-2">
                Labels
              </h2><div class="flex gap-2 flex-wrap">
                <UBadge v-for="label in issue.labels" :key="label.id" color="neutral" variant="outline">
                  {{ label.name }}
                </UBadge><span v-if="!issue.labels.length" class="text-zinc-500">None</span>
              </div>
            </section>
            <section>
              <h2 class="font-semibold mb-2">
                Product
              </h2><p class="text-zinc-400">
                {{ issue.productName }}
              </p>
            </section>
            <section>
              <h2 class="font-semibold mb-2">
                Stable link
              </h2><NuxtLink :to="issue.stableUrl" class="text-amber-500 break-all">
                {{ issue.stableUrl }}
              </NuxtLink><p class="text-xs text-zinc-500 mt-2">
                Private · available only to authorized readers.
              </p>
            </section>
            <form v-if="issue.capabilities.triage" class="space-y-3 issue-filters" @submit.prevent="mutate(() => update({ assignee: assignee || null, labels: selectedLabels }))">
              <label>Assign to<select v-model="assignee"><option value="">Unassigned</option><option v-for="subject in assignees" :key="subject">{{ subject }}</option></select></label>
              <fieldset class="space-y-2">
                <legend class="mb-2">
                  Set labels
                </legend><label v-for="label in labels" :key="label.id" class="flex gap-2"><input v-model="selectedLabels" type="checkbox" :value="label.id">{{ label.name }}</label>
              </fieldset>
              <UButton type="submit" size="sm" color="neutral" variant="outline" :loading="busy">
                Save metadata
              </UButton>
            </form>
            <details v-if="issue.capabilities.admin">
              <summary class="cursor-pointer">
                Create label
              </summary><form class="space-y-3 mt-3" @submit.prevent="mutate(addLabel)">
                <UInput v-model="labelName" aria-label="Label name" placeholder="Label name" class="w-full" :maxlength="50" required /><label class="flex gap-2 items-center">Color<input v-model="labelColor" type="color" aria-label="Label color"></label><UButton type="submit" :loading="busy" size="sm">
                  Create label
                </UButton>
              </form>
            </details>
          </aside>
        </div>
      </template>
    </main>
  </div>
</template>
