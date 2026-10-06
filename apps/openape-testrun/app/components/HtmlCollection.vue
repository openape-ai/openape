<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface Item { id: string, title: string, category: string | null, tags: string[], audience: string, latest_version: number, removed_at: number | null, expires_at: number | null, url: string }
interface Collection { items: Item[], next_cursor: string | null }
const ready = ref(false)
onMounted(() => { ready.value = true })
const route = useRoute()
const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const category = ref(typeof route.query.htmlCategory === 'string' ? route.query.htmlCategory : '')
const tag = ref(typeof route.query.tag === 'string' ? route.query.tag : '')
const field = ref(''); const fieldValue = ref('')
const team = ref(''); const deleted = ref(false); const cursor = ref<string | undefined>()
const filter = computed(() => ({ search: search.value || undefined, category: category.value || undefined, tags: tag.value ? JSON.stringify(tag.value.split(',').map(item => item.trim()).filter(Boolean)) : undefined, team: team.value || undefined, metadata: field.value && fieldValue.value ? JSON.stringify({ [field.value]: fieldValue.value }) : undefined, deleted: deleted.value ? 'true' : undefined, cursor: cursor.value }))
const { data, error, refresh } = await useFetch<Collection>('/api/documents', { query: filter })
const { data: categories } = await useFetch<{ items: { label: string, count: number }[] }>('/api/documents/categories', { query: { limit: 100 } })
const { data: suggestions } = await useFetch<{ items: { label: string, count: number }[] }>('/api/documents/tags', { query: computed(() => ({ category: category.value || undefined, team: team.value || undefined, limit: 100 })) })
const { data: teams } = await useFetch<{ items: { id: string, name: string }[] }>('/api/documents/teams', { query: { limit: 100 } })
const message = ref(''); const restoreId = ref(''); const lifetime = ref(''); const permanent = ref(false)
async function restore() {
  message.value = ''
  if (!permanent.value && !lifetime.value.trim()) { message.value = 'Choose a new lifetime explicitly.'; return }
  try {
    await $fetch(`/api/documents/${restoreId.value}/restore`, { method: 'POST', body: { lifetime: permanent.value ? { permanent: true } : { expiresIn: lifetime.value.trim() } } })
    restoreId.value = ''; await refresh(); message.value = 'Restored with owner-only access.'
  }
  catch { message.value = 'Restore failed. The recovery period may have ended; refresh before retrying.' }
}
</script>

<template>
  <section aria-label="HTML reports" class="html-collection">
    <h2>HTML documents</h2>
    <p>Publish one finished HTML file with <code>ape-reports publish report.html --key &lt;unique-key&gt;</code>. New reports are private and permanent.</p>
    <form @submit.prevent="cursor = undefined">
      <fieldset :disabled="!ready" class="filters">
        <label>Search <input v-model="search" type="search" @input="cursor = undefined"></label>
        <label>Category <select v-model="category" @change="cursor = undefined"><option value="">All categories</option><option v-for="item in categories?.items" :key="item.label">{{ item.label }}</option></select></label>
        <label>Tags (all, separated by commas) <input v-model="tag" list="report-tags" @input="cursor = undefined"></label>
        <datalist id="report-tags">
          <option v-for="item in suggestions?.items" :key="item.label" :value="item.label" />
        </datalist>
        <label>Team <select v-model="team" @change="cursor = undefined"><option value="">All teams</option><option v-for="item in teams?.items" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label>Metadata field (optional) <input v-model="field" placeholder="plans.status" @input="cursor = undefined"></label>
        <label>Metadata value <input v-model="fieldValue" placeholder="active" @input="cursor = undefined"></label>
        <label><input v-model="deleted" type="checkbox" @change="cursor = undefined"> Recoverable documents</label>
      </fieldset>
    </form>
    <p v-if="error" role="alert">
      Could not load documents. Check your filters and sign-in, then retry.
      <button type="button" @click="refresh()">
        Retry
      </button>
    </p>
    <p v-else-if="!data?.items.length">
      No documents match these filters.
    </p>
    <article v-for="item in data?.items" :key="item.id">
      <div><h3>{{ item.title }}</h3><p>{{ item.category || 'Uncategorized' }} · {{ item.audience }} · Version {{ item.latest_version }}</p><p>{{ item.tags.join(' · ') }}</p></div>
      <button v-if="deleted" type="button" @click="restoreId = item.id; permanent = false; lifetime = ''">
        Restore
      </button>
      <NuxtLink v-else :to="`/d/${item.id}`">
        Read →
      </NuxtLink>
    </article>
    <form v-if="restoreId" aria-label="Restore document" @submit.prevent="restore">
      <p>Restoration starts owner-only. Choose a new lifetime.</p>
      <label><input v-model="permanent" type="checkbox"> Permanent</label>
      <label v-if="!permanent">Lifetime (for example 7d) <input v-model="lifetime" required></label>
      <button type="submit">
        Restore privately
      </button><button type="button" @click="restoreId = ''">
        Cancel
      </button>
    </form>
    <p v-if="message" role="status">
      {{ message }}
    </p>
    <nav aria-label="HTML document pages">
      <button v-if="cursor" type="button" @click="cursor = undefined">
        First page
      </button><button v-if="data?.next_cursor" type="button" @click="cursor = data!.next_cursor!">
        Next page
      </button>
    </nav>
  </section>
</template>

<style scoped>
.html-collection{margin:32px 0 48px}h2{font:30px Georgia,serif}h3{font:24px Georgia,serif;overflow-wrap:anywhere}form{display:flex;flex-wrap:wrap;gap:16px;margin:24px 0}.filters{display:flex;flex-wrap:wrap;gap:16px;border:0;padding:0;margin:0;min-width:0}label{display:flex;flex-direction:column;gap:4px;font-size:14px}input,select,button{font:inherit;background:transparent;color:inherit;border:1px solid #aab8ad;border-radius:5px;padding:6px;max-width:100%}input[type=checkbox]{align-self:flex-start}article{display:flex;justify-content:space-between;align-items:center;gap:16px;border-top:1px solid #aab8ad;padding:20px 0}article div{min-width:0}article a,article button{flex-shrink:0}p{overflow-wrap:anywhere}article p{font-size:13px}nav{display:flex;gap:16px}code{overflow-wrap:anywhere}
</style>
