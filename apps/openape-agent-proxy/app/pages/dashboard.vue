<script setup lang="ts">
definePageMeta({ middleware: 'openape-auth' })

useSeoMeta({ title: 'Dashboard' })

const { user, logout } = useOpenApeAuth()
</script>

<template>
  <div class="min-h-screen bg-gray-950 p-4">
    <div class="max-w-4xl mx-auto space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <AppLogo />
          <p class="text-sm text-gray-400">{{ user?.sub }}</p>
        </div>
        <UButton color="neutral" variant="ghost" icon="i-lucide-log-out" @click="logout()">
          Logout
        </UButton>
      </div>

      <UCard>
        <div class="text-center py-12">
          <div class="text-4xl mb-4">🌐</div>
          <h2 class="text-xl font-semibold text-white mb-2">Proxy Dashboard</h2>
          <p class="text-gray-400">Coming soon</p>
        </div>
      </UCard>
    </div>
  </div>
</template>
