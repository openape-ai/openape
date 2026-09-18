<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { issueError } from '../utils/issue-ui'

interface Product { key: string, name: string, enabled: number, version: number }
interface Policy { reportingEnabled: boolean, version: number, products: Product[], canCreateProduct: boolean }
const props = defineProps<{ owner: string, name: string }>()
const policy = ref<Policy | null>(null)
const error = ref('')
const busy = ref(false)
const productKey = ref('')
const productName = ref('')
const base = `/api/repos/${props.owner}/${props.name}`
async function load() {
  try { policy.value = await $fetch<Policy>(`${base}/issue-policy`) }
  catch (err) { error.value = issueError(err) }
}
onMounted(load)
async function save(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await action(); await load() }
  catch (err) { error.value = issueError(err) }
  finally { busy.value = false }
}
function savePolicy() { return $fetch(`${base}/issue-policy`, { method: 'PATCH', body: { reportingEnabled: policy.value!.reportingEnabled, expectedVersion: policy.value!.version } }) }
function saveProduct(product: Product) { return $fetch(`${base}/issue-products/${encodeURIComponent(product.key)}`, { method: 'PUT', body: { name: product.name, enabled: Boolean(product.enabled), expectedVersion: product.version } }) }
async function createProduct() { await saveProduct({ key: productKey.value, name: productName.value, enabled: 1, version: 0 }); productKey.value = ''; productName.value = '' }
</script>

<template>
  <section class="border border-zinc-800 rounded-lg p-4 space-y-4">
    <h2 class="font-semibold">
      Product issue reporting
    </h2>
    <p class="text-sm text-zinc-400">
      Allow signed-in people and agents to report product problems. Reporters can read and comment on their own issue, including all subsequent discussion, without receiving repository access.
    </p>
    <UAlert v-if="error" role="alert" color="error" :title="error" />
    <template v-if="policy">
      <form class="flex flex-wrap items-center gap-3" @submit.prevent="save(savePolicy)">
        <label class="text-sm flex gap-2"><input v-model="policy.reportingEnabled" type="checkbox">Enable product reports in this repository</label><UButton type="submit" color="neutral" variant="outline" size="sm" :loading="busy">
          Save reporting policy
        </UButton>
      </form>
      <form v-for="product in policy.products" :key="product.key" class="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-3" @submit.prevent="save(() => saveProduct(product))">
        <code>{{ product.key }}</code><UInput v-model="product.name" :aria-label="`Name for ${product.key}`" :maxlength="100" required /><label class="text-sm flex gap-2"><input v-model="product.enabled" type="checkbox" :true-value="1" :false-value="0">Enabled</label><UButton type="submit" size="sm" color="neutral" variant="outline" :loading="busy">
          Save product
        </UButton>
      </form>
      <form v-if="policy.canCreateProduct" class="flex flex-wrap gap-3 border-t border-zinc-800 pt-3" @submit.prevent="save(createProduct)">
        <UInput v-model="productKey" aria-label="Product key" placeholder="Stable product key" pattern="[a-z][a-z0-9-]{0,63}" required /><UInput v-model="productName" aria-label="Product name" placeholder="Product name" :maxlength="100" required /><UButton type="submit" :loading="busy">
          Register product
        </UButton>
      </form>
    </template>
  </section>
</template>
