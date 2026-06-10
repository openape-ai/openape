<script setup lang="ts">
import { ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

const { t } = useI18n()
useSeoMeta({ title: () => t('orgsIndex.tabTitle') })

const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface OrgRow {
  id: string
  name: string
  visionMd: string
  budgetMonthlyEur: number
  createdAt: number
  updatedAt: number
  memberCount: number
}

const orgs = ref<OrgRow[]>([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    orgs.value = await ($fetch as any)('/api/orgs')
  }
  catch (err: any) {
    if (err?.statusCode === 401) {
      // Session expired — clearing the user swaps the page to the sign-in
      // state (the start page IS the login page, no /login redirect).
      await fetchUser()
      return
    }
    error.value = err?.data?.statusMessage || err?.message || t('orgsIndex.error.loadFailed')
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => { if (u) load() }, { immediate: true })

async function onCreated(payload: { id: string }) {
  await navigateTo(`/orgs/${payload.id}`)
}
</script>

<template>
  <!-- Signed out: the start page IS the login page (DDISA SPs put the email
       form right on the landing page — no extra hop to /login). -->
  <div v-if="!user" class="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100">
    <main class="flex-1 flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md space-y-4 text-center">
        <div class="text-6xl" aria-hidden="true">
          🏛️
        </div>
        <h1 class="text-3xl font-bold tracking-tight">
          {{ $t('app.title') }}
        </h1>
        <OpenApeOAuthErrorAlert
          class="text-left w-full"
          :messages="{ access_denied: $t('login.oauth.accessDenied') }"
        />
        <UCard class="text-left">
          <OpenApeAuth
            :title="$t('login.card.title')"
            :subtitle="$t('login.card.subtitle')"
            :button-text="$t('login.card.button')"
            post-login-redirect="/"
          />
        </UCard>
      </div>
    </main>
  </div>

  <div v-else class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-2xl shrink-0">🏛️</span>
        <h1 class="text-xl font-semibold">
          {{ $t('app.title') }}
        </h1>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <LocaleSwitcher />
        <UButton color="primary" size="sm" icon="i-lucide-plus" @click="showCreate = true">
          <span class="hidden sm:inline">{{ $t('orgsIndex.newOrg') }}</span>
        </UButton>
        <UButton variant="ghost" size="sm" icon="i-lucide-log-out" :ui="{ base: 'shrink-0' }" @click="logout">
          <span class="hidden sm:inline">{{ $t('common.logout') }}</span>
        </UButton>
      </div>
    </header>

    <CreateOrgDialog v-model:open="showCreate" @created="onCreated" />

    <main class="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <h2 class="text-2xl font-bold mb-1">
        {{ $t('orgsIndex.heading') }}
      </h2>
      <p class="text-muted mb-6">
        {{ $t('orgsIndex.subheading') }}
      </p>

      <UAlert v-if="error" color="error" :title="error" class="mb-4" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          {{ $t('common.loading') }}
        </p>
      </UCard>

      <UCard v-else-if="orgs.length === 0">
        <div class="text-center py-12 space-y-4">
          <div class="text-5xl">
            🏛️
          </div>
          <h3 class="text-lg font-medium">
            {{ $t('orgsIndex.empty.title') }}
          </h3>
          <p class="text-muted text-sm max-w-md mx-auto">
            {{ $t('orgsIndex.empty.hint') }}
          </p>
          <UButton color="primary" icon="i-lucide-plus" @click="showCreate = true">
            {{ $t('orgsIndex.empty.cta') }}
          </UButton>
        </div>
      </UCard>

      <ul v-else class="space-y-3">
        <li v-for="o in orgs" :key="o.id">
          <NuxtLink
            :to="`/orgs/${o.id}`"
            class="block rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-4 active:bg-zinc-900 transition-colors"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <h3 class="text-lg font-semibold truncate">
                  {{ o.name }}
                </h3>
                <p v-if="o.visionMd" class="text-xs text-muted mt-1 line-clamp-2">
                  {{ o.visionMd }}
                </p>
              </div>
              <UIcon name="i-lucide-chevron-right" class="text-muted shrink-0 size-5 mt-1" />
            </div>
            <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt class="text-muted">
                  {{ $t('orgsIndex.card.members') }}
                </dt>
                <dd class="font-medium">
                  {{ o.memberCount }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">
                  {{ $t('orgsIndex.card.budget') }}
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
  </div>
</template>
