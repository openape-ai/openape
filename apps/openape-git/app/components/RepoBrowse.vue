<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { breadcrumbs, formatBytes, formatDate, parentPath, shortSha } from '~/utils/repo-browse'

interface TreeEntry {
  name: string
  type: 'tree' | 'blob'
  size: number | null
}

interface CommitInfo {
  sha: string
  author: string
  email: string
  date: number
  subject: string
}

interface BrowseResult {
  type: 'tree' | 'blob' | 'empty'
  ref: string
  path?: string
  size?: number
  binary?: boolean
  tooLarge?: boolean
  rendered?: 'markdown' | 'code'
  lang?: string
  html?: string
  entries?: TreeEntry[]
  readme?: { name: string, html: string } | null
  latestCommit?: CommitInfo | null
  defaultBranch?: string
}

const props = defineProps<{
  owner: string
  name: string
  path: string
}>()

const route = useRoute()
const router = useRouter()

const browse = ref<BrowseResult | null>(null)
const branches = ref<{ name: string }[]>([])
const defaultBranch = ref('main')
const error = ref('')
const loading = ref(true)

const currentRef = computed(() =>
  typeof route.query.ref === 'string' && route.query.ref ? route.query.ref : defaultBranch.value)

const refQuery = computed(() => {
  const query: Record<string, string> = {}
  if (typeof route.query.ref === 'string' && route.query.ref) query.ref = route.query.ref
  return query
})

const crumbs = computed(() => breadcrumbs(props.path))
const base = computed(() => `/${props.owner}/${props.name}`)

function entryTarget(entry: TreeEntry): { path: string, query: Record<string, string> } {
  const entryPath = props.path ? `${props.path}/${entry.name}` : entry.name
  return { path: `${base.value}/tree/${entryPath}`, query: refQuery.value }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [branchData, browseData] = await Promise.all([
      $fetch<{ defaultBranch: string, branches: { name: string }[] }>(
        `/api/repos/${props.owner}/${props.name}/branches`,
      ),
      $fetch<BrowseResult>(`/api/repos/${props.owner}/${props.name}/browse`, {
        query: { ...refQuery.value, path: props.path || undefined },
      }),
    ])
    defaultBranch.value = branchData.defaultBranch
    branches.value = branchData.branches
    browse.value = browseData
  }
  catch (err: unknown) {
    const e = err as { statusCode?: number, data?: { statusMessage?: string } }
    error.value = e.data?.statusMessage ?? (e.statusCode === 404 ? 'Not found.' : 'Failed to load.')
  }
  finally {
    loading.value = false
  }
}

watch([() => props.path, () => route.query.ref], load, { immediate: true })

function onBranchChange(branch: string) {
  const query = branch === defaultBranch.value ? {} : { ref: branch }
  router.push({ path: route.path, query })
}
</script>

