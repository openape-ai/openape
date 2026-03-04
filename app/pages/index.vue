<script setup lang="ts">
const { user, loading, fetchUser, login } = useOpenApeAuth()

useSeoMeta({ title: 'Agent Mail' })

const email = ref('')

await fetchUser()
if (user.value) await navigateTo('/dashboard')

async function handleLogin() {
  if (!email.value) return
  await login(email.value)
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-gray-950">
    <div class="w-full max-w-md flex flex-col items-center text-center">
      <div class="text-6xl mb-6">
        🦍
      </div>

      <h1 class="text-4xl sm:text-5xl font-extrabold text-white mb-4">
        Every agent deserves<br>
        <span class="text-primary">a mailbox.</span>
      </h1>

      <p class="text-lg text-gray-400 mb-8">
        Managed email addresses for your AI agents. Powered by OpenApe.
      </p>

      <form class="w-full space-y-4" @submit.prevent="handleLogin">
        <UInput
          v-model="email"
          type="email"
          placeholder="you@example.com"
          size="xl"
          :disabled="loading"
          icon="i-lucide-mail"
          class="w-full"
        />
        <UButton
          type="submit"
          color="primary"
          block
          size="xl"
          :loading="loading"
          icon="i-lucide-log-in"
        >
          Login with OpenApe
        </UButton>
      </form>

      <p class="mt-8 text-sm text-gray-500">
        Powered by <NuxtLink to="https://openape.at" external class="text-gray-400 hover:text-white transition-colors">
          OpenApe
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
