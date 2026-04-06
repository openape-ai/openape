<script setup lang="ts">
import { useIdpAuth } from '@openape/vue-components'
import { useRouter } from 'vue-router'

const router = useRouter()
const { user, fetchUser, logout } = useIdpAuth()
fetchUser()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-3xl font-bold text-center">
          OpenApe IdP
        </h1>
      </template>

      <p class="text-center text-(--ui-text-muted) mb-6">
        Identity Provider for the DDISA protocol.
      </p>

      <div v-if="user" class="space-y-3 text-center">
        <p class="text-sm text-(--ui-text-muted)">
          Signed in as <span class="font-mono font-semibold">{{ user.email }}</span>
        </p>
        <div class="flex flex-col gap-2">
          <UButton
            color="primary"
            variant="soft"
            label="Grants"
            @click="router.push('/grants')"
          />
          <UButton
            color="neutral"
            variant="soft"
            label="Account"
            @click="router.push('/account')"
          />
          <UButton
            v-if="user.isAdmin"
            color="neutral"
            variant="soft"
            label="Admin"
            @click="router.push('/admin')"
          />
          <UButton
            color="neutral"
            variant="outline"
            label="Sign out"
            @click="logout"
          />
        </div>
      </div>

      <div v-else class="text-center">
        <UButton
          color="primary"
          label="Sign in"
          @click="router.push('/login')"
        />
      </div>
    </UCard>
  </div>
</template>
