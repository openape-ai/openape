<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

// Companies list — the business view's landing. Mirrors the former org.openape.ai
// list (card per company → click into its hierarchy). Toggle to the Nests view.
useSeoMeta({ title: () => 'Firmen' })

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

interface OrgRow { id: string, name: string, visionMd: string, budgetMonthlyEur: number, memberCount: number }

const orgs = ref<OrgRow[]>([])
const loading = ref(true)
const error = ref('')

const showCreate = ref(false)
const createForm = reactive({ name: '', vision: '' })
const creating = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    orgs.value = await ($fetch as any)('/api/orgs')
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || 'Konnte die Firmen nicht laden.'
  }
  finally { loading.value = false }
}

async function createCompany() {
  if (!createForm.name.trim()) return
  creating.value = true
  try {
    const r = await ($fetch as any)('/api/orgs', { method: 'POST', body: { name: createForm.name.trim(), vision_md: createForm.vision.trim() } })
    await navigateTo(`/companies/${r.id}`)
  }
  catch (err: any) { error.value = err?.data?.statusMessage || 'Anlegen fehlgeschlagen.' }
  finally { creating.value = false }
}

watch(user, (u) => { if (u) load() }, { immediate: true })
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800/80 px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-2xl shrink-0" aria-hidden="true">🦍</span>
        <ViewToggle active="companies" />
      </div>
      <UButton color="primary" size="sm" icon="i-lucide-plus" @click="showCreate = true">
        <span class="hidden sm:inline">Firma</span>
      </UButton>
    </header>

    <main class="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <h2 class="text-2xl font-bold mb-1">
        Firmen
      </h2>
      <p class="text-zinc-400 mb-6">
        Ihre Firmen — klicken Sie eine an, um Hierarchie, Ziele und Kosten zu sehen.
      </p>

      <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />

      <p v-if="loading" class="text-zinc-500 py-12 text-center">
        Lädt …
      </p>

      <div v-else-if="!orgs.length" class="rounded-xl border border-dashed border-zinc-700 py-12 text-center space-y-3">
        <div class="text-5xl">
          🏢
        </div>
        <h3 class="text-lg font-medium">
          Noch keine Firma
        </h3>
        <p class="text-sm text-zinc-400 max-w-md mx-auto">
          Legen Sie Ihre erste Firma an — der CEO richtet sich nach ihrer Vision.
        </p>
        <UButton color="primary" icon="i-lucide-plus" @click="showCreate = true">
          Firma anlegen
        </UButton>
      </div>

      <ul v-else class="space-y-3">
        <li v-for="o in orgs" :key="o.id">
          <NuxtLink
            :to="`/companies/${o.id}`"
            class="block rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4 hover:bg-zinc-900 transition-colors"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <h3 class="text-lg font-semibold truncate">
                  {{ o.name }}
                </h3>
                <p v-if="o.visionMd" class="text-xs text-zinc-500 mt-1 line-clamp-2">
                  {{ o.visionMd }}
                </p>
              </div>
              <UIcon name="i-lucide-chevron-right" class="text-zinc-500 shrink-0 size-5 mt-1" />
            </div>
            <dl class="mt-3 grid grid-cols-2 gap-x-4 text-xs max-w-xs">
              <div>
                <dt class="text-zinc-500">
                  Mitglieder
                </dt>
                <dd class="font-medium">
                  {{ o.memberCount }}
                </dd>
              </div>
              <div>
                <dt class="text-zinc-500">
                  Budget
                </dt>
                <dd class="font-medium">
                  {{ o.budgetMonthlyEur }} €/Mo
                </dd>
              </div>
            </dl>
          </NuxtLink>
        </li>
      </ul>
    </main>

    <UModal v-model:open="showCreate" :ui="{ content: 'sm:max-w-lg' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              Firma anlegen
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showCreate = false" />
          </div>
          <UFormField label="Name">
            <UInput v-model="createForm.name" placeholder="Firmenname" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Vision" description="Der CEO liest das bei jeder Interaktion.">
            <UTextarea v-model="createForm.vision" :rows="4" placeholder="Was soll die Firma erreichen?" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showCreate = false">
              Abbrechen
            </UButton>
            <UButton color="primary" :loading="creating" :disabled="!createForm.name.trim()" @click="createCompany">
              Anlegen
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
