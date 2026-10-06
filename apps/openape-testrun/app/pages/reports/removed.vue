<script setup lang="ts">
import { ref } from 'vue'
import { daysLeft, days, kindOf, shortDate } from '../../utils/report-format'
import { toast } from '../../utils/toast'
import AppIcon from '../../components/AppIcon.vue'
import AppTopBar from '../../components/AppTopBar.vue'
import RestoreDialog from '../../components/RestoreDialog.vue'

interface Removed { id: string, title: string, category: string | null, removed_at: number | null, unavailable_at: number, purge_at: number }
const route = useRoute()
const { data, error, refresh } = await useFetch<{ items: Removed[] }>('/api/documents', { query: { deleted: 'true', limit: 100 } })
useSeoMeta({ title: 'Recently removed — OpenApe Reports', robots: 'noindex, nofollow' })

const selected = ref<Removed | null>(null)
const busy = ref(false)
const failure = ref('')
function choose(item: Removed) { selected.value = item; failure.value = '' }
async function restore(lifetime: { permanent: true } | { expiresIn: string }) {
  const item = selected.value!
  busy.value = true; failure.value = ''
  try {
    await $fetch(`/api/documents/${item.id}/restore`, { method: 'POST', body: { lifetime } })
    selected.value = null
    await refresh()
    toast(`Restored “${item.title}”. Only you can open it.`, 6000, { href: `/d/${item.id}`, label: 'Open' })
  }
  catch (problem) {
    failure.value = (problem as { statusCode?: number }).statusCode === 410 ? 'The 30 days have passed, so this report can no longer be restored.' : 'Restoring failed. Reload the page and try again.'
  }
  finally { busy.value = false }
}
</script>

<template>
  <div class="surface">
    <AppTopBar search="" @search="q => navigateTo({ path: '/reports', query: { q } })" />
    <div class="lib single">
      <section aria-labelledby="rm-h">
        <p class="back">
          <NuxtLink class="link" to="/reports">
            <AppIcon name="back" small /> All reports
          </NuxtLink>
        </p>
        <div class="list-head">
          <div>
            <h1 id="rm-h">
              Recently removed
            </h1>
            <p class="sub">
              Removed and expired reports stay here for 30 days. After that they are deleted for good.
            </p>
          </div>
        </div>
        <div v-if="error" class="sheet">
          <div class="empty" role="alert">
            <div class="empty-mark">
              <AppIcon :name="error.statusCode === 401 ? 'lock' : 'alert'" />
            </div>
            <h2>{{ error.statusCode === 401 ? 'Sign in to see removed reports' : 'Removed reports could not be loaded' }}</h2>
            <div class="acts">
              <NuxtLink v-if="error.statusCode === 401" class="btn primary" :to="{ path: '/', query: { returnTo: route.fullPath } }">
                Sign in with OpenApe
              </NuxtLink>
              <button v-else class="btn" type="button" @click="refresh()">
                Try again
              </button>
            </div>
          </div>
        </div>
        <div v-else-if="data?.items.length" class="sheet">
          <div v-for="item in data.items" :key="item.id" class="row">
            <span class="kind" :class="kindOf(item.category)"><AppIcon :name="kindOf(item.category)" /></span>
            <span class="main">
              <span class="row-title">{{ item.title }}</span>
              <span class="row-sub">
                <span>{{ item.removed_at === item.unavailable_at ? 'Removed' : 'Expired' }} {{ shortDate(item.unavailable_at) }}</span>
                <span class="warn-text">Restorable for {{ days(daysLeft(item.purge_at)) }} more</span>
              </span>
            </span>
            <button class="btn" type="button" @click="choose(item)">
              <AppIcon name="restore" />Restore
            </button>
          </div>
        </div>
        <div v-else class="sheet">
          <div class="empty">
            <div class="empty-mark">
              <AppIcon name="restore" />
            </div>
            <h2>Nothing to restore</h2>
            <p>When a report is removed or expires, you can bring it back from here for 30 days.</p>
            <div class="acts">
              <NuxtLink class="btn" to="/reports">
                Back to all reports
              </NuxtLink>
            </div>
          </div>
        </div>
      </section>
    </div>
    <RestoreDialog :open="Boolean(selected)" :title="selected?.title ?? ''" :busy="busy" :error="failure" @close="selected = null" @restore="restore" />
  </div>
</template>

<style scoped>
.back { margin: 0 0 14px; }
.back .link { display: inline-flex; align-items: center; gap: 6px; text-decoration: underline; }
.row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 13px 18px; border-bottom: 1px solid var(--rule); }
.main { min-width: 0; }
@media (max-width: 760px) { .row { padding: 12px 14px; gap: 12px; } }
</style>
