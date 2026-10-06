<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import type { LibraryItem, LibraryPage } from '../../../shared/library'
import type { AdvancedFilter } from '../../components/FilterSheet.vue'
import type { IconName } from '../../components/AppIcon.vue'
import { onMounted, ref, watch } from 'vue'
import { groupLabel, kindOf } from '../../utils/report-format'
import AppIcon from '../../components/AppIcon.vue'
import AppTopBar from '../../components/AppTopBar.vue'
import FilterSheet from '../../components/FilterSheet.vue'
import ReportRow from '../../components/ReportRow.vue'

const route = useRoute()
const router = useRouter()
const one = (value: unknown) => typeof value === 'string' ? value : ''
const q = computed(() => one(route.query.q))
const category = computed(() => one(route.query.category))
const selectedTags = computed(() => [route.query.tag ?? []].flat().filter((tag): tag is string => typeof tag === 'string'))
const advanced = computed<AdvancedFilter>(() => ({ access: one(route.query.access), team: one(route.query.team), field: one(route.query.field), value: one(route.query.value) }))
const sort = computed(() => route.query.sort === 'title' ? 'title' : 'updated')
const query = computed(() => ({ q: q.value || undefined, category: category.value || undefined, tag: selectedTags.value, ...Object.fromEntries(Object.entries(advanced.value).filter(([, value]) => value)), sort: sort.value === 'title' ? 'title' : undefined }))

const { data, error, refresh } = await useFetch<LibraryPage>('/api/library', { query })
const { data: teams } = await useFetch<{ items: { id: string, name: string }[] }>('/api/documents/teams', { query: { limit: 100 } })
useSeoMeta({ title: 'OpenApe Reports', robots: 'noindex, nofollow' })

const more = ref<LibraryItem[]>([])
const nextCursor = ref<string | null>(null)
const loadingMore = ref(false)
watch(data, (page) => { more.value = []; nextCursor.value = page?.next_cursor ?? null }, { immediate: true })
const items = computed(() => [...(data.value?.items ?? []), ...more.value])
async function loadMore() {
  loadingMore.value = true
  try {
    const page = await $fetch<LibraryPage>('/api/library', { query: { ...query.value, cursor: nextCursor.value } })
    more.value.push(...page.items); nextCursor.value = page.next_cursor
  }
  finally { loadingMore.value = false }
}

function update(patch: LocationQueryRaw) {
  const next = Object.fromEntries(Object.entries({ ...route.query, ...patch }).filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && !value.length)))
  return router.replace({ query: next })
}
const search = ref(q.value)
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch(value: string) {
  search.value = value
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => update({ q: value.trim() || undefined }), 250)
}
watch(q, (value) => { if (value !== search.value.trim()) search.value = value })
const toggleTag = (tag: string) => update({ tag: selectedTags.value.includes(tag) ? selectedTags.value.filter(item => item !== tag) : [...selectedTags.value, tag] })
function clearAll() { search.value = ''; return router.replace({ query: sort.value === 'title' ? { sort: 'title' } : {} }) }

const teamNames = computed(() => new Map((teams.value?.items ?? []).map(team => [team.id, team.name])))
const facets = computed(() => data.value?.facets)
const categories = computed(() => [{ label: '', name: 'All reports', count: facets.value?.all ?? 0, icon: 'all' as IconName }, ...(facets.value?.categories ?? []).map(item => ({ label: item.label, name: item.label, count: item.count, icon: kindOf(item.label) as IconName }))])
const tagCloud = computed(() => {
  const top = (facets.value?.tags ?? []).map(item => [item.label, item.count] as const)
  return [...top, ...selectedTags.value.filter(tag => !top.some(([label]) => label === tag)).map(tag => [tag, 0] as const)]
})
const advancedCount = computed(() => ['access', 'team', 'field'].filter(key => advanced.value[key as keyof AdvancedFilter]).length)
const ACCESS_LABEL: Record<string, string> = { private: 'Only me', readers: 'Named people', team: 'A team', link: 'Anyone with the link', public: 'Public' }
const chips = computed(() => [
  ...(q.value ? [{ key: 'q', label: `Search: “${q.value}”`, clear: { q: undefined } }] : []),
  ...selectedTags.value.map(tag => ({ key: `tag:${tag}`, label: `Tag: ${tag}`, clear: { tag: selectedTags.value.filter(item => item !== tag) } })),
  ...(advanced.value.access ? [{ key: 'access', label: `Access: ${ACCESS_LABEL[advanced.value.access] ?? advanced.value.access}`, clear: { access: undefined } }] : []),
  ...(advanced.value.team ? [{ key: 'team', label: teamNames.value.get(advanced.value.team) ?? 'Team', clear: { team: undefined } }] : []),
  ...(advanced.value.field && advanced.value.value ? [{ key: 'field', label: `${advanced.value.field} is ${advanced.value.value}`, clear: { field: undefined, value: undefined } }] : []),
])
const groups = computed(() => {
  if (sort.value === 'title') return [{ label: '', items: items.value }]
  const result: { label: string, items: LibraryItem[] }[] = []
  for (const item of items.value) {
    const label = groupLabel(item.at)
    if (result.at(-1)?.label !== label) result.push({ label, items: [] })
    result.at(-1)!.items.push(item)
  }
  return result
})

