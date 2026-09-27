<script setup lang="ts">
const { data: series, error } = await useFetch('/api/report-series')
useSeoMeta({ title: 'OpenApe Reports', robots: 'noindex, nofollow' })
</script>

<template>
  <main class="reports-home">
    <header>
      <p>OpenApe Reports</p><NuxtLink to="/runs">
        Test reports →
      </NuxtLink>
    </header>
    <h1>Your briefings.</h1>
    <p class="intro">
      A private collection of what matters, ready when you are.
    </p>
    <div v-if="error">
      <p>Sign in to view your private briefings.</p><NuxtLink to="/">
        Sign in with OpenApe →
      </NuxtLink>
    </div>
    <p v-else-if="!series?.length">
      Your first briefing will appear here after publication.
    </p>
    <article v-for="item in series" v-else :key="item.id">
      <div><h2>{{ item.name }}</h2><p>{{ item.version ? `Edition ${item.version}` : 'Awaiting first publication' }}</p></div><NuxtLink v-if="item.version" :to="`/r/${item.slug}`">
        Read latest →
      </NuxtLink>
    </article>
  </main>
</template>

<style scoped>
.reports-home{min-height:100dvh;background:#f7f6f1;color:#213c36;padding:30px max(24px,calc((100vw - 1000px)/2));font:16px/1.65 system-ui,sans-serif}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d7ddd4;padding-bottom:20px;font-size:13px}h1{font:52px/1.1 Georgia,serif;margin:70px 0 20px;letter-spacing:-.04em}.intro{color:#66716a;margin-bottom:50px}article{padding:25px 0;border-top:1px solid #d7ddd4;display:flex;justify-content:space-between;gap:20px;align-items:center}h2{font:27px Georgia,serif}article p{font-size:12px;color:#66716a;margin-top:8px}a{text-decoration:underline;text-underline-offset:4px}@media(prefers-color-scheme:dark){.reports-home{background:#14231f;color:#e3e9de}.intro,article p{color:#a3b2a7}header,article{border-color:#35483f}}
</style>
