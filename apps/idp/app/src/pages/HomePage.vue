<script setup lang="ts">
import { useIdpAuth } from '@openape/vue-components'

const { user, fetchUser, logout } = useIdpAuth()
fetchUser()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md text-center space-y-6">
      <h1 class="text-3xl font-bold">
        OpenApe IdP
      </h1>
      <p class="text-gray-500">
        Identity Provider for the DDISA protocol.
      </p>

      <div v-if="user" class="space-y-3">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Signed in as <span class="font-mono font-semibold">{{ user.email }}</span>
        </p>
        <button
          class="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
          @click="logout"
        >
          Sign out
        </button>
      </div>

      <div v-else>
        <a
          href="/login"
          class="inline-block rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Sign in
        </a>
      </div>
    </div>
  </div>
</template>
