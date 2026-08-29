<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'
import { ownerSlugFromEmail } from '~/utils/git-ui'
import { takeReturnPath } from '~/utils/return-to'

interface Repo {
  id: string
  owner: string
  name: string
  defaultBranch: string
  createdAt: number
}

const { user, fetchUser, login, logout } = useOpenApeAuth()

const email = ref('')
const submitting = ref(false)
const error = ref('')

const repos = ref<Repo[]>([])
const loading = ref(true)
const newOwner = ref('')
const newName = ref('')
const creating = ref(false)

const identity = computed(() => {
  const u = user.value as { email?: string, sub?: string } | null
  return u?.email ?? u?.sub ?? ''
})

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    loading.value = false
    return
  }
  const target = takeReturnPath()
  if (target) {
    await navigateTo(target, { replace: true })
    return
  }
  newOwner.value = ownerSlugFromEmail(identity.value)
  await load()
})

async function load() {
  loading.value = true
  repos.value = await $fetch<Repo[]>('/api/repos')
  loading.value = false
}

async function onLogin() {
  const value = email.value.trim()
  if (!value || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    await login(value)
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string }, message?: string }
    error.value = e.data?.detail ?? e.data?.title ?? e.message ?? 'Login failed'
  }
  finally {
    submitting.value = false
  }
}

async function onCreate() {
  if (creating.value) return
  creating.value = true
  error.value = ''
  try {
    const repo = await $fetch<Repo>('/api/repos', {
      method: 'POST',
      body: { owner: newOwner.value, name: newName.value },
    })
    await navigateTo(`/${repo.owner}/${repo.name}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Create failed'
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <template v-if="user">
      <header class="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <NuxtLink to="/" class="font-bold text-lg">
          🦍 ape-git
        </NuxtLink>
        <div class="flex items-center gap-3 text-sm text-zinc-400">
          <span>{{ identity }}</span>
          <UButton size="xs" color="neutral" variant="ghost" @click="logout()">
            Logout
          </UButton>
        </div>
      </header>

      <main class="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <section>
          <h2 class="text-xl font-semibold mb-4">
            New repository
          </h2>
          <form class="flex flex-col sm:flex-row gap-2" @submit.prevent="onCreate">
            <UInput v-model="newOwner" placeholder="owner" class="sm:w-40" />
            <UInput v-model="newName" placeholder="name" class="flex-1" />
            <UButton type="submit" color="primary" :loading="creating" :disabled="!newOwner.trim() || !newName.trim()">
              Create
            </UButton>
          </form>
          <UAlert v-if="error" color="error" :title="error" class="mt-3" @close="error = ''" />
        </section>

        <section>
          <h2 class="text-xl font-semibold mb-4">
            Your repositories
          </h2>
          <p v-if="loading" class="text-zinc-500">
            Loading…
          </p>
          <p v-else-if="repos.length === 0" class="text-zinc-500">
            No repositories yet.
          </p>
          <ul v-else class="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
            <li v-for="repo in repos" :key="repo.id">
              <NuxtLink
                :to="`/${repo.owner}/${repo.name}`"
                class="flex items-center justify-between px-4 py-3 hover:bg-zinc-900"
              >
                <span class="font-mono">{{ repo.owner }}/{{ repo.name }}</span>
                <span class="text-xs text-zinc-500">{{ repo.defaultBranch }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </main>
    </template>

    <main v-else class="min-h-dvh flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md flex flex-col items-center text-center">
        <OpenApeOAuthErrorAlert class="text-left mb-6 w-full" />

        <div class="text-6xl mb-6" aria-hidden="true">
          🦍
        </div>

        <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          Git hosting,<br>
          <span class="text-primary-500">grant by grant.</span>
        </h1>

        <p class="mt-4 text-zinc-400 text-lg">
          Every clone and push is authorized by a revocable DDISA grant — for humans and agents alike.
        </p>

        <form class="w-full mt-10 space-y-3" @submit.prevent="onLogin">
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            size="xl"
            class="w-full"
            :ui="{ base: 'text-center' }"
          />

          <UButton
            type="submit"
            color="primary"
            block
            size="xl"
            :loading="submitting"
            :disabled="!email.trim() || submitting"
          >
            Login with OpenApe
          </UButton>

          <UAlert v-if="error" color="error" :title="error" @close="error = ''" />
        </form>

        <p class="mt-8 text-sm text-zinc-600">
          repos.openape.ai — the DDISA-native forge.
        </p>
      </div>
    </main>
  </div>
</template>
