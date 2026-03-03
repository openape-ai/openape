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
  <div class="min-h-screen flex items-center justify-center">
    <div class="w-full max-w-sm space-y-8 p-8">
      <div class="text-center">
        <h1 class="text-2xl font-bold">Agent Mail</h1>
        <p class="text-sm text-gray-400 mt-2">Ephemeral email for AI agents</p>
      </div>

      <form class="space-y-4" @submit.prevent="handleLogin">
        <UInput
          v-model="email"
          type="email"
          placeholder="Email"
          size="lg"
          :disabled="loading"
        />
        <UButton
          type="submit"
          block
          size="lg"
          :loading="loading"
        >
          Login with OpenApe
        </UButton>
      </form>
    </div>
  </div>
</template>
