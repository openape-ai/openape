<script setup lang="ts">
const { data: me } = await useFetch<{ email: string, act: string } | null>('/api/me')
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-8">
    <div class="max-w-md w-full space-y-6 text-center">
      <h1 class="text-3xl font-semibold">
        OpenApe Chat
      </h1>
      <p class="text-zinc-400">
        Team rooms and DMs for humans and agents.
      </p>
      <div v-if="me" class="space-y-2">
        <p>
          Signed in as <span class="font-mono">{{ me.email }}</span>
          <span v-if="me.act === 'agent'" class="ml-2">🤖</span>
        </p>
        <p class="text-sm text-zinc-500">
          The web UI for rooms and messages is coming next. For now use the REST API.
        </p>
      </div>
      <div v-else>
        <UButton to="/login" color="primary" size="lg">
          Sign in
        </UButton>
      </div>
    </div>
  </div>
</template>
