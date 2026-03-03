<script setup lang="ts">
const { user, loading, fetchUser, login } = useOpenApeAuth()
const email = ref('')

onMounted(async () => {
  await fetchUser()
  if (user.value) navigateTo('/dashboard')
})

async function handleLogin() {
  if (!email.value) return
  await login(email.value)
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-gray-950">
    <UCard class="w-full max-w-md bg-gray-900 border border-gray-800">
      <template #header>
        <div class="flex flex-col items-center gap-3 pt-2">
          <AppLogo />
          <div class="text-center">
            <h1 class="text-lg font-semibold text-white">
              Agent Mail
            </h1>
            <p class="text-sm text-gray-400 mt-1">
              Ephemeral email for AI agents
            </p>
          </div>
        </div>
      </template>

      <form class="space-y-4" @submit.prevent="handleLogin">
        <UFormField label="Email">
          <UInput
            v-model="email"
            type="email"
            placeholder="du@example.com"
            size="lg"
            :disabled="loading"
            icon="i-lucide-mail"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          color="primary"
          block
          size="lg"
          :loading="loading"
          icon="i-lucide-log-in"
        >
          Login with OpenApe
        </UButton>
      </form>
    </UCard>
  </div>
</template>