const filtersOpen = ref(false)
const narrow = ref(false)
function openFilters() {
  narrow.value = window.matchMedia('(max-width: 760px)').matches
  filtersOpen.value = true
}
async function applyFilters(filter: AdvancedFilter) {
  filtersOpen.value = false
  await update({ access: filter.access || undefined, team: filter.team || undefined, field: filter.field && filter.value ? filter.field : undefined, value: filter.field && filter.value ? filter.value : undefined })
}
const topbar = ref<InstanceType<typeof AppTopBar>>()
onMounted(() => { if (q.value) topbar.value?.focus() })
</script>

<template>
  <div class="surface">
    <AppTopBar ref="topbar" :search="search" @search="onSearch" />
    <div v-if="error?.statusCode === 401" class="lib single">
      <div class="sheet">
        <div class="empty">
          <div class="empty-mark">
            <AppIcon name="lock" />
          </div>
          <h2>Sign in to see your reports</h2>
          <p>Reports are private to you, your teams and the people they are shared with.</p>
          <div class="acts">
            <NuxtLink class="btn primary" :to="{ path: '/', query: { returnTo: route.fullPath } }">
              Sign in with OpenApe
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="lib">
      <nav class="rail" aria-label="Library">
        <ul class="cat-list">
          <li v-for="item in categories" :key="item.label">
            <button type="button" class="cat" :aria-current="category === item.label" @click="update({ category: item.label || undefined })">
              <AppIcon :name="item.icon" :class="item.icon" />{{ item.name }}<span class="count">{{ item.count }}</span>
            </button>
          </li>
        </ul>
        <div>
          <h2 id="tags-h" class="rail-h">
            Tags
          </h2>
          <div v-if="tagCloud.length" class="tag-cloud" role="group" aria-labelledby="tags-h">
            <button v-for="[tag, count] in tagCloud" :key="tag" type="button" class="tag" :aria-pressed="selectedTags.includes(tag)" @click="toggleTag(tag)">
              {{ tag }}<span class="n">{{ count }}</span>
            </button>
          </div>
          <p v-else class="hint no-tags">
            No tags yet.
          </p>
        </div>
        <div class="rail-foot">
          <NuxtLink class="cat" to="/reports/removed">
            <AppIcon name="restore" />Recently removed
          </NuxtLink>
        </div>
      </nav>
      <section aria-labelledby="list-h">
        <div class="mcats" role="group" aria-label="Categories">
          <button v-for="item in categories" :key="item.label" type="button" class="cat" :aria-current="category === item.label" @click="update({ category: item.label || undefined })">
            <AppIcon :name="item.icon" :class="item.icon" />{{ item.name }}<span class="count">{{ item.count }}</span>
          </button>
        </div>
        <div class="list-head">
          <div>
            <h1 id="list-h">
              {{ category || 'All reports' }}
            </h1>
            <p class="sub" aria-live="polite">
              {{ facets?.total === 1 ? '1 report' : `${facets?.total ?? 0} reports` }}
            </p>
          </div>
          <div class="tools">
            <button class="btn" type="button" @click="openFilters">
              <AppIcon name="sliders" />Filters<span v-if="advancedCount" class="badge-n" :aria-label="`${advancedCount} active`">{{ advancedCount }}</span>
            </button>
            <label><span class="sr">Sort</span>
              <select :value="sort" aria-label="Sort reports" @change="update({ sort: ($event.target as HTMLSelectElement).value === 'title' ? 'title' : undefined })">
                <option value="updated">Recently updated</option>
                <option value="title">Title A to Z</option>
              </select>
            </label>
          </div>
        </div>
        <div class="chips">
          <span v-for="chip in chips" :key="chip.key" class="chip">{{ chip.label }}<button type="button" :aria-label="`Remove filter ${chip.label}`" @click="update(chip.clear)"><AppIcon name="x" small /></button></span>
          <button v-if="chips.length" type="button" class="link" @click="clearAll">
            Clear all
          </button>
        </div>
        <div v-if="error" class="sheet">
          <div class="empty" role="alert">
            <div class="empty-mark">
              <AppIcon name="alert" />
            </div>
            <h2>Reports could not be loaded</h2>
            <p>Check your connection and try again.</p>
            <div class="acts">
              <button class="btn" type="button" @click="refresh()">
                Try again
              </button>
            </div>
          </div>
        </div>
        <template v-else-if="items.length">
          <div class="sheet">
            <div v-for="group in groups" :key="group.label" role="group" :aria-label="group.label || undefined">
              <h2 v-if="group.label" class="group-h">
                {{ group.label }}
              </h2>
              <ReportRow v-for="item in group.items" :key="`${item.source}:${item.id}`" :item="item" :team-name="item.team_id ? teamNames.get(item.team_id) ?? null : null" />
            </div>
          </div>
          <p v-if="!nextCursor" class="list-foot">
            End of list
          </p>
          <p v-else class="list-foot">
            <button class="btn" type="button" :disabled="loadingMore" @click="loadMore">
              {{ loadingMore ? 'Loading…' : 'Show more' }}
            </button>
          </p>
        </template>
        <div v-else-if="!facets?.all" class="sheet">
          <div class="empty">
            <div class="empty-mark">
              <AppIcon name="report" />
            </div>
            <h2>No reports yet</h2>
            <p>Reports appear here when you, a teammate, an agent or an automation publishes a finished HTML file.</p>
            <div class="acts">
              <button class="btn primary" type="button" @click="topbar?.openPublish()">
                <AppIcon name="upload" />How to publish
              </button>
            </div>
          </div>
        </div>
        <div v-else class="sheet">
          <div class="empty">
            <div class="empty-mark">
              <AppIcon name="search" />
            </div>
            <h2>{{ q ? `No reports match “${q}”` : 'No reports match these filters' }}</h2>
            <p>Check the spelling, remove a filter or search all categories. Removed reports are listed under Recently removed.</p>
            <div class="acts">
              <button v-if="category" class="btn" type="button" @click="update({ category: undefined })">
                Search all categories
              </button>
              <button class="btn" type="button" @click="clearAll">
                Clear filters
              </button>
              <NuxtLink class="btn quiet" to="/reports/removed">
                <AppIcon name="restore" />Recently removed
              </NuxtLink>
            </div>
          </div>
        </div>
      </section>
    </div>
    <FilterSheet :open="filtersOpen" :filter="advanced" :teams="teams?.items ?? []" :tags="narrow ? tagCloud.map(([tag]) => tag) : null" :selected-tags="selectedTags" @close="filtersOpen = false" @apply="applyFilters" @toggle-tag="toggleTag" />
  </div>
