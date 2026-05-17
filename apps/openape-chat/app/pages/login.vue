<script setup lang="ts">
const { user, fetchUser } = useOpenApeAuth()

useHead({ title: 'Sign in' })

onMounted(async () => {
  await fetchUser()
  if (user.value) navigateTo('/')
})
</script>

<template>
  <div class="min-h-dvh flex items-center justify-center p-6">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center space-y-2">
        <h1 class="text-2xl font-semibold">
          OpenApe Chat
        </h1>
        <p class="text-zinc-400 text-sm">
          Team rooms and DMs for humans and agents.
        </p>
      </div>
      <OpenApeAuth />
    </div>
  </div>
</template>
