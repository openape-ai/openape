<script setup lang="ts">
import { ref } from 'vue'
import { pullStateLook } from '~/utils/git-ui'
import { formatDate } from '~/utils/repo-browse'

interface PullSummary {
  number: number
  title: string
  sourceRef: string
  targetRef: string
  state: string
  authorEmail: string
  createdAt: number
}

const route = useRoute()
const owner = route.params.owner as string
const name = route.params.name as string

const pulls = ref<PullSummary[]>([])
const branches = ref<{ name: string }[]>([])
const defaultBranch = ref('main')
const error = ref('')

const opening = ref(false)
const showForm = ref(false)
const title = ref('')
const body = ref('')
const source = ref('')
const target = ref('')

onMounted(async () => {
  await load()
})

async function load() {
  error.value = ''
  try {
    const [pullData, branchData] = await Promise.all([
      $fetch<{ pulls: PullSummary[] }>(`/api/repos/${owner}/${name}/pulls`),
      $fetch<{ defaultBranch: string, branches: { name: string }[] }>(`/api/repos/${owner}/${name}/branches`),
    ])
    pulls.value = pullData.pulls
    branches.value = branchData.branches
    defaultBranch.value = branchData.defaultBranch
    if (!target.value) target.value = branchData.defaultBranch
    if (!source.value) source.value = branchData.branches.find(b => b.name !== branchData.defaultBranch)?.name ?? ''
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    error.value = e.data?.statusMessage ?? 'Failed to load pull requests.'
  }
}

async function onOpen() {
  if (opening.value) return
  opening.value = true
  error.value = ''
  try {
    const created = await $fetch<{ number: number }>(`/api/repos/${owner}/${name}/pulls`, {
      method: 'POST',
      body: { title: title.value, body: body.value, source: source.value, target: target.value },
    })
    await navigateTo(`/${owner}/${name}/pulls/${created.number}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Could not open the pull request.'
  }
  finally {
    opening.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader :owner="owner" :name="name" tab="pulls" />

    <main class="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <UAlert v-if="error" color="error" :title="error" />

      <div class="flex justify-end">
        <UButton
          icon="i-lucide-git-pull-request"
          size="sm"
          :variant="showForm ? 'ghost' : 'solid'"
          @click="showForm = !showForm"
        >
          {{ showForm ? 'Cancel' : 'New pull request' }}
        </UButton>
      </div>

      <form
        v-if="showForm"
        class="border border-zinc-800 rounded-lg p-4 space-y-3"
        @submit.prevent="onOpen"
      >
        <div class="flex items-center gap-2 text-sm">
          <USelect v-model="source" :items="branches.map(b => b.name)" icon="i-lucide-git-branch" size="sm" class="w-44" />
          <UIcon name="i-lucide-arrow-right" class="size-4 text-zinc-500" />
          <USelect v-model="target" :items="branches.map(b => b.name)" icon="i-lucide-git-branch" size="sm" class="w-44" />
        </div>
        <UInput v-model="title" placeholder="Title" size="sm" />
        <UTextarea v-model="body" placeholder="Describe the change (optional)" :rows="3" size="sm" />
        <UButton type="submit" size="sm" :loading="opening" :disabled="!title || !source || !target">
          Open pull request
        </UButton>
      </form>

      <p v-if="pulls.length === 0" class="text-zinc-500">
        No pull requests yet.
      </p>

      <ul v-else class="border border-zinc-800 rounded-lg divide-y divide-zinc-800/70">
        <li v-for="pull in pulls" :key="pull.number" class="px-4 py-3 flex items-start gap-3">
          <UIcon
            :name="pullStateLook(pull.state).icon"
            :class="pullStateLook(pull.state).class"
            class="size-4 mt-0.5 shrink-0"
          />
          <div class="min-w-0 flex-1">
            <NuxtLink :to="`/${owner}/${name}/pulls/${pull.number}`" class="text-sm text-zinc-100 hover:text-amber-400">
              {{ pull.title }}
            </NuxtLink>
            <p class="text-xs text-zinc-500 mt-0.5">
              #{{ pull.number }} · {{ pull.authorEmail }} · {{ formatDate(pull.createdAt) }}
              · <code class="font-mono">{{ pull.sourceRef }} → {{ pull.targetRef }}</code>
            </p>
          </div>
        </li>
      </ul>
    </main>
  </div>
</template>
