<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const user = ref<{ email: string } | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await fetch('/api/me', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      if (data.email) user.value = data
    }
  }
  catch {}
  loading.value = false
})

async function handleLogout() {
  loading.value = true
  await fetch('/api/session/logout', { method: 'POST', credentials: 'include' })
  user.value = null
  loading.value = false
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <!-- Logged in -->
    <UCard v-if="user" class="w-full max-w-md">
      <div class="flex flex-col items-center gap-4 py-4">
        <span class="flex items-center gap-2 text-lg font-bold">
          <span class="text-2xl">🦍</span>
          <span>OpenApe</span>
        </span>
        <div class="text-center">
          <p class="text-sm text-gray-400">
            Signed in as
          </p>
          <p class="text-white font-medium mt-1">
            {{ user.email }}
          </p>
        </div>
        <div class="w-full space-y-2">
          <UButton
            to="/account"
            color="primary"
            variant="outline"
            size="lg"
            block
            icon="i-lucide-key-round"
          >
            Manage Keys
          </UButton>
          <UButton
            to="/grants"
            color="primary"
            variant="outline"
            size="lg"
            block
            icon="i-lucide-shield-check"
          >
            Grants
          </UButton>
          <UButton
            to="/admin"
            color="primary"
            variant="outline"
            size="lg"
            block
            icon="i-lucide-settings"
          >
            Admin
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            block
            icon="i-lucide-log-out"
            :loading="loading"
            @click="handleLogout"
          >
            Sign out
          </UButton>
        </div>
      </div>
    </UCard>

    <!-- Not logged in -->
    <div v-else-if="!loading" class="w-full max-w-md flex flex-col items-center text-center">
      <div class="text-6xl mb-6">
        🦍
      </div>

      <h1 class="text-4xl sm:text-5xl font-extrabold text-white mb-4">
        One login.<br>
        <span class="text-primary sm:whitespace-nowrap">Every human.<br class="sm:hidden"> Every agent.</span>
      </h1>

      <p class="text-lg text-gray-400 mb-8">
        Free identity provider for the open web.
      </p>

      <div class="w-full space-y-3">
        <UButton
          to="/login"
          color="primary"
          size="xl"
          block
          icon="i-lucide-fingerprint"
        >
          Sign in
        </UButton>

        <UButton
          to="/register"
          color="neutral"
          variant="outline"
          size="xl"
          block
          icon="i-lucide-user-plus"
        >
          Create account
        </UButton>
      </div>

      <p class="mt-8 text-sm text-gray-500">
        Powered by <a href="https://openape.at" class="text-gray-400 hover:text-white transition-colors">OpenApe</a>
      </p>
    </div>
  </div>
</template>
