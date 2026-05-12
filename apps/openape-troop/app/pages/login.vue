<script setup lang="ts">
useSeoMeta({ title: 'Sign in' })
</script>

<template>
  <div class="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100">
    <main class="flex-1 flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md space-y-4">
        <OpenApeOAuthErrorAlert
          class="text-left mb-6 w-full"
          :messages="{
            access_denied: 'Login wurde vom Identity Provider abgelehnt. Wahrscheinlich hat dein Domain-Admin Troop noch nicht freigegeben — frag deinen Admin oder verwende eine andere Email-Adresse.',
          }"
        />

        <UCard>
          <OpenApeAuth
            title="Sign in to Troop"
            subtitle="Enter your email to manage your agents"
            button-text="Continue"
            post-login-redirect="/"
          />
        </UCard>
      </div>
    </main>
  </div>
</template>
