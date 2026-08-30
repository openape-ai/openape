<script setup lang="ts">
import type { Abrechnung } from '#shared/contracts'
import { ABRECHNUNG } from '#shared/contracts'
import { formatEuro } from '../utils/board'
import { apiFetch } from '../utils/api'
import { problemMessage } from '../utils/problem-message'

interface Product {
  id: string
  name: string
  description: string | null
  standard_price_cents: number
  standard_billing: string
}

const { user, fetchUser } = useOpenApeAuth()
const { activeId, load: loadWorkspaces } = useWorkspaces()
const { run } = useApiAction()
const loading = ref(true)
const loadError = ref('')
const products = ref<Product[]>([])
const form = ref({ name: '', description: '', standard_price_cents: 0, standard_billing: 'monatlich' as Abrechnung })

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  try {
    await loadWorkspaces()
    await reload()
  }
  catch (error) {
    loadError.value = problemMessage(error, 'Katalog konnte nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch(activeId, () => void reload())

async function reload() {
  if (!activeId.value) {
    products.value = []
    return
  }
  products.value = await apiFetch(`/api/products?workspace_id=${activeId.value}`)
}

async function add() {
  const created = await run(
    () => apiFetch('/api/products', {
      method: 'POST',
      body: { workspace_id: activeId.value, ...form.value },
    }),
    { success: `${form.value.name} angelegt`, failure: 'Produkt konnte nicht angelegt werden' },
  )
  if (!created) return
  form.value = { name: '', description: '', standard_price_cents: 0, standard_billing: 'monatlich' }
  await reload()
}
</script>

<template>
  <div class="flex h-full flex-col md:flex-row">
    <div class="flex max-h-[40%] w-full shrink-0 flex-col overflow-hidden border-b border-[var(--crm-line)] bg-[var(--crm-panel)] md:max-h-none md:h-full md:w-[300px] md:border-r md:border-b-0">
      <header class="border-b border-[var(--crm-line)] px-3.5 py-3">
        <h2 class="text-[13px] font-semibold">
          Katalog
        </h2>
      </header>
      <div class="flex-1 overflow-auto p-1.5">
        <p v-if="loading" class="p-3 text-[var(--crm-ink-3)]">
          Lade …
        </p>
        <p v-else-if="loadError" class="p-3 text-[var(--crm-rose)]">
          {{ loadError }}
        </p>
        <button
          v-for="p in products"
          :key="p.id"
          type="button"
          class="mb-0.5 w-full rounded-[7px] px-2.5 py-2 text-start hover:bg-[var(--crm-panel-2)]"
        >
          <b class="block font-medium">{{ p.name }}</b>
          <div class="text-[11.5px] text-[var(--crm-ink-3)]">
            {{ formatEuro(p.standard_price_cents) }} · {{ p.standard_billing }}
          </div>
        </button>
        <p v-if="!loading && !products.length" class="p-3.5 text-[var(--crm-ink-3)]">
          Noch keine Produkte.
        </p>
      </div>
    </div>
    <div class="flex-1 overflow-auto p-4 sm:p-6">
      <h1 class="mb-1 text-lg font-semibold">
        Produkt anlegen
      </h1>
      <p class="mb-6 text-sm text-[var(--crm-ink-3)]">
        Standardpreise werden im Angebot vorbelegt und sind dort überschreibbar.
      </p>
      <form class="max-w-md space-y-3" @submit.prevent="add">
        <UFormField label="Name" required>
          <UInput v-model="form.name" class="w-full" />
        </UFormField>
        <UFormField label="Beschreibung">
          <UTextarea v-model="form.description" class="w-full" />
        </UFormField>
        <UFormField label="Standardpreis (Cent)">
          <UInput v-model.number="form.standard_price_cents" type="number" class="w-full" />
        </UFormField>
        <UFormField label="Abrechnung">
          <USelect v-model="form.standard_billing" :items="ABRECHNUNG.map(a => ({ label: a.label, value: a.id }))" class="w-full" />
        </UFormField>
        <UButton type="submit" :disabled="!form.name.trim()">
          Anlegen
        </UButton>
      </form>
    </div>
  </div>
</template>
