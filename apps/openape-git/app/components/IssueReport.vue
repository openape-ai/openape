<script setup lang="ts">
import type { IssueRecord } from '../../shared/issue-types'
import { onMounted, ref, watch } from 'vue'
import { issueError } from '../utils/issue-ui'

interface Catalog { products: { key: string, name: string }[], selected: { key: string | null, name: string, audience: string, routingVersion: string, unclassified: boolean } }
const route = useRoute()
const router = useRouter()
const catalog = ref<Catalog | null>(null)
const title = ref('')
const body = ref('')
const busy = ref(false)
const error = ref('')
const reviewRequired = ref(false)
let key = ''
let payload = ''
let loadVersion = 0
async function load() {
  const version = ++loadVersion
  error.value = ''
  catalog.value = null
  try {
    const result = await $fetch<Catalog>('/api/products', { query: { product: String(route.query.product || '') } })
    if (version !== loadVersion) return
    catalog.value = result
    reviewRequired.value = false
  }
  catch (err) { if (version === loadVersion) error.value = issueError(err) }
}
onMounted(load)
watch(() => route.query.product, load)
async function submit() {
  if (busy.value || !catalog.value || reviewRequired.value) return
  const input = { productKey: catalog.value.selected.key, routingVersion: catalog.value.selected.routingVersion, title: title.value, body: body.value }
  const next = JSON.stringify(input)
  if (!key || next !== payload) { key = crypto.randomUUID(); payload = next }
  busy.value = true
  error.value = ''
  try {
    const issue = await $fetch<IssueRecord>('/api/reports', { method: 'POST', body: input, headers: { 'Idempotency-Key': key } })
    await navigateTo(issue.stableUrl)
  }
  catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    reviewRequired.value = status === 409
    error.value = status === 409 ? 'The reporting destination changed. Your draft is kept. Review the current product and audience before submitting again.' : issueError(err)
  }
  finally { busy.value = false }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800 p-4">
      <NuxtLink to="/issues" class="font-bold">
        🦍 ape-git · Issues
      </NuxtLink>
    </header>
    <main class="max-w-3xl mx-auto p-4 md:py-8 space-y-5">
      <h1 class="text-2xl font-semibold">
        Report a problem
      </h1>
      <p class="text-zinc-400 text-sm">
        Tell the product team what happened. You can follow the discussion here after submitting.
      </p>
      <UAlert v-if="error" role="alert" color="error" :title="error" />
      <UButton v-if="reviewRequired || (!catalog && error)" color="neutral" variant="outline" @click="load">
        Review current destination
      </UButton>
      <p v-if="!catalog && !error" role="status">
        Loading products…
      </p>
      <form v-if="catalog" class="space-y-4" @submit.prevent="submit">
        <div class="issue-filters">
          <label>Product<select aria-label="Product" :value="catalog.selected.key || ''" :disabled="busy" @change="router.replace({ query: { product: ($event.target as HTMLSelectElement).value || undefined } })"><option value="">Not sure / another product</option><option v-for="product in catalog.products" :key="product.key" :value="product.key">{{ product.name }}</option></select></label>
        </div>
        <UAlert color="neutral" :title="catalog.selected.unclassified ? 'Private intake — the team will classify your report' : `${catalog.selected.name} — private development discussion`" :description="catalog.selected.audience" />
        <label class="block text-sm">What happened?<UInput v-model="title" aria-label="What happened?" :maxlength="200" class="w-full mt-2" required :disabled="busy" /></label>
        <IssueEditor v-model="body" label="Expected and actual behavior" :disabled="busy" />
        <p class="text-xs text-zinc-500">
          Only the text you enter is sent. Keep passwords, tokens and unrelated personal data out of the report.
        </p>
        <div class="flex justify-end">
          <UButton type="submit" :disabled="!title.trim() || reviewRequired" :loading="busy">
            Submit report
          </UButton>
        </div>
      </form>
    </main>
  </div>
</template>