</template>

<style scoped>
.rail { position: sticky; top: calc(var(--bar-h) + var(--safe-top, 0px) + 24px); align-self: start; display: grid; gap: 22px; }
.rail-h { font-size: 13px; font-weight: 600; color: var(--muted); margin: 0 10px 6px; }
.rail .tag-cloud { padding: 0 6px; }
.no-tags { padding: 0 10px; margin: 0; }
.cat-list { display: grid; gap: 2px; list-style: none; padding: 0; margin: 0; }
.cat { width: 100%; display: flex; align-items: center; gap: 10px; border: 0; background: transparent; padding: 8px 10px; border-radius: var(--radius-s); text-align: left; text-decoration: none; font: inherit; font-weight: 500; color: var(--ink); cursor: pointer; }
.cat:hover { background: var(--paper-2); }
.cat[aria-current="true"] { background: var(--paper); box-shadow: inset 0 0 0 1px var(--rule); }
.cat .count { margin-left: auto; color: var(--muted); font-size: 13px; }
.cat .i { color: var(--muted); }
.cat .i.report { color: var(--c-report); }
.cat .i.plan { color: var(--c-plan); }
.cat .i.testrun { color: var(--c-test); }
.rail-foot { border-top: 1px solid var(--rule); padding-top: 12px; }
.tools { display: flex; gap: 8px; align-items: center; }
.tools select { height: 36px; border: 1px solid var(--rule-strong); background: var(--paper); color: var(--ink); border-radius: var(--radius-s); padding: 0 8px; font: inherit; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: -2px 0 14px; }
.chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--rule-strong); background: var(--paper); border-radius: 999px; padding: 3px 6px 3px 11px; font-size: 13px; }
.chip button { border: 0; background: transparent; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; color: var(--muted); cursor: pointer; }
.chip button:hover { background: var(--paper-2); color: var(--ink); }
.mcats { display: none; }
@media (max-width: 760px) {
  .rail { display: none; }
  .mcats { display: flex; gap: 6px; overflow-x: auto; margin: 0 -12px 12px; padding: 2px 12px 6px; scrollbar-width: none; }
  .mcats .cat { width: auto; flex: none; border: 1px solid var(--rule-strong); border-radius: 999px; padding: 6px 12px; background: var(--paper); }
  .mcats .cat[aria-current="true"] { background: var(--ink); color: var(--paper); box-shadow: none; border-color: var(--ink); }
  .mcats .cat[aria-current="true"] .i, .mcats .cat[aria-current="true"] .count { color: inherit; }
  .list-head { align-items: center; margin-bottom: 10px; }
  .list-head h1 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .list-head .sub { margin: 0; }
}
</style>
