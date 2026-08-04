<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

// Companies list — the business view's landing. Mirrors the former org.openape.ai
// list (card per company → click into its hierarchy). Toggle to the Nests view.
const { t } = useI18n()
useSeoMeta({ title: () => t('companiesIndex.tabTitle') })

const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface OrgRow { id: string, name: string, visionMd: string, budgetMonthlyEur: number, memberCount: number }

const orgs = ref<OrgRow[]>([])
const loading = ref(true)
const error = ref('')

const showCreate = ref(false)
const createForm = reactive({ name: '', vision: '' })
const creating = ref(false)

// Plain-text preview for the 2-line card snippet — markdown syntax stripped
// (block markdown would break the line-clamp; the full render is on the detail).
function preview(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    orgs.value = await apiFetch('/api/orgs')
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || t('companiesIndex.error.loadFailed')
  }
  finally { loading.value = false }
}

async function createCompany() {
  if (!createForm.name.trim()) return
  creating.value = true
  try {
    const r = await apiFetch<{ id: string }>('/api/orgs', { method: 'POST', body: { name: createForm.name.trim(), vision_md: createForm.vision.trim() } })
    await navigateTo(`/companies/${r.id}`)
  }
  catch (err: any) { error.value = err?.data?.statusMessage || t('companiesIndex.error.createFailed') }
  finally { creating.value = false }
}

watch(user, (u) => { if (u) load() }, { immediate: true })
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <AppHeader active="companies" :show-logout="!!user" @logout="logout">
      <template #actions>
        <UButton color="primary" size="sm" icon="i-lucide-plus" @click="showCreate = true">
          <span class="hidden sm:inline">{{ $t('companiesIndex.newButton') }}</span>
        </UButton>
      </template>
    </AppHeader>

    <main class="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <InlineLogin v-if="!user" :hint="$t('common.loginHint', { what: $t('companiesIndex.loginWhat') })" />
      <template v-else>
        <h2 class="text-2xl font-bold mb-1">
          {{ $t('companiesIndex.heading') }}
        </h2>
        <p class="text-zinc-400 mb-6">
          {{ $t('companiesIndex.subheading') }}
        </p>

        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />

        <p v-if="loading" class="text-zinc-500 py-12 text-center">
          {{ $t('common.loading') }}
        </p>

        <div v-else-if="!orgs.length" class="rounded-xl border border-dashed border-zinc-700 py-12 text-center space-y-3">
          <div class="text-5xl">
            🏢
          </div>
          <h3 class="text-lg font-medium">
            {{ $t('companiesIndex.empty.title') }}
          </h3>
          <p class="text-sm text-zinc-400 max-w-md mx-auto">
            {{ $t('companiesIndex.empty.hint') }}
          </p>
          <UButton color="primary" icon="i-lucide-plus" @click="showCreate = true">
            {{ $t('companiesIndex.empty.button') }}
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
                    {{ preview(o.visionMd) }}
                  </p>
                </div>
                <UIcon name="i-lucide-chevron-right" class="text-zinc-500 shrink-0 size-5 mt-1" />
              </div>
              <dl class="mt-3 grid grid-cols-2 gap-x-4 text-xs max-w-xs">
                <div>
                  <dt class="text-zinc-500">
                    {{ $t('companiesIndex.card.members') }}
                  </dt>
                  <dd class="font-medium">
                    {{ o.memberCount }}
                  </dd>
                </div>
                <div>
                  <dt class="text-zinc-500">
                    {{ $t('companiesIndex.card.budget') }}
                  </dt>
                  <dd class="font-medium">
                    {{ $t('companiesIndex.card.budgetPerMonth', { amount: o.budgetMonthlyEur }) }}
                  </dd>
                </div>
              </dl>
            </NuxtLink>
          </li>
        </ul>
      </template>
    </main>

    <UModal v-model:open="showCreate" :ui="{ content: 'sm:max-w-lg' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ $t('companiesIndex.create.title') }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showCreate = false" />
          </div>
          <UFormField :label="$t('companiesIndex.create.nameLabel')">
            <UInput v-model="createForm.name" :placeholder="$t('companiesIndex.create.namePlaceholder')" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('companiesIndex.create.visionLabel')" :description="$t('companiesIndex.create.visionDescription')">
            <UTextarea v-model="createForm.vision" :rows="4" :placeholder="$t('companiesIndex.create.visionPlaceholder')" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showCreate = false">
              {{ $t('common.cancel') }}
            </UButton>
            <UButton color="primary" :loading="creating" :disabled="!createForm.name.trim()" @click="createCompany">
              {{ $t('companiesIndex.create.submit') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
