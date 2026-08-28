<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'
import { formatDate, shortSha } from '~/utils/repo-browse'

interface CommitInfo {
  sha: string
  author: string
  email: string
  date: number
  subject: string
  pusher: {
    email: string
    act: 'human' | 'agent'
    delegator?: string
  } | null
}

const route = useRoute()
const router = useRouter()
const owner = route.params.owner as string
const name = route.params.name as string

const { user, fetchUser } = useOpenApeAuth()
const ready = ref(false)
const commits = ref<CommitInfo[]>([])
const branches = ref<{ name: string }[]>([])
const defaultBranch = ref('main')
const error = ref('')

const currentRef = computed(() =>
  typeof route.query.ref === 'string' && route.query.ref ? route.query.ref : defaultBranch.value)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  ready.value = true
})

async function load() {
  error.value = ''
  try {
    const [branchData, logData] = await Promise.all([
      $fetch<{ defaultBranch: string, branches: { name: string }[] }>(`/api/repos/${owner}/${name}/branches`),
      $fetch<{ commits: CommitInfo[] }>(`/api/repos/${owner}/${name}/commits`, {
        query: typeof route.query.ref === 'string' && route.query.ref ? { ref: route.query.ref } : {},
      }),
    ])
    defaultBranch.value = branchData.defaultBranch
    branches.value = branchData.branches
    commits.value = logData.commits
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string } }
    error.value = e.data?.statusMessage ?? 'Failed to load commits.'
  }
}

watch([ready, () => route.query.ref], () => {
  if (ready.value) load()
}, { immediate: true })

function onBranchChange(branch: string) {
  const query = branch === defaultBranch.value ? {} : { ref: branch }
  router.push({ path: route.path, query })
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader :owner="owner" :name="name" tab="commits" />

    <main v-if="ready" class="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <UAlert v-if="error" color="error" :title="error" />

      <USelect
        :model-value="currentRef"
        :items="branches.map(b => b.name)"
        icon="i-lucide-git-branch"
        size="sm"
        class="w-44"
        @update:model-value="onBranchChange($event as string)"
      />

      <ul class="border border-zinc-800 rounded-lg divide-y divide-zinc-800/70">
        <li v-for="commit in commits" :key="commit.sha" class="px-4 py-3 flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm text-zinc-100 truncate">
              {{ commit.subject }}
            </p>
            <p class="text-xs text-zinc-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>{{ commit.author }} · {{ formatDate(commit.date) }}</span>
              <UBadge
                v-if="commit.pusher"
                :color="commit.pusher.act === 'agent' ? 'primary' : 'neutral'"
                variant="subtle"
                size="sm"
                class="font-mono"
              >
                <UIcon :name="commit.pusher.act === 'agent' ? 'i-lucide-bot' : 'i-lucide-user'" class="size-3" />
                {{ commit.pusher.email }}<template v-if="commit.pusher.delegator">
                  ⟵ {{ commit.pusher.delegator }}
                </template>
              </UBadge>
            </p>
          </div>
          <code class="font-mono text-xs text-amber-500 shrink-0 mt-0.5">{{ shortSha(commit.sha) }}</code>
        </li>
      </ul>
    </main>
  </div>
</template>
