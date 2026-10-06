<script setup lang="ts">
import HtmlCollection from '../components/HtmlCollection.vue'

const route = useRoute()
const category = computed(() => typeof route.query.category === 'string' ? route.query.category : undefined)
const offset = computed(() => Number(route.query.offset) || 0)
const { data, error } = await useFetch('/api/reports', { query: computed(() => ({ category: category.value, offset: offset.value })) })
useSeoMeta({ title: 'OpenApe Reports', robots: 'noindex, nofollow' })
const selectedCount = computed(() => category.value ? data.value?.categories.find(item => item.key === category.value)?.count ?? 0 : data.value?.total ?? 0)
</script>

<template>
  <main class="reports-home">
    <header>
      <p>OpenApe Reports</p><NuxtLink to="/runs">
        Test uploads →
      </NuxtLink>
    </header>
    <h1>Your reports.</h1>
    <p class="intro">
      Documents, briefings and test results. Organized your way.
    </p>
    <div v-if="error">
      <p>Sign in to view your reports.</p><NuxtLink to="/">
        Sign in with OpenApe →
      </NuxtLink>
    </div>
    <template v-else>
      <HtmlCollection />
      <h2>Earlier reports and Test Run uploads</h2>
      <nav aria-label="Report categories">
        <NuxtLink to="/reports" :aria-current="!category ? 'page' : undefined">
          All reports · {{ data?.total ?? 0 }}
        </NuxtLink>
        <NuxtLink v-for="item in data?.categories" :key="item.key" :to="{ path: '/reports', query: { category: item.key } }" :aria-current="category === item.key ? 'page' : undefined">
          {{ item.label }} · {{ item.count }}
        </NuxtLink>
      </nav>
      <p v-if="!data?.reports.length">
        No reports in this view yet.
      </p>
      <article v-for="item in data?.reports" :key="item.id">
        <div><h2>{{ item.title }}</h2><p>{{ item.category }} · {{ item.visibility === 'private' ? 'Private' : 'Shared link' }}</p></div>
        <NuxtLink :to="`/r/${item.slug}`">
          Read →
        </NuxtLink>
      </article>
      <footer>
        <NuxtLink v-if="offset > 0" :to="{ query: { category, offset: Math.max(0, offset - 50) } }">
          ← Previous
        </NuxtLink>
        <NuxtLink v-if="offset + 50 < selectedCount" :to="{ query: { category, offset: offset + 50 } }">
          Next →
        </NuxtLink>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.reports-home{min-height:100dvh;background:#f7f6f1;color:#213c36;padding:30px max(24px,calc((100vw - 1000px)/2));font:16px/1.65 system-ui,sans-serif}header,footer{display:flex;justify-content:space-between;gap:20px;align-items:center;font-size:13px}header{border-bottom:1px solid #d7ddd4;padding-bottom:20px}h1{font:clamp(38px,8vw,52px)/1.1 Georgia,serif;margin:60px 0 20px;letter-spacing:-.04em}.intro{color:#66716a;margin-bottom:30px}nav{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:30px}nav a{border:1px solid #aab8ad;border-radius:20px;padding:6px 14px;text-decoration:none;overflow-wrap:anywhere}nav a[aria-current=page]{background:#213c36;color:white}article{padding:25px 0;border-top:1px solid #d7ddd4;display:flex;justify-content:space-between;gap:20px;align-items:center}article>div{min-width:0}h2{font:27px Georgia,serif;overflow-wrap:anywhere}article p{font-size:12px;color:#66716a;margin-top:8px}article>a{flex-shrink:0}a{text-decoration:underline;text-underline-offset:4px}@media(prefers-color-scheme:dark){.reports-home{background:#14231f;color:#e3e9de}.intro,article p{color:#a3b2a7}header,article{border-color:#35483f}nav a[aria-current=page]{background:#d7e7dc;color:#14231f}}
</style>
