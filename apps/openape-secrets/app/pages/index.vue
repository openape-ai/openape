<script setup lang="ts">
import { useOpenApeAuth } from '#imports'
// Placeholder landing page. The one screen that matters — filling a request —
// arrives with M3; until then this exists so the app has a route and the build
// has something to render.
const { user } = useOpenApeAuth()
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
    <div class="max-w-md text-center space-y-3">
      <div class="text-3xl" aria-hidden="true">
        🔑
      </div>
      <h1 class="text-xl font-semibold tracking-tight">
        OpenApe Secrets
      </h1>
      <p class="text-sm text-zinc-400">
        Hand a secret to one of your machines without it passing through a chat,
        a ticket, or anyone's scrollback. The value is sealed in your browser
        against that machine's key — this service only ever holds an envelope it
        cannot open.
      </p>
      <p v-if="user" class="text-xs text-zinc-600">
        Signed in as {{ user.sub }}
      </p>
    </div>
  </div>
</template>
