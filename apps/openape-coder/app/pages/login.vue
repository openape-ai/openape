<script setup lang="ts">
useSeoMeta({ title: 'Sign in — OpenApe Coder' })
</script>

<template>
  <div class="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100">
    <main class="flex-1 flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md space-y-4 text-center">
        <div class="text-6xl" aria-hidden="true">
          🛠️
        </div>
        <h1 class="text-3xl font-bold tracking-tight">
          OpenApe Coder
        </h1>
        <OpenApeOAuthErrorAlert class="text-left w-full" />
        <UCard class="text-left">
          <OpenApeAuth
            title="Sign in to OpenApe Coder"
            subtitle="Use your OpenApe identity — your email domain and a passkey. No new account, no password."
            button-text="Continue"
            post-login-redirect="/"
          />
        </UCard>
      </div>
    </main>
  </div>
</template>