<template>
  <div class="space-y-4">
    <UAlert v-if="error" color="error" :title="error" />

    <template v-else-if="browse">
      <!-- ref + breadcrumbs row -->
      <div class="flex flex-wrap items-center gap-2">
        <USelect
          :model-value="currentRef"
          :items="branches.map(b => b.name)"
          icon="i-lucide-git-branch"
          size="sm"
          class="w-44"
          @update:model-value="onBranchChange($event as string)"
        />
        <nav class="flex items-center gap-1 font-mono text-sm min-w-0 flex-wrap">
          <NuxtLink :to="{ path: base, query: refQuery }" class="text-amber-500 hover:underline">
            {{ name }}
          </NuxtLink>
          <template v-for="crumb in crumbs" :key="crumb.path">
            <span class="text-zinc-600">/</span>
            <NuxtLink
              v-if="crumb.path !== path"
              :to="{ path: `${base}/tree/${crumb.path}`, query: refQuery }"
              class="text-amber-500 hover:underline"
            >
              {{ crumb.name }}
            </NuxtLink>
            <span v-else class="text-zinc-200">{{ crumb.name }}</span>
          </template>
        </nav>
      </div>

      <!-- empty repo -->
      <div v-if="browse.type === 'empty'" class="border border-zinc-800 rounded-lg px-4 py-8 text-center text-zinc-400">
        <p class="font-medium text-zinc-200 mb-1">
          This repo is empty
        </p>
        <p class="text-sm">
          Push a first commit and the file browser appears here.
        </p>
      </div>

      <!-- tree listing -->
      <template v-else-if="browse.type === 'tree'">
        <div v-if="browse.latestCommit" class="flex items-center gap-2 text-sm text-zinc-400 border border-zinc-800 rounded-lg px-4 py-2.5 bg-zinc-900/50">
          <UIcon name="i-lucide-git-commit-horizontal" class="size-4 shrink-0" />
          <span class="truncate flex-1">
            <span class="text-zinc-200">{{ browse.latestCommit.subject }}</span>
            <span class="hidden sm:inline"> · {{ browse.latestCommit.author }}</span>
          </span>
          <NuxtLink :to="{ path: `${base}/commits`, query: refQuery }" class="font-mono text-amber-500 hover:underline shrink-0">
            {{ shortSha(browse.latestCommit.sha) }}
          </NuxtLink>
          <span class="shrink-0 hidden sm:inline">{{ formatDate(browse.latestCommit.date) }}</span>
        </div>

        <ul class="border border-zinc-800 rounded-lg divide-y divide-zinc-800/70 overflow-hidden">
          <li v-if="path">
            <NuxtLink
              :to="{ path: parentPath(path) ? `${base}/tree/${parentPath(path)}` : base, query: refQuery }"
              class="flex items-center gap-2.5 px-4 py-2 hover:bg-zinc-900 text-sm font-mono text-zinc-400"
            >
              <UIcon name="i-lucide-corner-left-up" class="size-4 shrink-0" />..
            </NuxtLink>
          </li>
          <li v-for="entry in browse.entries" :key="entry.name">
            <NuxtLink
              :to="entryTarget(entry)"
              class="flex items-center gap-2.5 px-4 py-2 hover:bg-zinc-900 text-sm font-mono"
            >
              <UIcon
                :name="entry.type === 'tree' ? 'i-lucide-folder' : 'i-lucide-file'"
                class="size-4 shrink-0"
                :class="entry.type === 'tree' ? 'text-amber-500/80' : 'text-zinc-500'"
              />
              <span class="truncate flex-1 text-zinc-200">{{ entry.name }}</span>
              <span v-if="entry.size !== null" class="text-xs text-zinc-500 shrink-0">
                {{ formatBytes(entry.size) }}
              </span>
            </NuxtLink>
          </li>
        </ul>

        <section v-if="browse.readme" class="border border-zinc-800 rounded-lg">
          <div class="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 text-sm text-zinc-400">
            <UIcon name="i-lucide-book-open" class="size-4" />
            <span class="font-mono">{{ browse.readme.name }}</span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html — server-sanitized (strict allowlist) -->
          <div class="markdown-body px-4 sm:px-6 py-5" v-html="browse.readme.html" />
        </section>
      </template>

      <!-- blob -->
      <template v-else-if="browse.type === 'blob'">
        <div class="border border-zinc-800 rounded-lg overflow-hidden">
          <div class="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 text-sm text-zinc-400">
            <UIcon name="i-lucide-file" class="size-4" />
            <span class="font-mono text-zinc-200 truncate flex-1">{{ path.split('/').pop() }}</span>
            <span class="text-xs shrink-0">{{ formatBytes(browse.size ?? 0) }}</span>
          </div>
          <div v-if="browse.binary" class="px-4 py-8 text-center text-sm text-zinc-500">
            Binary file — not shown. Clone the repo to inspect it.
          </div>
          <div v-else-if="browse.tooLarge" class="px-4 py-8 text-center text-sm text-zinc-500">
            File is too large to display. Clone the repo to inspect it.
          </div>
          <!-- eslint-disable-next-line vue/no-v-html — server-sanitized (strict allowlist) -->
          <div v-else-if="browse.rendered === 'markdown'" class="markdown-body px-4 sm:px-6 py-5" v-html="browse.html" />
          <!-- eslint-disable-next-line vue/no-v-html — shiki output, escaped by construction -->
          <div v-else class="code-view text-sm" v-html="browse.html" />
        </div>
      </template>
    </template>

    <div v-else-if="loading" class="text-zinc-500 text-sm py-8 text-center">
      Loading…
    </div>
  </div>
</template>
