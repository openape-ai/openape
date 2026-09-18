<script setup lang="ts">
import type { IssueFacets, IssueRecord } from '../../shared/issue-types'
import { computed, onMounted, ref, watch } from 'vue'
import { issueError } from '../utils/issue-ui'

const props = defineProps<{ owner?: string, name?: string }>()
const route = useRoute()
const router = useRouter()
const rows = ref<IssueRecord[]>([])
const total = ref(0)
const cursor = ref<string | null>(null)
const loading = ref(true)
const error = ref('')
const facets = ref<IssueFacets | null>(null)
const q = ref(String(route.query.q || ''))
const repo = computed(() => props.owner && props.name ? `${props.owner}/${props.name}` : '')
const endpoint = computed(() => repo.value ? `/api/repos/${repo.value}/issues` : '/api/issues')
let request = 0
function filter(key: string, value: string) { return router.push({ query: { ...route.query, cursor: undefined, [key]: value || undefined } }) }
async function load() {
  const generation = ++request
  loading.value = true
  error.value = ''
  try {
    const [page, choices] = await Promise.all([
      $fetch<{ issues: IssueRecord[], total: number, cursor: string | null }>(endpoint.value, { query: route.query }),
      $fetch<IssueFacets>('/api/issue-facets'),
    ])
    if (generation !== request) return
    rows.value = page.issues
    total.value = page.total
    cursor.value = page.cursor
    facets.value = choices
  }
  catch (err) { if (generation === request) { rows.value = []; total.value = 0; facets.value = null; error.value = issueError(err) } }
  finally { if (generation === request) loading.value = false }
}
onMounted(() => load())
watch(() => route.fullPath, () => { q.value = String(route.query.q || ''); return load() })
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader v-if="owner && name" :owner="owner" :name="name" tab="issues" />
    <header v-else class="border-b border-zinc-800 px-4 py-4">
      <NuxtLink to="/" class="font-bold">
        🦍 ape-git
      </NuxtLink>
    </header>
    <main class="issue-shell">
      <aside class="issue-navigation">
        <NuxtLink to="/issues" class="block text-sm text-amber-500 py-2">
          All issues
        </NuxtLink>
        <NuxtLink to="/issues?assignee=me" class="block text-sm text-zinc-400 py-2">
          Assigned to me
        </NuxtLink>
        <NuxtLink to="/issues?reporter=me" class="block text-sm text-zinc-400 py-2">
          Reported by me
        </NuxtLink>
        <NuxtLink to="/issues?triage=unclassified" class="block text-sm text-zinc-400 py-2">
          Unclassified reports
        </NuxtLink>
        <NuxtLink to="/report" class="block text-sm text-amber-500 py-2">
          Report a problem
        </NuxtLink>
      </aside>
      <div class="min-w-0 space-y-4">
        <header class="flex justify-between items-center gap-4 flex-wrap">
          <div>
            <h1 class="text-2xl font-semibold">
              Issues
            </h1><p class="text-sm text-zinc-400 mt-1">
              Development work across your accessible repositories.
            </p>
          </div>
          <UButton v-if="repo && facets?.canCreate" :to="`/${repo}/issues/new`" icon="i-lucide-plus">
            New issue
          </UButton>
        </header>
        <UAlert v-if="error" color="error" :title="error" />
        <form class="flex gap-2" @submit.prevent="filter('q', q)">
          <UInput v-model="q" aria-label="Search issues" placeholder="Search title and description" icon="i-lucide-search" class="min-w-0 flex-1" /><UButton type="submit" color="neutral" variant="outline">
            Search
          </UButton>
        </form>
        <div class="issue-filters">
          <label>State<select :value="route.query.state || 'open'" @change="filter('state', ($event.target as HTMLSelectElement).value)"><option value="open">Open</option><option value="closed">Closed</option><option value="all">All states</option></select></label>
          <label v-if="!repo">Repository<select :value="route.query.repo || ''" @change="filter('repo', ($event.target as HTMLSelectElement).value)"><option value="">All repositories</option><option v-for="item in facets?.repositories" :key="`${item.owner}/${item.name}`">{{ item.owner }}/{{ item.name }}</option></select></label>
          <label>Product<select :value="route.query.product || ''" @change="filter('product', ($event.target as HTMLSelectElement).value)"><option value="">All products</option><option v-for="item in facets?.products" :key="item.key" :value="item.key">{{ item.name }}</option></select></label>
          <label>Label<select :value="route.query.label || ''" @change="filter('label', ($event.target as HTMLSelectElement).value)"><option value="">All labels</option><option v-for="item in facets?.labels" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <label>Assignee<select :value="route.query.assignee || ''" @change="filter('assignee', ($event.target as HTMLSelectElement).value)"><option value="">Anyone</option><option value="me">Me</option><option v-for="subject in facets?.assignees" :key="subject">{{ subject }}</option></select></label>
        </div>
        <IssueList :issues="rows" :total="total" :loading="loading" />
        <UButton v-if="route.query.cursor" color="neutral" variant="ghost" @click="filter('cursor', '')">
          First page
        </UButton>
        <UButton v-if="cursor" color="neutral" variant="outline" :loading="loading" @click="filter('cursor', cursor!)">
          Next page
        </UButton>
        <section v-if="!repo && facets?.canCreate && facets.repositories.length" class="text-sm text-zinc-400">
          <h2 class="mb-2">
            Open a new issue
          </h2><div class="flex flex-wrap gap-3">
            <NuxtLink v-for="item in facets.repositories" :key="`${item.owner}/${item.name}`" :to="`/${item.owner}/${item.name}/issues/new`" class="text-amber-500">
              {{ item.owner }}/{{ item.name }}
            </NuxtLink>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
